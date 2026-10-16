import type{ReactNode}from'react';
export const metadata={title:'Rehearse — preview the blast radius',description:'Simulate exact database changes, review their effects, and recover when reality disagrees.'};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><head><link rel="stylesheet" href="/style.css"/><script type="module" src="/app.js"/></head><body>{children}</body></html>;}
