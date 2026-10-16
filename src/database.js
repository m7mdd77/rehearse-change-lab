import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
export const TABLES = ['customers','tickets','notes','attachments'];
const schema = `PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,name TEXT NOT NULL,contact_preference TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),title TEXT NOT NULL,team TEXT NOT NULL,status TEXT NOT NULL,closed_at TEXT,retention_hold INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,name TEXT NOT NULL,bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY,created INTEGER NOT NULL,payload TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,before_snapshot TEXT NOT NULL,after_digest TEXT NOT NULL,restored INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,at INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,result TEXT NOT NULL);`;
export function openDatabase(path) {
  const db = new DatabaseSync(path); db.exec(schema);
  if (!db.prepare("SELECT value FROM metadata WHERE key='seeded'").get()) seed(db);
  return db;
}
function seed(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of [['C-01','Cedar Studio','email'],['C-02','Harbor Books','email'],['C-03','Palm Workshop','phone'],['C-04','Mira Design','email']]) db.prepare('INSERT INTO customers VALUES (?,?,?)').run(...row);
    const rows = [
      ['T-101','C-01','Package returned','delivery','resolved','2026-06-08',0],
      ['T-102','C-02','Address corrected','delivery','resolved','2026-07-12',0],
      ['T-103','C-03','Delivery follow-up','delivery','resolved','2026-08-18',0],
      ['T-104','C-04','Retained delivery dispute','delivery','resolved','2026-07-22',1],
      ['T-105','C-01','Missing parcel investigation','delivery','open',null,0],
      ['T-106','C-02','Recent delivery reply','delivery','resolved','2026-10-01',0],
      ['T-107','C-03','Invoice duplicate','billing','resolved','2026-05-01',0],
      ['T-108','C-04','Credit note received','billing','resolved','2026-06-02',0],
      ['T-109','C-01','Receipt corrected','billing','resolved','2026-08-20',0],
      ['T-110','C-02','Payment question','billing','open',null,0],
      ['T-111','C-03','Portal access restored','platform','resolved','2026-07-05',0],
      ['T-112','C-04','Notification issue','platform','resolved','2026-08-29',0]
    ];
    for (const row of rows) {
      db.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?)').run(...row);
      for (let n=1;n<=2;n++) db.prepare('INSERT INTO notes VALUES (?,?,?)').run(`${row[0]}-N${n}`,row[0],n===1?'Fictional customer report.':'Fictional resolution note.');
      db.prepare('INSERT INTO attachments VALUES (?,?,?,?)').run(`${row[0]}-A1`,row[0],row[0].toLowerCase()+'-receipt.pdf',12000+Number(row[0].slice(2))*10);
    }
    for (const [k,v] of [['seeded','1'],['version','1'],['fault','0']]) db.prepare('INSERT INTO metadata VALUES (?,?)').run(k,v);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export const snapshot = db => Object.fromEntries(TABLES.map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY id`).all().map(row=>({...row}))]));
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function databaseDigest(db) {
  const objects=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  return digest({domain:snapshot(db),objects});
}
export function difference(before,after) {
  return Object.fromEntries(TABLES.map(table=>{
    const left=new Map(before[table].map(r=>[r.id,r])),right=new Map(after[table].map(r=>[r.id,r]));
    return [table,{deleted:[...left].filter(([id])=>!right.has(id)).map(([,r])=>r),inserted:[...right].filter(([id])=>!left.has(id)).map(([,r])=>r),updated:[...left].filter(([id,row])=>right.has(id)&&JSON.stringify(row)!==JSON.stringify(right.get(id))).map(([id,row])=>({before:row,after:right.get(id)}))}];
  }));
}
export function mutate(db,plan,{fault=false}={}) {
  db.prepare("DELETE FROM tickets WHERE status='resolved' AND retention_hold=0 AND closed_at<? AND (?='all' OR team=?)").run(plan.closedBefore,plan.team,plan.team);
  if (fault) db.exec("UPDATE customers SET contact_preference='none' WHERE id='C-01'");
}
export function restore(db,value) {
  for (const table of [...TABLES].reverse()) db.exec(`DELETE FROM ${table}`);
  for (const table of TABLES) for (const row of value[table]) {
    const fields=Object.keys(row); db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...Object.values(row));
  }
}
export const version = db => Number(db.prepare("SELECT value FROM metadata WHERE key='version'").get().value);
export const advanceVersion = db => db.prepare("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='version'").run();
