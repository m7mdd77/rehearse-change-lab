import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { Workspace } from './src/workspace.js';
import { proposer, configuration } from './src/ai.js';
mkdirSync('data/workspaces',{recursive:true});
if(!existsSync('data/worker-token'))writeFileSync('data/worker-token',randomBytes(32).toString('hex'),{mode:0o600});
const token=readFileSync('data/worker-token','utf8').trim();
const base=process.env.REHEARSE_SITE_URL??'https://rehearse-change-lab.choggyacc.chatgpt.site';
if(base!=='https://rehearse-change-lab.choggyacc.chatgpt.site'&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Unapproved Site.');
const config=configuration(),ai=proposer(resolve('data/ai'),{config});
async function remote(path,data){const r=await fetch(base+'/api/worker/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Service unavailable.');return r.json();}
let stop=false,connected=false;const timer=setInterval(()=>remote('ping',{}).catch(()=>{}),5000);for(const s of['SIGINT','SIGTERM'])process.on(s,()=>{stop=true;clearInterval(timer);});
console.log('Rehearse worker connecting.');
while(!stop){try{const{job}=await remote('claim',{});if(!connected){console.log('Rehearse worker connected.');connected=true;}if(job){let completion,workspace;try{
  if(!/^[a-f0-9-]{36}$/.test(job.owner))throw Error('Invalid workspace.');const directory=join(resolve('data/workspaces'),job.owner);
  if(!existsSync(directory)&&readdirSync('data/workspaces',{withFileTypes:true}).filter(e=>e.isDirectory()).length>=100)throw Error('Workspace capacity reached.');
  workspace=new Workspace(directory,{propose:ai});const data=await workspace.handle(job.command,job.id);completion={jobId:job.id,failed:false,data};
}catch{completion={jobId:job.id,failed:true};}finally{workspace?.close();}
try{await remote('complete',completion);console.log(completion.failed?'Operation failed safely.':'Workspace result delivered.');}catch{console.log('Result delivery interrupted. Inspect workspace receipts before retrying.');}job.command=null;completion=null;}}
catch{if(connected){connected=false;console.log('Service connection interrupted; reconnecting.');}}if(!stop)await new Promise(r=>setTimeout(r,1200));}
ai.close();
