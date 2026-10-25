const $=selector=>document.querySelector(selector);
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const names={tickets:'Tickets',notes:'Notes',attachments:'Attachments',customers:'Customers'};
let csrf='',connected=false,busy=false,state,preview,lastReceipt;
function status(text){$('#status').textContent=text;}
function action(label,fn,className='secondary') {const button=el('button',label,className);button.type='button';button.dataset.request='1';button.addEventListener('click',fn);return button;}
function controls() {
  for(const field of document.querySelectorAll('#intent,#team,#cutoff'))field.disabled=busy;
  for(const button of document.querySelectorAll('#draft,#simulate,[data-request]'))button.disabled=busy||!connected||(button.dataset.preview==='1'&&(!preview||preview.used||!preview.allowed||Date.now()>=preview.expiresAt));
  const fault=$('#fault');if(fault)fault.disabled=busy||!connected||preview?.used;
}
async function configure() {
  try{const response=await fetch('/api/config');if(!response.ok)throw Error();const data=await response.json();csrf=data.csrf;connected=data.connected;}
  catch{connected=false;}
  $('#connection').textContent=connected?'Workspace connected':'Workspace offline';$('#connection-dot').classList.toggle('online',connected);controls();return connected;
}
async function request(command) {
  if(busy)throw Error('Another operation is still in progress.');if(!connected)throw Error('The PC-backed workspace is offline. Reconnect it to continue.');
  busy=true;controls();
  try{
    const response=await fetch('/api/work',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({requestId:crypto.randomUUID(),command}),signal:AbortSignal.timeout(65000)}),result=await response.json();
    if(result.state){state=result.state;renderState();}
    if(!response.ok)throw Error(result.error??'Workspace unavailable. Check receipts before retrying.');
    if(result.ok===false)throw Error(result.error.message);return result;
  }catch(error){if(error.name==='TimeoutError')throw Error('The response timed out. Refresh receipts before retrying an execution.');throw error;}
  finally{busy=false;controls();}
}
function currentPlan(){return {team:$('#team').value,status:'resolved',closedBefore:$('#cutoff').value,excludeHeld:true};}
function discardPreview(){preview=null;renderPreview();}
for(const id of ['#team','#cutoff'])$(id).addEventListener('input',()=>{discardPreview();$('#proposal').hidden=true;status('The filter changed. Simulate again before executing.');});
$('#intent').addEventListener('input',()=>{$('#proposal').hidden=true;});
$('#intent-form').addEventListener('submit',async event=>{
  event.preventDefault();status('Sol is drafting a filter. No records will change.');
  try{
    const {proposal:p}=await request({op:'propose',intent:$('#intent').value});const box=$('#proposal');box.replaceChildren(el('strong',p.decision==='plan'?'DRAFTED BY LIVE SOL':'ONE CLARIFICATION FIRST'),el('span',p.reason));box.hidden=false;
    if(p.decision==='plan'){$('#team').value=p.plan.team;$('#cutoff').value=p.plan.closedBefore;discardPreview();status('Review the drafted filter, then simulate its actual effects.');}
    else status('Sol needs clarification. Nothing was changed.');
  }catch(error){status(error.message);}
});
$('#filter-form').addEventListener('submit',async event=>{
  event.preventDefault();status('Running the exact deletion on a copy of your database…');
  try{const result=await request({op:'simulate',plan:currentPlan()});preview=result.preview;renderPreview();status(preview.allowed?'Preview ready. The source database has not changed.':'This batch is too broad or empty. Revise the filter and simulate again.');$('#preview-panel').scrollIntoView({behavior:'smooth',block:'start'});}
  catch(error){status(error.message);}
});
function renderPreview() {
  if(!preview){$('#preview-panel').replaceChildren(el('div','02 · REHEARSE THE EFFECTS','section-label'));const empty=el('div',undefined,'empty-preview'),art=el('div',undefined,'rehearsal-art');art.setAttribute('aria-hidden','true');art.append(el('span','▤','art-node'),el('span','','art-line'),el('span','▤','art-node ghost'),el('span','↗','art-cursor'));empty.append(art,el('h2','A preview, before a point of no return.'),el('p','We’ll try the exact deletion on a copy of your database and show what changes—including the records attached to it.'));const pills=el('div',undefined,'empty-pills');for(const text of['Direct effects','Cascades','Recovery path'])pills.append(el('span',text));empty.append(pills);$('#preview-panel').append(empty);return;}
  const p=preview,panel=$('#preview-panel'),top=el('div',undefined,'preview-title');panel.replaceChildren(el('div','02 · REHEARSE THE EFFECTS','section-label'));
  const title=el('div');title.append(el('h2',p.allowed?'Here’s the blast radius.':'Narrow the change.'),el('p',`Resolved ${p.plan.team==='all'?'tickets across all teams':p.plan.team+' tickets'} · closed before ${p.plan.closedBefore} · database v${p.baseVersion}`));top.append(title,el('span',p.used?'Reviewed preview':p.allowed?'Source unchanged':'Execution blocked','pill'+(!p.allowed?' blocked':'')));panel.append(top);
  const stats=el('div',undefined,'impact-grid');for(const [value,label]of[[p.counts.total,'records to remove'],[p.impactedCustomers.length,'customers impacted'],[p.preserved.tickets,'tickets preserved']]){const stat=el('div',undefined,'impact-stat');stat.append(el('b',String(value)),el('span',label));stats.append(stat);}panel.append(stats);
  const table=el('table',undefined,'diff-table'),head=el('thead'),hr=el('tr');for(const label of['RECORD TYPE','BEFORE','AFTER','CHANGE'])hr.append(el('th',label));head.append(hr);table.append(head);const body=el('tbody');
  for(const name of['tickets','notes','attachments','customers']){const row=el('tr'),delta=p.afterCounts[name]-p.beforeCounts[name];row.append(el('td',names[name]),el('td',String(p.beforeCounts[name]),'muted'),el('td',String(p.afterCounts[name])),el('td',delta?String(delta):'—',delta?'delta':'muted'));body.append(row);}table.append(body);panel.append(table);
  const affected=el('section',undefined,'affected');affected.append(el('h3','Directly affected tickets'));for(const ticket of p.effects.tickets.deleted){const row=el('div',undefined,'affected-row'),left=el('div');left.append(el('strong',ticket.id+' · '+ticket.title),el('p',state.data.customers.find(c=>c.id===ticket.customer_id)?.name??ticket.customer_id));row.append(left,el('span',ticket.closed_at+' · resolved'));affected.append(row);}if(!p.effects.tickets.deleted.length)affected.append(el('p','No tickets match.','muted'));panel.append(affected);
  const details=el('details',undefined,'cascade-details');details.append(el('summary',`${p.counts.notes} notes and ${p.counts.attachments} attachments follow through database cascades`));for(const name of['notes','attachments'])details.append(el('p',names[name]+': '+(p.effects[name].deleted.map(r=>r.id).join(', ')||'none')));panel.append(details);
  const recovery=el('div',undefined,'recovery');recovery.append(el('h3','↶ The recovery path'),el('p',p.rollback));panel.append(recovery,el('p',`✓ Held tickets preserved: ${p.preserved.held.join(', ')}. Open tickets and all customer preferences stay unchanged.`,'protected-line'));
  if(!p.allowed)panel.append(el('div',p.reasons.join(' '),'blocked-reason'));
  const buttons=el('div',undefined,'decision-buttons'),execute=action(p.used?'Preview already used':'Execute reviewed deletion',executePreview,'primary');execute.dataset.preview='1';
  buttons.append(execute,action('Revise filter',()=>{discardPreview();$('#team').focus();status('Choose a narrower filter, then simulate again.');}));panel.append(buttons);
  const safety=el('details',undefined,'safety-net');safety.append(el('summary','Explore an unexpected side effect'));const label=el('label',undefined,'fault-label'),check=el('input');check.type='checkbox';check.id='fault';check.checked=Boolean(state.faultArmed);check.addEventListener('change',async()=>{const enabled=check.checked;try{await request({op:'fault',enabled});status(enabled?'The faulty adapter is armed for the next execution. The transaction guard remains active.':'The faulty adapter is off.');}catch(error){check.checked=state.faultArmed;status(error.message);}});label.append(check,el('span','Inject an unpredicted customer preference change'));safety.append(label,el('p','The preview assumes no customer changes. The execution guard should catch this extra write and roll back the whole transaction.'));panel.append(safety);controls();
}
async function executePreview() {
  if(!preview)return;status('Applying the reviewed deletion and checking its actual effects before commit…');
  try{const result=await request({op:'execute',previewId:preview.id});preview.used=true;lastReceipt=result.receipt;renderPreview();renderResult();status(lastReceipt.type==='contained'?'Prediction mismatch contained. All domain changes rolled back.':'The actual effects matched. The deletion was committed.');$('#result-panel').scrollIntoView({behavior:'smooth',block:'center'});}
  catch(error){status(error.message);}
}
function renderResult() {
  const box=$('#result-panel');if(!lastReceipt){box.hidden=true;return;}const r=lastReceipt;box.hidden=false;box.className='card result-panel '+r.type;
  const heading=r.type==='contained'?'Prediction mismatch. Nothing committed.':r.type==='restored'?'Restored. Every record is back.':'The change is committed.';
  box.replaceChildren(el('div',r.type==='contained'?'SAFETY NET · TRANSACTION ROLLED BACK':r.type==='restored'?'RECOVERY COMPLETE':'03 · EXECUTION VERIFIED','section-label'),el('h2',heading),el('p',r.summary));
  if(r.type==='contained')for(const u of r.unexpected)box.append(el('p',`${u.id} · ${u.field}: predicted “${u.before}”; attempted “${u.attempted}”. The original value is preserved.`));
  if(r.type==='executed')box.append(action('Restore this deletion ↶',()=>rollbackRun(r.runId)));
  box.append(el('p','Receipt '+r.id,'receipt-id'));controls();
}
async function rollbackRun(runId) {
  status('Checking for later data changes before restoring the deleted records…');
  try{const result=await request({op:'rollback',runId});lastReceipt=result.receipt;renderResult();status('Restoration committed. All deleted records have been recovered.');}
  catch(error){status(error.message);}
}
function renderState() {
  if(!state)return;$('#workspace-version').textContent=`Database v${state.version} · ${state.data.tickets.length} tickets`;$('#ticket-badge').textContent=state.data.tickets.length;$('#receipt-badge').textContent=state.events.length;
  renderRecords();renderReceipts();
}
function renderRecords() {
  const panel=$('#records');panel.replaceChildren(el('h2','The source of truth.'),el('p',`${state.data.tickets.length} tickets · ${state.data.notes.length} notes · ${state.data.attachments.length} attachments`,'muted'));
  const scroll=el('div',undefined,'table-scroll'),table=el('table',undefined,'records-table'),head=el('thead'),hr=el('tr');for(const label of['TICKET','CUSTOMER / SUBJECT','TEAM','STATUS','CLOSED','PROTECTION'])hr.append(el('th',label));head.append(hr);table.append(head);const body=el('tbody');
  for(const t of state.data.tickets){const row=el('tr'),subject=el('td');subject.append(el('strong',state.data.customers.find(c=>c.id===t.customer_id)?.name??t.customer_id),el('p',t.title,'muted'));const stateCell=el('td'),hold=el('td');stateCell.append(el('span',t.status,'record-pill '+(t.status==='open'?'open':'')));hold.append(el('span',t.retention_hold?'Retention hold':'—',t.retention_hold?'record-pill hold':'muted'));row.append(el('td',t.id),subject,el('td',t.team),stateCell,el('td',t.closed_at??'—'),hold);body.append(row);}table.append(body);scroll.append(table);panel.append(scroll,el('h2','Customer preferences'));
  const customers=el('div',undefined,'customer-grid');for(const c of state.data.customers){const card=el('div',undefined,'customer');card.append(el('strong',c.name),el('p','Contact: '+c.contact_preference));customers.append(card);}panel.append(customers);
}
function renderReceipts() {
  const panel=$('#receipts');panel.replaceChildren();panel.append(action('Refresh receipts',async()=>{try{await request({op:'state'});status('Loaded the current database and receipts.');}catch(error){status(error.message);}}));
  if(!state.events.length){panel.append(el('p','No execution yet. Your first completed or contained change will appear here.','receipts-empty'));return;}
  for(const e of state.events){const row=el('article',undefined,'receipt'),content=el('div');row.append(el('span',e.type==='contained'?'!':e.type==='restored'?'↶':'✓','receipt-icon'));content.append(el('h3',e.type==='contained'?'Unpredicted effect contained':e.type==='restored'?'Deletion restored':'Deletion committed'),el('p',e.summary),el('time',new Date(e.at).toLocaleString()),el('p','Receipt '+e.id,'receipt-id'));
    if(e.type==='executed'&&!state.events.some(other=>other.type==='restored'&&other.runId===e.runId))content.append(action('Restore deletion ↶',async()=>{showView('review');await rollbackRun(e.runId);$('#result-panel').scrollIntoView({behavior:'smooth',block:'center'});}));row.append(content);panel.append(row);
  }controls();
}
function showView(name){for(const view of['review','records','receipts']){$('#'+view+'-view').hidden=view!==name;$('#'+view+'-tab').classList.toggle('active',view===name);$('#'+view+'-tab').setAttribute('aria-pressed',String(view===name));}}
for(const name of['review','records','receipts'])$('#'+name+'-tab').addEventListener('click',()=>showView(name));
try{await configure();if(connected){await request({op:'state'});status('Your workspace is ready. Draft a filter or choose one directly.');}else status('The PC-backed workspace is offline. Reconnect the service to begin.');}catch(error){status(error.message);}
setInterval(configure,10000);setInterval(controls,2000);
