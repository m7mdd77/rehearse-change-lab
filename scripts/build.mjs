import{mkdirSync,cpSync,copyFileSync,readFileSync,writeFileSync}from'node:fs';
mkdirSync('outputs/local',{recursive:true});cpSync('web','outputs/local',{recursive:true});mkdirSync('site/public',{recursive:true});mkdirSync('site/lib',{recursive:true});
for(const name of['app.js','style.css'])copyFileSync('web/'+name,'site/public/'+name);
copyFileSync('src/contract.js','site/lib/contract.js');writeFileSync('site/lib/api.js',readFileSync('hosted/api.js','utf8').replace("'../src/contract.js'","'./contract.js'"));
const html=readFileSync('web/index.html','utf8'),body=html.match(/<body>([\s\S]*)<\/body>/)[1];
writeFileSync('site/app/page.tsx','export default function Page(){return <div style={{display:"contents"}} dangerouslySetInnerHTML={{__html:'+JSON.stringify(body)+'}}/>;}\n');
writeFileSync('site/app/layout.tsx',`import type{ReactNode}from'react';
export const metadata={title:'Rehearse — preview the blast radius',description:'Simulate exact database changes, review their effects, and recover when reality disagrees.'};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><head><link rel="stylesheet" href="/style.css"/><script type="module" src="/app.js"/></head><body>{children}</body></html>;}
`);
mkdirSync('site/app/api/[...path]',{recursive:true});writeFileSync('site/app/api/[...path]/route.ts',`import{env}from'cloudflare:workers';import{api}from'../../../lib/api.js';export const dynamic='force-dynamic';export const GET=(request:Request)=>api(request,env);export const POST=(request:Request)=>api(request,env);\n`);
console.log('Local and hosted source prepared.');
