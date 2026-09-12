const $=id=>document.getElementById(id),states={not_requested:'Not requested',waiting:'Waiting for inputs',idle:'Queued',queued:'Queued',running:'Running',completed:'Complete',failed:'Failed',blocked:'Blocked',cancelled:'Cancelled'};
let data=null,selected='cpue_vessel',view='tasks',outputSource='',fileTicket=0,downloadURL='';
let jobKey='',jobTab='outputs',jobLogBusy=false;
const names={submission:'Data submission',qc:'Data QC',ingest:'Prepare & load',cpue_summary:'CPUE results summary',cpue_report:'CPUE report',extract:'Extract',cpue_vessel:'CPUE analysis A',cpue_year:'CPUE analysis B',prepare_vessel:'Input prep A',prepare_year:'Input prep B',assessment_vessel_ref:'Assessment A · config 1',assessment_vessel_high_m:'Assessment A · config 2',assessment_year_ref:'Assessment B · config 1',assessment_year_high_m:'Assessment B · config 2',synthesis:'Results summary',report:'Assessment report'};
const tasks={
 submission:{name:'Data submission',owner:'Korea',role:'Data provider'},
 qc:{name:'Data quality check',owner:'Jessica',role:'Data team'},
 ingest:{name:'Prepare & load',owner:'Tiffany',role:'Data team'},
 extract:{name:'Data extraction',owner:'Jessica',role:'Data team'},
 cpue:{name:'CPUE analysis',owner:'Nan',role:'CPUE analyst'},
 inputs:{name:'Input preparation',owner:'Thom',role:'Data and assessment teams'},
 assessment:{name:'Stock assessment',owner:'Kyuhan',role:'Assessment analyst'},
 synthesis:{name:'Results summary',owner:'Paul',role:'Assessment team'},
 report:{name:'Assessment report',owner:'Kyuhan',role:'Author and reviewers'}
};
const taskFor=key=>key.startsWith('prepare_')?'inputs':key.split('_')[0];
let taskFilter=new URL(location.href).searchParams.get('task')||'all';if(taskFilter!=='all'&&!tasks[taskFilter])taskFilter='all';
for(const [value,label] of [['all','All tasks'],...Object.entries(tasks).map(([key,t])=>[key,t.name])]){const option=document.createElement('option');option.value=value;option.textContent=label;$('task-filter').append(option);}
$('task-filter').value=taskFilter;$('task-filter').onchange=()=>{taskFilter=$('task-filter').value;draw();};
$('share-task').onclick=async()=>{const url='https://kyuhank.github.io/cpue-actions-demo/guest.html'+(taskFilter==='all'?'':'?task='+taskFilter);try{await navigator.clipboard.writeText(url);$('share-task').textContent='Link copied';setTimeout(()=>$('share-task').textContent='Share task link',1800);}catch{$('share-url').hidden=false;$('share-url').value=url;$('share-url').select();}};
function jobState(stage){
 if(data.has_run===false)return {key:'ready',label:'Ready',icon:'○'};
 if(stage.reused)return {key:'reused',label:'Reused',icon:'↺'};
 if(stage.skipped||stage.status==='not_requested')return {key:'not_requested',label:'Not requested',icon:'–'};
 const correction=data.stages.find(s=>s.key==='qc')?.correction_phase;
 if(stage.key==='submission'&&correction==='resubmitting')return {key:'running',label:'Resubmitting',icon:'▶'};
 if(stage.key==='qc'){
  if(correction==='returned')return {key:'returned',label:'Returned for correction',icon:'↩'};
  if(correction==='resubmitting')return {key:'waiting',label:'Awaiting resubmission',icon:'○'};
  if(correction==='rechecking')return {key:'running',label:'Checking again',icon:'▶'};
  if(correction==='corrected')return {key:'completed',label:'Complete',icon:'✓'};
 }
 const key=stage.status||'waiting';
 return {key,label:states[key]||key,icon:({running:'▶',completed:'✓',failed:'✕',blocked:'!',cancelled:'–',queued:'◷',idle:'◷'})[key]||'○'};
}
function statusSymbol(state){
 const shapes={running:'<path d="M17 10a7 7 0 1 1-7-7"/>',completed:'<path d="m4 10 4 4 8-9"/>',failed:'<path d="m10 2 8 15H2zM10 7v4m0 3v.2"/>',blocked:'<circle cx="10" cy="10" r="7"/><path d="M6 10h8"/>',cancelled:'<path d="m5 5 10 10M5 15 15 5"/>',waiting:'<circle cx="10" cy="10" r="7"/><path d="M10 5v5l3 2"/>',reused:'<path d="M4 7a7 7 0 1 1-1 6M4 3v5h5"/>',returned:'<path d="m7 4-4 4 4 4M3 8h9a5 5 0 0 1 0 10"/>',ready:'<circle cx="10" cy="10" r="6"/>',not_requested:'<path d="M5 10h10"/>'};
 const key=['queued','idle'].includes(state)?'waiting':Object.hasOwn(shapes,state)?state:'ready';
 return '<svg class="status-symbol '+key+'" data-status-icon="'+key+'" viewBox="0 0 20 20" aria-hidden="true">'+shapes[key]+'</svg>';
}
function statusBadge(state){
 const badge=document.createElement('span');badge.className='status-badge '+state.key;
 const icon=document.createElement('span');icon.className='status-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=statusSymbol(state.key);
 const text=document.createElement('span');text.textContent=state.label;badge.append(icon,text);return badge;
}
const shortNames={cpue_vessel:'Analysis A',cpue_year:'Analysis B',cpue_summary:'Results summary',cpue_report:'CPUE report',prepare_vessel:'Inputs A',prepare_year:'Inputs B',assessment_vessel_ref:'A1',assessment_vessel_high_m:'A2',assessment_year_ref:'B1',assessment_year_high_m:'B2'};
function taskStatus(jobs){
 const list=jobs.map(jobState),running=jobs.filter((s,i)=>list[i].key==='running');
 if(running.length)return {key:'running',icon:'▶',label:running.length+' running',running};
 for(const key of ['failed','returned','blocked','cancelled'])if(list.some(s=>s.key===key))return {...list.find(s=>s.key===key),running:[]};
 if(!jobs.length||data.has_run===false)return {key:'ready',label:'Ready',icon:'○',running:[]};
 if(list.every(s=>['completed','reused','not_requested'].includes(s.key))){
  const key=list.every(s=>s.key==='not_requested')?'not_requested':list.some(s=>s.key==='completed')?'completed':'reused';
  return {key,label:({completed:'Complete',reused:'Reused',not_requested:'Not requested'})[key],icon:key==='completed'?'✓':key==='reused'?'↺':'–',running:[]};
 }
 const queued=list.some(s=>['queued','idle'].includes(s.key));
 return {key:queued?'queued':'waiting',label:queued?'Queued':'Waiting',icon:queued?'◷':'○',running:[]};
}
function taskCards(){
 for(const [key,t] of Object.entries(tasks)){
  let card=$('task-cards').querySelector('[data-task="'+key+'"]');
  if(!card){
   card=document.createElement('button');card.dataset.task=key;
   const title=document.createElement('strong');title.textContent=t.name;
   const owners=document.createElement('span');owners.className='owners';owners.textContent='Owner · '+t.owner;
   const status=document.createElement('span');status.className='task-status';
   const activity=document.createElement('span');activity.className='task-activity';
   card.append(title,owners,status,activity);
   card.onclick=()=>{taskFilter=key;$('task-filter').value=key;show('jobs');draw();};$('task-cards').append(card);
  }
  const jobs=data.stages.filter(s=>taskFor(s.key)===key),state=taskStatus(jobs);
  card.className='task-card is-'+state.key;card.dataset.state=state.key;
  const count=document.createElement('span');count.className='task-count';count.textContent=jobs.length+(jobs.length===1?' job':' jobs');
  card.querySelector('.task-status').replaceChildren(statusBadge(state),count);
  const activity=card.querySelector('.task-activity');
  activity.textContent=state.running.length?'Now · '+state.running.map(s=>shortNames[s.key]||names[s.key]).join(' · '):state.key==='completed'?jobs.filter(s=>jobState(s).key==='completed').length+' complete'+(jobs.some(s=>s.reused)?' · '+jobs.filter(s=>s.reused).length+' reused':''):state.key==='reused'?'Saved outputs kept unchanged':state.key==='returned'?'Provider correction needed':state.key==='failed'?'Open the job to see the reason':state.key==='waiting'?'Waiting for upstream jobs':state.key==='queued'?'Ready when the next group starts':state.key==='blocked'?'An input job has not succeeded':'Select to inspect jobs';
 }
}

