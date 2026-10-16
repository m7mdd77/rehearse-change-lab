import { randomUUID, timingSafeEqual } from 'node:crypto';
import { validateCommand } from '../src/contract.js';
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
async function readBody(request) {
  let size=0;const chunks=[];for await(const c of request.body??[]){size+=c.length;if(size>8000)throw new HttpError(413,'Request too large.');chunks.push(c);}
  const bytes=new Uint8Array(size);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid JSON.');}
}
async function count(db,id,max,expires) {
  const row=await db.prepare('INSERT INTO limits VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(id,expires,max).first();
  if(!row)throw new HttpError(429,'This workspace allowance is reached. Try again later.');
}
async function cleanup(db) {
  const now=Date.now();for(const [table,column]of[['jobs','created'],['sessions','expires'],['limits','expires']])await db.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${column}<? LIMIT 50)`).bind(table==='jobs'?now-120000:now).run();
}
async function heartbeat(db) {await db.prepare('INSERT INTO limits VALUES (?,0,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires').bind('worker',Date.now()+20000).run();}
export async function online(db,env) {
  if(!/^[a-f0-9]{64}$/.test(env.REHEARSE_WORKER_TOKEN??''))return false;
  const row=await db.prepare('SELECT expires FROM limits WHERE id=?').bind('worker').first();return Boolean(row&&row.expires>Date.now());
}
async function worker(request,env,path) {
  const actual=Buffer.from(request.headers.get('authorization')??''),expected=Buffer.from('Bearer '+env.REHEARSE_WORKER_TOKEN);
  if(!env.REHEARSE_WORKER_TOKEN||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new HttpError(401,'Unauthorized.');
  const input=await readBody(request),db=env.DB,now=Date.now();
  if(path==='ping'){await heartbeat(db);return {online:true};}
  if(path==='claim') {
    await heartbeat(db);await cleanup(db);
    const row=await db.prepare("UPDATE jobs SET status='claimed',lease=? WHERE id=(SELECT id FROM jobs WHERE status='pending' AND created>? ORDER BY created LIMIT 1) AND status='pending' RETURNING id,owner,payload").bind(now+50000,now-55000).first();
    if(row)await db.prepare('UPDATE jobs SET payload=NULL WHERE id=?').bind(row.id).run();
    return {job:row?{id:row.id,owner:row.owner,command:JSON.parse(row.payload)}:null};
  }
  if(path==='complete') {
    if(typeof input.jobId!=='string'||typeof input.failed!=='boolean')throw new HttpError(400,'Invalid completion.');
    const result=input.failed?null:JSON.stringify(input.data);if(result&&result.length>120000)throw new HttpError(413,'Result too large.');
    const update=await db.prepare("UPDATE jobs SET status=?,result=? WHERE id=? AND status='claimed' AND lease>?").bind(input.failed?'failed':'completed',result,input.jobId,now).run();
    if(update.meta.changes!==1)throw new HttpError(409,'Job expired or already completed.');return {saved:true};
  }
  throw new HttpError(404,'Not found.');
}
export async function requestWork(db,owner,id,command,{timeoutMs=55000,pollMs=500}={}) {
  await db.prepare('INSERT INTO jobs(id,owner,payload,status,created) VALUES (?,?,?,?,?)').bind(id,owner,JSON.stringify(command),'pending',Date.now()).run();
  const deadline=Date.now()+timeoutMs;
  try {
    while(Date.now()<deadline) {
      const row=await db.prepare('SELECT status,result FROM jobs WHERE id=? AND owner=?').bind(id,owner).first();
      if(!row||row.status==='failed')throw new HttpError(503,'The service could not finish. Check receipts before retrying an execution.');
      if(row.status==='completed')return JSON.parse(row.result);
      await new Promise(resolve=>setTimeout(resolve,pollMs));
    }
    throw new HttpError(504,'The response timed out. Check receipts before retrying an execution.');
  } finally {await db.prepare('DELETE FROM jobs WHERE id=? AND owner=?').bind(id,owner).run();}
}
export async function api(request,env,options={}) {
  try {
    const url=new URL(request.url),path=url.pathname,db=env.DB,now=Date.now();
    if(request.method!=='GET'&&!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'JSON required.');
    if(path.startsWith('/api/worker/')) {if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');return json(200,await worker(request,env,path.slice(12)));}
    const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('rehearse='))?.slice(9);
    let session=cookie?await db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').bind(cookie,now).first():null;
    if(path==='/api/config'&&request.method==='GET') {
      let headers={};if(!session){await cleanup(db);await count(db,'sessions:'+Math.floor(now/3600000),100,now+3600000);session={id:randomUUID(),csrf:randomUUID(),expires:now+86400000*7};await db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(session.id,session.csrf,session.expires).run();headers={'Set-Cookie':`rehearse=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${url.protocol==='https:'?'; Secure':''}`};}
      return json(200,{connected:await online(db,env),csrf:session.csrf},headers);
    }
    if(path!=='/api/work'||request.method!=='POST')throw new HttpError(404,'Not found.');
    if(!session)throw new HttpError(401,'Open the workspace first.');
    if(request.headers.get('x-csrf-token')!==session.csrf||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new HttpError(403,'Workspace origin rejected.');
    const input=await readBody(request);
    if(typeof input.requestId!=='string'||! /^[a-f0-9-]{36}$/.test(input.requestId))throw new HttpError(400,'Invalid operation reference.');
    try{validateCommand(input.command);}catch(error){throw new HttpError(400,error.message);}
    if(!await online(db,env))throw new HttpError(503,'The PC-backed workspace is offline. Reconnect the service to continue.');
    await count(db,'owner:'+session.id+':'+Math.floor(now/3600000),100,now+3600000);
    if(input.command.op==='propose'){await count(db,'ai-global:'+Math.floor(now/3600000),16,now+3600000);await count(db,'ai-owner:'+session.id+':'+Math.floor(now/3600000),4,now+3600000);}
    return json(200,await requestWork(db,session.id,input.requestId,input.command,options));
  } catch(error){return json(error.status??502,{error:error.status?error.message:'The service could not return a result. Check receipts before retrying.'});}
}
