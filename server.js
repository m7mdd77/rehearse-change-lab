import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Workspace } from './src/workspace.js';
import { proposer, configuration } from './src/ai.js';
const port=Number(process.env.PORT??3281),origin=`http://127.0.0.1:${port}`,root=resolve('outputs/local'),ai=proposer(resolve('data/ai'),{config:configuration()}),sessions=new Map();let chain=Promise.resolve();
const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
async function body(req,max){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Error('Request too large.');chunks.push(c);}return Buffer.concat(chunks);}
async function handler(req,res){try{
  const url=new URL(req.url,origin),cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('rehearse='))?.slice(9);let session=sessions.get(cookie);
  if(url.pathname==='/api/config'&&req.method==='GET'){if(!session){session={id:randomUUID(),csrf:randomUUID()};sessions.set(session.id,session);}return json(res,200,{connected:true,csrf:session.csrf},{'Set-Cookie':`rehearse=${session.id}; HttpOnly; SameSite=Strict; Path=/`});}
  if(url.pathname==='/api/work'&&req.method==='POST'){
    if(!session||req.headers['x-csrf-token']!==session.csrf||req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Workspace origin rejected.'});
    if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON required.'});
    const input=JSON.parse((await body(req,8000)).toString());let workspace;
    try{workspace=new Workspace(resolve('data/local-workspaces',session.id),{propose:ai});return json(res,200,await workspace.handle(input.command,input.requestId));}finally{workspace?.close();}
  }
  if(url.pathname==='/api/recording'&&req.method==='POST'){
    if(req.headers.origin!==origin||req.headers['x-rehearse-request']!=='1'||req.headers['content-type']!=='video/webm')return json(res,403,{error:'Recording origin rejected.'});
    const bytes=await body(req,30000000);mkdirSync('outputs',{recursive:true});const name='walkthrough-'+Date.now()+'.webm';writeFileSync(join('outputs',name),bytes);return json(res,200,{saved:true,name,bytes:bytes.length});
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
  const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+'/')&&!path.startsWith(root+'\\'))return json(res,404,{error:'Not found.'});
  if(!existsSync(path)||name.includes('..'))return json(res,404,{error:'Not found.'});
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.mp4':'video/mp4'}[extname(path)]??'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'"});res.end(readFileSync(path));
}catch{json(res,400,{error:'The request could not finish. Check receipts before retrying an execution.'});}}
const server=createServer((req,res)=>{chain=chain.then(()=>handler(req,res)).catch(()=>{});});
server.listen(port,'127.0.0.1',()=>console.log('Rehearse ready at '+origin));
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{ai.close();process.exit(0);}));