function show(next){closeOutputs();view=next;for(const id of ['tasks','jobs','dependencies','cluster'])$(id).hidden=id!==view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));$('purpose').textContent={tasks:'Tasks organise jobs. Dependencies connect them into a workflow.',jobs:'Follow each model run, see what it waits for, and inspect its outputs.',dependencies:'Identify the inputs a job needs and the jobs that use its result.',cluster:'Track the compute running your team’s jobs.'}[view];if(data)detail();}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>show(b.dataset.view);
function detail(){const stage=data.stages.find(s=>s.key===selected)||data.stages[0];selected=stage.key;$('stage').value=selected;$('graph').replaceChildren();const children=data.stages.filter(s=>(s.parents||[]).includes(selected)).map(s=>s.key);for(const keys of [stage.parents||[],[selected],children].filter(a=>a.length)){if($('graph').children.length){const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='→';$('graph').append(arrow)}const group=document.createElement('div');group.className='group';for(const key of keys){const node=document.createElement('div');node.className='node'+(key===selected?' current':'');node.textContent=names[key]||key;const state=document.createElement('small');state.textContent=states[data.stages.find(s=>s.key===key).status]||'Waiting';node.append(state);group.append(node)}$('graph').append(group)}$('rule').textContent=stage.parents?.length?'Required inputs are recorded explicitly. The stage waits until those inputs are available.':'A newly published database snapshot starts extraction.';const source=stage.code_source;$('code-source').replaceChildren();$('code-source').hidden=!source;if(source){const link=document.createElement('a');link.href='https://github.com/'+source.repository+'/commit/'+source.commit;link.target='_blank';link.rel='noopener';link.textContent=source.repository.replace('kyuhank/','')+' · '+source.branch+' @ '+source.commit.slice(0,8);$('code-source').append('Code: ',link);}}
$('stage').onchange=()=>{selected=$('stage').value;detail();};
function draw(){taskCards();const rows=data.stages.filter(s=>taskFilter==='all'||taskFor(s.key)===taskFilter).map(s=>{const state=jobState(s),tr=document.createElement('tr');tr.dataset.key=s.key;tr.className='job-row is-'+state.key;const name=document.createElement('td'),button=document.createElement('button');button.textContent=names[s.key]||s.label;button.onclick=()=>openJob(s);name.append(button);const identity=document.createElement('small');identity.className='job-detail';identity.textContent=data.has_run?'Run #'+data.number+(s.reused?' · reused result':''):'Ready to run';name.append(identity);tr.append(name);const seconds=s.started_at&&s.completed_at?Math.max(0,(Date.parse(s.completed_at)-Date.parse(s.started_at))/1000)+' s':'—';for(const text of [state.label,(s.parents||[]).map(k=>names[k]||k).join(' + ')||'New data snapshot',seconds]){const td=document.createElement('td');td.textContent=text;tr.append(td)}tr.children[1].replaceChildren(statusBadge(state));const assignment=tasks[taskFor(s.key)],people=document.createElement('td'),owner=document.createElement('strong');people.className='job-people';owner.textContent=assignment.owner;people.append(owner);tr.insertBefore(people,tr.children[2]);const cell=document.createElement('td'),outputs=document.createElement('button');outputs.textContent='View outputs';outputs.disabled=!data.has_run||!['completed','failed'].includes(s.status);outputs.title=outputs.disabled?'Outputs become available when this job succeeds':'Inspect this stage’s actual files';outputs.onclick=()=>openOutputs(s);cell.append(outputs);tr.append(cell);return tr});$('rows').replaceChildren(...rows);if(!$('stage').options.length){for(const s of data.stages){const option=document.createElement('option');option.value=s.key;option.textContent=names[s.key]||s.label;$('stage').append(option)}}detail();$('run').href=data.run_url;$('run').textContent=data.has_run===false?'Ready':'GitHub run #'+data.number+' ↗';if(data.has_run===false)$('run').removeAttribute('href');$('notice').textContent=data.has_run===false?'Ready for a new demonstration':(data.source?.stale?'Last verified state · ':'')+'Actual GitHub execution · '+data.status.replaceAll('_',' ')+' · data '+data.commit.slice(0,8);const runners=[...new Set((data.execution?.jobs||[]).map(j=>j.runner_name).filter(Boolean))];$('runner').textContent=runners.length+' runners assigned';$('compute-description').textContent=data.execution?.mode==='module_jobs'?'Each executed job has its own runner and pinned container. Dependencies coordinate the jobs; unchanged outputs are reused.':'The current run shares one runner. Independent model jobs still run in parallel.';$('running').textContent=data.stages.filter(s=>jobState(s).key==='running').length;$('waiting').textContent=data.stages.filter(s=>['waiting','idle','queued'].includes(jobState(s).key)).length;$('complete').textContent=data.stages.filter(s=>s.status==='completed').length;$('verified').textContent='GitHub Actions API · verified '+new Date(data.source?.last_success).toLocaleTimeString();const report=data.stages.find(s=>s.key==='report');$('report').hidden=data.has_run===false||data.status!=='completed'||data.conclusion!=='success';const active=data.stages.filter(s=>jobState(s).key==='running');if(active.length&&!data.source?.stale){$('notice').className='activity-running';$('notice').innerHTML=statusSymbol('running')+active.length+(active.length===1?' job running':' jobs running')+' · '+[...new Set(active.map(s=>tasks[taskFor(s.key)].name))].join(' + ');}else $('notice').className='';if(jobKey){updateJob();if(jobTab==='log')loadJobLog();}}
async function refresh(){if(window.workshopActive===false)return;try{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error();const next=await r.json();if(!next.ready)return;if(data&&data.run_id!==next.run_id)closeOutputs();data={...next,stages:[...(next.intake_stages||[]),...next.stages]};draw();if(parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');}catch(e){$('notice').textContent='Shared session unavailable. Waiting to reconnect…';}}
$('report').onclick=()=>{const stage=data?.stages.find(s=>s.key==='report');if(stage)openOutputs(stage);};
const fileLabels={'submission.json':'Submitted records','receipt.json':'Submission receipt','quality.json':'Quality check and corrections','release.json':'Published release','prepared.json':'Prepared batch','comparison.csv':'CPUE comparison','results.html':'Analysis results · HTML','cpue.csv':'CPUE index','cpue-diagnostics.txt':'CPUE diagnostics','assessment-input.csv':'Prepared assessment input','biomass.csv':'Biomass trajectory','summary.csv':'Model summary','sets.csv':'Extracted sets','catch.csv':'Extracted catch','cpue.svg':'CPUE comparison','biomass.svg':'Assessment comparison','manifest.json':'Data and code provenance','record.json':'Execution record','report.html':'Report'};
function closeOutputs(){++fileTicket;outputSource='';jobKey='';$('files-view').hidden=true;if(downloadURL){URL.revokeObjectURL(downloadURL);downloadURL='';}}
$('files-back').onclick=closeOutputs;
$('file-choice').onchange=()=>loadFile($('file-choice').value);
function updateJob(){
 const stage=data?.stages.find(s=>s.key===jobKey);if(!stage)return;
 const state=jobState(stage);$('job-state').replaceChildren(statusBadge(state),document.createTextNode(data.has_run?' · Run #'+data.number:''));
 $('job-state').className='';
 const task=tasks[taskFor(stage.key)];$('job-owners').textContent='Owner: '+task.owner;
 $('job-page').hidden=!data.has_run||!['completed','failed'].includes(stage.status);$('job-page').href=['submission','qc','ingest'].includes(stage.key)?stage.html_url:'https://kyuhank.github.io/cpue-demo-'+taskFor(stage.key)+'/?job='+encodeURIComponent(stage.source_id);$('job-run').hidden=!stage.html_url;$('job-run').href=stage.html_url||data.run_url;
 $('job-outputs').disabled=!data.has_run||!['completed','failed'].includes(stage.status);
 $('file-info').textContent=stage.reused?'Verified output · original execution retained':'Generated by this job';
}
function jobView(tab){jobTab=tab;++fileTicket;$('file-tools').hidden=tab!=='outputs';$('file-download').hidden=true;$('job-outputs').classList.toggle('selected',tab==='outputs');$('job-log').classList.toggle('selected',tab==='log');}
function openJob(stage,tab){
 closeOutputs();jobKey=stage.key;selected=stage.key;outputSource=stage.source_id;
 $('files-view').hidden=false;$('files-title').textContent=names[stage.key];$('file-choice').replaceChildren();updateJob();
 jobView(tab||(stage.status==='completed'&&data.has_run?'outputs':'log'));
 if(jobTab==='outputs')loadOutputs();else{$('file-content').textContent='Connecting to GitHub…';loadJobLog();}
}
function openOutputs(stage){openJob(stage,'outputs');}
$('job-outputs').onclick=()=>{jobView('outputs');loadOutputs();};
$('job-log').onclick=()=>{jobView('log');$('file-content').textContent='Connecting to GitHub…';loadJobLog();};
async function loadJobLog(){
 if(!jobKey||jobTab!=='log'||jobLogBusy)return;
 const key=jobKey,ticket=fileTicket;jobLogBusy=true;
 try{const r=await fetch('/api/stage-log?stage='+encodeURIComponent(key),{cache:'no-store'});if(!r.ok)throw Error('Execution log is not available yet.');const record=await r.json();if(key!==jobKey||jobTab!=='log'||ticket!==fileTicket)return;
  const label=document.createElement('p');label.className='log-source';label.textContent=(record.source||'GitHub execution record')+' · '+(record.source==='GitHub log'?'recorded console output':'live job steps');
  const pre=document.createElement('pre');pre.textContent=(record.lines||[]).join('\n')||'Waiting for execution.';$('file-content').replaceChildren(label,pre);
 }catch(error){if(key===jobKey&&jobTab==='log'&&ticket===fileTicket)$('file-content').textContent=error.message;}
 finally{jobLogBusy=false;}
}
async function loadOutputs(){
 const ticket=++fileTicket;$('file-content').textContent='Loading actual job outputs…';$('file-choice').replaceChildren();
 try{const r=await fetch('/api/outputs?job='+encodeURIComponent(outputSource));if(!r.ok)throw Error('Outputs are being published, or have expired. Reopen Outputs to try again.');const result=await r.json();if(ticket!==fileTicket)return;
  for(const file of result.files){const option=document.createElement('option');option.value=file;option.textContent=fileLabels[file]||file;$('file-choice').append(option);}
  if(!result.files.length)throw Error('This stage has no available output.');
  const preferred=result.files.includes('report.html')?'report.html':result.files.includes('results.html')?'results.html':result.files.find(f=>f.endsWith('.svg')||f.endsWith('.csv'))||result.files[0];$('file-choice').value=preferred;await loadFile(preferred);
 }catch(error){if(ticket===fileTicket)$('file-content').textContent=error.message;}
}
function csvRows(text){const rows=[];let row=[],value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(value.replace(/\r$/,''));value='';if(c==='\n'){rows.push(row);row=[];}}else value+=c;}if(value||row.length){row.push(value);rows.push(row);}return rows;}
function tablePreview(text){const rows=csvRows(text),headers=rows.shift()||[];const content=$('file-content');
 const year=headers.indexOf('year'),value=headers.indexOf(headers.includes('SB_over_SB0')?'SB_over_SB0':headers.includes('index')?'index':headers.includes('catch_t')?'catch_t':'');
 if(year>=0&&value>=0&&rows.length>2&&rows.length<200){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 720 190');svg.classList.add('file-chart');
  const groups=new Map(),group=headers.indexOf(headers.includes('scenario')?'scenario':headers.includes('choice')?'choice':'');
  for(const row of rows){const k=group>=0?row[group]:'';if(!groups.has(k))groups.set(k,[]);groups.get(k).push([Number(row[year]),Number(row[value])]);}
  const points=[...groups.values()].flat().filter(p=>p.every(Number.isFinite));if(points.length){const x0=Math.min(...points.map(p=>p[0])),x1=Math.max(...points.map(p=>p[0])),y0=0,y1=Math.max(...points.map(p=>p[1]))*1.08||1;let i=0;
   for(const v of [0,y1/2,y1]){const y=150-120*v/y1,grid=document.createElementNS(ns,'line');for(const [k,val] of Object.entries({x1:45,x2:685,y1:y,y2:y,stroke:'#e6eef2'}))grid.setAttribute(k,val);svg.append(grid);const label=document.createElementNS(ns,'text');label.setAttribute('x','4');label.setAttribute('y',y+4);label.textContent=Number(v.toPrecision(2)).toString();svg.append(label);}
   for(const line of groups.values()){const path=document.createElementNS(ns,'polyline');path.setAttribute('points',line.map(([x,y])=>`${45+640*(x-x0)/(x1-x0||1)},${150-120*(y-y0)/(y1-y0)}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',['#0085ca','#c87635','#32948b','#6c70a8'][i++%4]);path.setAttribute('stroke-width','2.5');svg.append(path);}
   for(const [x,y,t] of [[45,177,String(x0)],[655,177,String(x1)],[45,20,headers[value]==='index'?'Relative CPUE':headers[value]==='SB_over_SB0'?'Spawning biomass / unfished':headers[value]]]){const label=document.createElementNS(ns,'text');label.setAttribute('x',x);label.setAttribute('y',y);label.textContent=t;svg.append(label);}content.append(svg);}
 }
 const caption=document.createElement('p');caption.className='file-caption';caption.textContent=rows.length+' rows'+(rows.length>24?' · showing the first 24; download for all rows':'');content.append(caption);
 const table=document.createElement('table');for(const [i,row] of [headers,...rows.slice(0,24)].entries()){const tr=document.createElement('tr');for(const value of row){const cell=document.createElement(i?'td':'th');cell.textContent=i&&/^[+-]?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(value)&&/[.e]/i.test(value)?Number(value).toLocaleString('en',{maximumSignificantDigits:5}):value;tr.append(cell);}table.append(tr);}content.append(table);
}
async function loadFile(file){const ticket=++fileTicket,source=outputSource;$('file-content').textContent='Loading…';$('file-download').hidden=true;
 try{const r=await fetch('/api/output?job='+encodeURIComponent(source)+'&file='+encodeURIComponent(file));if(!r.ok)throw Error('This output is unavailable.');let text=await r.text();if(ticket!==fileTicket)return;
  $('file-content').replaceChildren();if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(new Blob([text],{type:'text/plain'}));$('file-download').href=downloadURL;$('file-download').download=file;$('file-download').hidden=false;
  if(file.endsWith('.csv'))tablePreview(text);
  else if(file.endsWith('.html')||file.endsWith('.svg')){const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-downloads allow-popups allow-popups-to-escape-sandbox');frame.title=fileLabels[file]||file;frame.srcdoc=text;$('file-content').append(frame);}
  else{const pre=document.createElement('pre');if(file.endsWith('.json'))text=JSON.stringify(JSON.parse(text),null,2);pre.textContent=text;$('file-content').append(pre);}
 }catch(error){if(ticket===fileTicket)$('file-content').textContent=error.message;}
}
if(taskFilter!=='all'){show('jobs');}refresh();setInterval(refresh,2500);

function intakeCard(){
 const card=document.createElement('button');card.className='task-card';const q=data?.data_intake?.quality_check,status=q?(q.accepted?'QC passed · records accepted':'QC failed · correction needed'):'Ready for submission';
 const title=document.createElement('strong');title.textContent='Data submission';const owner=document.createElement('span');owner.className='owners';owner.textContent='Korea · Data provider';const state=document.createElement('span');state.className='task-count';state.textContent=status;card.append(title,owner,state);
 card.onclick=()=>{$('intake-state').textContent=status;$('intake-record').textContent=q?JSON.stringify({submitted_by:'Korea',processing_owners:['Jessica','Tiffany'],accepted:q.accepted,version:q.proposed_version,records:q.rows_received,checks:q.checks,errors:q.errors},null,2):'Submission → QC → Prepare & load → Database';$('intake-details').showModal();};return card;
}
$('intake-close').onclick=()=>$('intake-details').close();
