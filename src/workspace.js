import { backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDatabase, snapshot, digest, databaseDigest, difference, mutate, restore, version, advanceVersion, TABLES } from './database.js';
import { POLICY, validatePlan, validateCommand, requireValue, DomainError } from './contract.js';

export class Workspace {
  constructor(directory, { now=Date.now, propose }={}) {
    this.directory=resolve(directory); mkdirSync(this.directory,{recursive:true});
    this.db=openDatabase(join(this.directory,'workspace.sqlite')); this.now=now; this.propose=propose;
    const known=[...TABLES,'metadata','previews','runs','events','operations'];
    const actual=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if(!actual.every(row=>known.includes(row.name))){this.db.close();throw new DomainError('unknown_schema','An unrecognized table requires operator review before this workspace can run.');}
  }
  close() { this.db.close(); }
  state() {
    const data=snapshot(this.db),events=this.db.prepare('SELECT * FROM events ORDER BY at DESC,rowid DESC LIMIT 20').all().map(e=>({id:e.id,at:e.at,type:e.type,...JSON.parse(e.payload)}));
    return {version:version(this.db),data,events,faultArmed:this.db.prepare("SELECT value FROM metadata WHERE key='fault'").get().value==='1',policy:POLICY,storage:'Persistent SQLite · disposable demo data'};
  }
  event(type,payload) {
    const row={id:randomUUID(),at:this.now(),type,...payload};
    this.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(row.id,row.at,type,JSON.stringify(payload)); return row;
  }
  async simulate(plan) {
    plan=validatePlan(plan); const baseDigest=databaseDigest(this.db),baseVersion=version(this.db),copyPath=join(this.directory,'preview-'+randomUUID()+'.sqlite'); let copy;
    try {
      await backup(this.db,copyPath); copy=openDatabase(copyPath);
      requireValue(databaseDigest(copy)===baseDigest, 'changed_during_preview','The database changed while creating its simulation copy. Simulate again.');
      const before=snapshot(copy); copy.exec('BEGIN IMMEDIATE'); mutate(copy,plan); copy.exec('COMMIT'); const after=snapshot(copy),effects=difference(before,after);
      const roots=effects.tickets.deleted.length,dependents=effects.notes.deleted.length+effects.attachments.deleted.length;
      const impacted=[...new Set(effects.tickets.deleted.map(t=>t.customer_id))].map(id=>before.customers.find(c=>c.id===id));
      const reasons=[]; if(!roots)reasons.push('No tickets match this filter.'); if(roots>POLICY.maxRoots)reasons.push(`This batch deletes ${roots} tickets; the limit is ${POLICY.maxRoots}. Narrow the filter.`); if(dependents>POLICY.maxDependents)reasons.push('The dependent-record limit is exceeded.');
      requireValue(databaseDigest(this.db)===baseDigest&&version(this.db)===baseVersion, 'changed_during_preview','The database changed while simulating. Nothing was approved.');
      const preview={id:randomUUID(),createdAt:this.now(),expiresAt:this.now()+POLICY.previewMs,baseDigest,baseVersion,policyVersion:POLICY.version,plan,effects,counts:{tickets:roots,notes:effects.notes.deleted.length,attachments:effects.attachments.deleted.length,customers:effects.customers.deleted.length,total:roots+dependents},impactedCustomers:impacted,preserved:{tickets:after.tickets.length,held:before.tickets.filter(t=>t.retention_hold).map(t=>t.id),open:before.tickets.filter(t=>t.status==='open').map(t=>t.id)},beforeCounts:Object.fromEntries(TABLES.map(t=>[t,before[t].length])),afterCounts:Object.fromEntries(TABLES.map(t=>[t,after[t].length])),allowed:reasons.length===0,reasons,rollback:'Restore the exact pre-execution records only while the resulting database has no later domain changes.'};
      this.db.prepare('INSERT INTO previews(id,created,payload) VALUES (?,?,?)').run(preview.id,preview.createdAt,JSON.stringify(preview));
      return preview;
    } finally { copy?.close(); for(const suffix of ['','-wal','-shm'])rmSync(copyPath+suffix,{force:true}); }
  }
  execute(previewId) {
    const row=this.db.prepare('SELECT * FROM previews WHERE id=?').get(previewId);
    requireValue(row&&!row.consumed,'preview_unavailable','This preview is missing or already used. Simulate again.');
    const p=JSON.parse(row.payload);
    requireValue(p.allowed,'policy_blocked','This batch is blocked. Narrow the filter and simulate again.');
    requireValue(this.now()<p.expiresAt,'preview_expired','This preview expired. Simulate again before executing.');
    const fault=this.db.prepare("SELECT value FROM metadata WHERE key='fault'").get().value==='1';
    this.db.exec('BEGIN IMMEDIATE'); let observed;
    try {
      requireValue(version(this.db)===p.baseVersion&&databaseDigest(this.db)===p.baseDigest&&p.policyVersion===POLICY.version,'stale_preview','The database or policy changed. Simulate again; nothing was deleted.');
      const before=snapshot(this.db); mutate(this.db,p.plan,{fault}); const after=snapshot(this.db); observed=difference(before,after);
      requireValue(digest(observed)===digest(p.effects),'prediction_mismatch','Actual effects differed from the preview. The entire deletion was rolled back.');
      const id=randomUUID(); this.db.prepare('INSERT INTO runs(id,before_snapshot,after_digest) VALUES (?,?,?)').run(id,JSON.stringify(before),databaseDigest(this.db));
      this.db.prepare('UPDATE previews SET consumed=1 WHERE id=?').run(p.id); advanceVersion(this.db);
      this.db.prepare("UPDATE metadata SET value='0' WHERE key='fault'").run();
      const receipt=this.event('executed',{runId:id,previewId:p.id,counts:p.counts,matchedPrediction:true,beforeVersion:p.baseVersion,afterVersion:version(this.db),summary:`Deleted ${p.counts.tickets} tickets and ${p.counts.notes+p.counts.attachments} dependent records.`});
      this.db.exec('COMMIT'); return receipt;
    } catch(error) {
      this.db.exec('ROLLBACK');
      if(error.code==='prediction_mismatch') {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.prepare('UPDATE previews SET consumed=1 WHERE id=?').run(p.id); this.db.prepare("UPDATE metadata SET value='0' WHERE key='fault'").run();
          const receipt=this.event('contained',{previewId:p.id,predicted:p.counts,unexpected:observed.customers.updated.map(r=>({table:'customers',id:r.before.id,field:'contact_preference',before:r.before.contact_preference,attempted:r.after.contact_preference})),rolledBack:true,summary:'An unpredicted customer preference change was caught. All ticket deletions and the preference change rolled back.'});
          this.db.exec('COMMIT'); return receipt;
        } catch(recordError){this.db.exec('ROLLBACK');throw recordError;}
      }
      throw error;
    }
  }
  rollback(runId) {
    const run=this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    requireValue(run&&!run.restored,'restore_unavailable','This execution is missing or already restored.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      requireValue(databaseDigest(this.db)===run.after_digest,'restore_conflict','Later data or schema changes prevent a safe restore. No records were overwritten.');
      const before=snapshot(this.db),target=JSON.parse(run.before_snapshot);restore(this.db,target);
      requireValue(digest(snapshot(this.db))===digest(target),'restore_failed','Restored records did not match the recovery snapshot.');
      const counts=Object.fromEntries(TABLES.map(t=>[t,target[t].length-before[t].length]));
      this.db.prepare('UPDATE runs SET restored=1 WHERE id=?').run(runId);advanceVersion(this.db);
      const receipt=this.event('restored',{runId,counts,summary:`Restored ${counts.tickets} tickets, ${counts.notes} notes and ${counts.attachments} attachments.`});
      this.db.exec('COMMIT');return receipt;
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  async handle(command,requestId=randomUUID()) {
    validateCommand(command); requireValue(/^[a-f0-9-]{36}$/.test(requestId),'invalid_input','Invalid operation reference.');
    const commandHash=digest(command),old=this.db.prepare('SELECT result FROM operations WHERE id=?').get(requestId);
    if(old){const cached=JSON.parse(old.result);requireValue(cached.commandHash===commandHash,'idempotency_conflict','This operation reference belongs to another command.');return cached.result;}
    let result;
    try {
      if(command.op==='state')return {ok:true,state:this.state()};
      if(command.op==='propose') {
        requireValue(this.propose,'ai_offline','Sol is not connected. You can still choose the filter directly.');
        result={ok:true,proposal:await this.propose(command.intent)};
      }
      if(command.op==='simulate')result={ok:true,preview:await this.simulate(command.plan)};
      if(command.op==='execute')result={ok:true,receipt:this.execute(command.previewId)};
      if(command.op==='rollback')result={ok:true,receipt:this.rollback(command.runId)};
      if(command.op==='fault') {
        this.db.prepare("UPDATE metadata SET value=? WHERE key='fault'").run(command.enabled?'1':'0');
        result={ok:true};
      }
    } catch(error) {
      if(!(error instanceof DomainError))throw error;
      result={ok:false,error:{code:error.code,message:error.message}};
    }
    result.state=this.state();this.db.prepare('INSERT INTO operations VALUES (?,?)').run(requestId,JSON.stringify({commandHash,result}));return result;
  }
}
