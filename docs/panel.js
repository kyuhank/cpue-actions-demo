
const $=id=>document.getElementById(id);
const positions={cpue_summary:[7,1,5],cpue_report:[7,1,5],data:[1,1,5],extract:[3,1,5],cpue_vessel:[5,1,3],cpue_year:[5,3,5],prepare_vessel:[9,1,3],prepare_year:[9,3,5],assessment_vessel_ref:[11,1,2],assessment_vessel_high_m:[11,2,3],assessment_year_ref:[11,3,4],assessment_year_high_m:[11,4,5],synthesis:[13,1,5],report:[15,1,5]};
const names={submission:'Data submission',qc:'QC',ingest:'Prepare & load',cpue_summary:'Results summary',cpue_report:'CPUE report',data:'Database',extract:'Extract',cpue_vessel:'CPUE analysis A',cpue_year:'CPUE analysis B',prepare_vessel:'Input prep',prepare_year:'Input prep',assessment_vessel_ref:'Assessment 1',assessment_vessel_high_m:'Assessment 2',assessment_year_ref:'Assessment 1',assessment_year_high_m:'Assessment 2',synthesis:'Results summary',report:'Assessment report'};
const states={not_requested:'Not requested',waiting:'Waiting',queued:'Queued',idle:'Queued',running:'Running',completed:'Complete',failed:'Failed',blocked:'Blocked',cancelled:'Cancelled'},icons={completed:'✓',running:'◌',failed:'×',blocked:'×',cancelled:'–'};
let qualityRecordOpen=false,qualityAlertStamp=null;
let previewLog=null,previewLogPending=false,previewLogAt=0;
let dataDraft=null;
let branchCatalog=null,branchLoading=false,runRoots=null;const branchDrafts={};
let data=null,sending=false,expected='',selected=null,consoleRecord=null,consolePending=false,changeKind='data',lastRefresh=0,refreshing=false,previewKey=null,previewTimer=null;
const time=t=>t?new Date(t).toLocaleTimeString('en-GB',{hour12:false}):'';
const selectedKey=()=>selected||'data';
function pendingBranches(){return Object.fromEntries(Object.entries(branchDrafts).filter(([key,branch])=>branch!==branchCatalog?.sources[key]?.branch));}
function affected(){
 if(!data||(!selected&&!runRoots&&!Object.keys(pendingBranches()).length))return new Set();
 const roots=runRoots&&(sending||expected||data.status!=='completed')?runRoots:[...Object.keys(pendingBranches()),...(selected?[selected]:[])];
 if(dataDraft!==null&&dataDraft!=='new'&&Number(dataDraft)!==Number(data.database_version))return new Set(['data',...data.stages.map(s=>s.key)]);
 if(roots.includes('data')||(data.has_run===false&&!data.baseline_available))return new Set(data.stages.map(s=>s.key));
 const result=new Set(roots);
 let changed=true;while(changed){changed=false;for(const s of data.stages)if(!result.has(s.key)&&(s.parents||[]).some(p=>result.has(p))){result.add(s.key);changed=true;}}
 return result;
}
function plannedRoots(){
 const roots=[...new Set([selectedKey(),...Object.keys(pendingBranches())])];if(roots.includes('data'))return ['data'];
 const stages=new Map((data?.stages||[]).map(s=>[s.key,s]));
 const ancestors=key=>{const found=new Set(),todo=[...(stages.get(key)?.parents||[])];while(todo.length){const parent=todo.pop();if(found.has(parent))continue;found.add(parent);todo.push(...(stages.get(parent)?.parents||[]));}return found;};
 return roots.filter(key=>!roots.some(other=>other!==key&&ancestors(key).has(other)));
}
function nextSource(key){if(['submission','qc','ingest'].includes(key))return data?.intake_stages?.find(s=>s.key===key)?.code_source||branchCatalog?.intakeSource;return branchCatalog?.options[key]?.[branchDrafts[key]||branchCatalog?.sources[key]?.branch]||data?.stages.find(s=>s.key===key)?.code_source;}
function sourceLink(key){
 const link=node(key).querySelector('.source-link'),source=nextSource(key);
 link.hidden=key!=='data'&&!source;
 link.href=key==='data'?'https://kyuhank.github.io/cpue-actions-demo/data.html':source?'https://github.com/'+source.repository+'/tree/'+encodeURIComponent(source.branch):'#';
 link.title=key==='data'?'Open the synthetic database':source?'Open '+source.repository+' · '+source.branch:'';
 link.setAttribute('aria-label',link.title);
}
function node(key){
 let el=$('chain').querySelector(`[data-key="${key}"]`);if(el)return el;
 el=document.createElement('div');el.dataset.key=key;if(['cpue_summary','cpue_report'].includes(key))el.id=key;el.className=key==='data'?'data-node':'stage';
 const [col,start,end]=positions[key];el.style.gridColumn=col;el.style.gridRow=`${start} / ${end}`;
 const control=document.createElement('button');control.type='button';control.className='node-control';
 const title=document.createElement('strong');title.textContent=['cpue_vessel','cpue_year'].includes(key)?'CPUE analysis':names[key];control.append(title);
 if(key==='data'){const version=document.createElement('div');version.className='release';const qc=document.createElement('div');qc.className='qc';control.append(version,qc);}
 else{const state=document.createElement('small');state.innerHTML='<span class="state-icon"></span><span class="state-label"></span>';if(['cpue_vessel','cpue_year'].includes(key)){const variant=document.createElement('span');variant.className='analysis-variant';variant.textContent=key==='cpue_vessel'?'A':'B';state.prepend(variant);}control.append(state);if(key==='synthesis'){const output=document.createElement('span');output.className='output-note';output.textContent='Plots + tables';control.append(output);}}
 const link=document.createElement('a');link.className='source-link';link.textContent='↗';link.target='_blank';link.rel='noopener';link.onclick=e=>{e.preventDefault();e.stopPropagation();openSource(key);};link.onmouseenter=hidePreview;
 if(key==='data'){const shell=document.createElementNS('http://www.w3.org/2000/svg','svg');shell.setAttribute('viewBox','0 0 140 100');shell.setAttribute('preserveAspectRatio','none');shell.setAttribute('aria-hidden','true');shell.classList.add('database-shell');shell.innerHTML='<path class=database-body d="M1 12V87C1 103 139 103 139 87V12"/><ellipse cx=70 cy=12 rx=69 ry=11 /><path class=record-lines d="M38 76H112M38 84H112M38 92H112M65 73V95M88 73V95"/><path class=record-keys d="M27 74h5v4h-5zM27 82h5v4h-5zM27 90h5v4h-5z"/>';el.append(shell);}
 el.append(control,link);el.onclick=()=>{selected=key;if(key==='data')dataDraft=String(data?.database_version||2023);draw();showPreview(key);};
 el.onmouseenter=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>showPreview(key),180);};el.onmouseleave=hidePreview;control.onfocus=()=>showPreview(key);control.onblur=hidePreview;
 $('chain').append(el);return el;
}
function drawCpueProducts(){}
const escapeHTML=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function openCpueOutput(kind){
 const stage=data?.stages.find(s=>s.key==='cpue_'+kind);if(!stage?.source_id||stage.status!=='completed')return;
 hidePreview();const ticket=++sourceTicket;$('source-title').textContent=names[stage.key];
 $('source-meta').textContent='Actual GitHub job output · Run #'+data.number;$('source-body').textContent='Loading…';$('source-view').showModal();
 try{const response=await fetch('/api/output?job='+encodeURIComponent(stage.source_id)+'&file='+(kind==='report'?'report.html':'results.html'));if(!response.ok)throw Error('This output is still being published or has expired.');const html=await response.text();if(ticket!==sourceTicket)return;
 const frame=document.createElement('iframe');frame.title=names[stage.key];frame.setAttribute('sandbox','allow-downloads');frame.srcdoc=html;$('source-body').replaceChildren(frame);
 }catch(e){if(ticket===sourceTicket)$('source-body').textContent=e.message;}
}
function qualityRecord(){const q=data?.data_intake?.quality_check;if(!q)return [];const stamp=time(data.data_intake.checked_at?data.data_intake.checked_at*1000:null),lines=[(stamp?stamp+'  ':'')+'CHECK  incoming release '+q.proposed_version+' · '+q.rows_received+' records'];for(const e of q.errors||[]){lines.push('FAIL  '+e.code+' · '+e.message);if(e.failed_records)lines.push('      '+e.failed_records+' record(s) failed');for(const example of e.examples||[])lines.push('      '+example.set_id+' · '+(e.field||'value')+' = '+JSON.stringify(example.observed));}if(q.accepted)lines.push('PASS  '+(q.checks||[]).join(' · '));lines.push(q.accepted?'ACCEPT  validated records may be published':'RETURN  correct the data and resubmit · no release or analysis run');if(q.rule_version)lines.push('RULES  v'+q.rule_version+' · '+(q.rules_sha256||'').slice(0,12));return lines;}
function hidePreview(){clearTimeout(previewTimer);previewKey=null;$('preview').hidden=true;}
function placePopup(box,element){
 const anchor=element.getBoundingClientRect(),gap=12,pad=12;
 const bounds={left:pad,right:innerWidth-pad,top:document.querySelector('.top').getBoundingClientRect().bottom+8,bottom:innerHeight-pad};
 const clamp=(value,low,high)=>Math.max(low,Math.min(value,high));
 box.style.width='';box.style.maxHeight='';
 const naturalWidth=box.offsetWidth,naturalHeight=box.offsetHeight;
 const regions=[
  {side:'right',left:anchor.right+gap,right:bounds.right,top:bounds.top,bottom:bounds.bottom},
  {side:'left',left:bounds.left,right:anchor.left-gap,top:bounds.top,bottom:bounds.bottom},
  {side:'below',left:bounds.left,right:bounds.right,top:anchor.bottom+gap,bottom:bounds.bottom},
  {side:'above',left:bounds.left,right:bounds.right,top:bounds.top,bottom:anchor.top-gap}
 ];
 const obstacles=[...document.querySelectorAll('.stage,.data-node,.action-bar')].filter(n=>n!==element).map(n=>n.getBoundingClientRect());
 const choices=[];
 for(const region of regions){
  const availableWidth=region.right-region.left,availableHeight=region.bottom-region.top;
  if(availableWidth<Math.min(220,naturalWidth)||availableHeight<90)continue;
  box.style.width=Math.min(naturalWidth,availableWidth)+'px';box.style.maxHeight=availableHeight+'px';
  const width=box.offsetWidth,height=box.offsetHeight;
  const left=region.side==='right'?region.left:region.side==='left'?region.right-width:clamp(anchor.left+(anchor.width-width)/2,region.left,region.right-width);
  const top=region.side==='below'?region.top:region.side==='above'?region.bottom-height:clamp(anchor.top+(anchor.height-height)/2,region.top,region.bottom-height);
  const covered=obstacles.reduce((sum,r)=>sum+Math.max(0,Math.min(left+width,r.right)-Math.max(left,r.left))*Math.max(0,Math.min(top+height,r.bottom)-Math.max(top,r.top)),0);
  // Keep the source card clear; prefer a full-sized preview with fewer covered neighbours.
  const clipped=Math.max(0,naturalWidth*naturalHeight-width*height);
  choices.push({left,top,width,maxHeight:availableHeight,score:clipped*20+covered});
 }
 const best=choices.sort((a,b)=>a.score-b.score)[0];
 if(!best)return;
 box.style.width=best.width+'px';box.style.maxHeight=best.maxHeight+'px';box.style.left=best.left+'px';box.style.top=best.top+'px';
}

function showPreview(key){
 if(!data||sending||$('sql-view').open||$('branch-view').open||$('source-view').open)return;previewKey=key;
 const stage=[...data.stages,...(data.intake_stages||[])].find(s=>s.key===key);
 $('preview-title').textContent=(key==='qc'?'Quality check':names[key])+(key.startsWith('assessment_')||key.startsWith('prepare_')?' · CPUE '+(key.includes('vessel')?'A':'B'):'');
 let lines=[];
 if(key==='data'||(!stage&&key==='qc')){
  const q=data.data_intake?.quality_check;$('preview-state').textContent=q&&!q.accepted?'QC failed':'Database · v'+(data.database_version||2023);
  lines=q&&!q.accepted?qualityRecord().filter(x=>x.startsWith('FAIL')||x.startsWith('RETURN')).slice(0,3):key==='qc'?(q?['PASS  '+(q.checks||[]).slice(0,3).join(' · '),'Accepted release → extraction may start.']:['Check fields, duplicates, effort and catch.','Reject invalid data before publication.']):['Select a saved release, or add one checked batch.'];
  if(key==='qc')$('preview-state').textContent=qualityStatus()==='failed'?'Failed · GitHub job':qualityStatus()==='completed'?'Passed · before extraction':'Before extraction';
 }else if(stage){
  $('preview-state').textContent=(stage.reused?'Reused':states[stage.status]||stage.status)+(data.has_run?' · GitHub #'+data.number:'');
  const record=previewLog?.run_id===data.run_id&&previewLog?.stage===key?previewLog:null;
  if(record?.lines.length){lines=record.lines.slice(-3);$('preview-state').textContent=record.source+' · '+(stage.reused?'Reused':states[stage.status]||stage.status);}
  else lines=stage.reused?['Verified outputs retained.']:stage.status==='waiting'?['Waiting for '+(stage.parents.map(p=>names[p]).join(' + ')||'the selected data release')+'.']:['Reading the GitHub execution record…'];
  loadPreviewLog(key);
 }
 $('preview-record').textContent=lines.join('\n');$('preview').hidden=false;placePopup($('preview'),key==='qc'?$('quality-gate'):node(key));
}
async function loadPreviewLog(key){
 if(!data.has_run||previewLogPending||(previewLog?.stage===key&&previewLog?.run_id===data.run_id&&Date.now()-previewLogAt<2500))return;
 previewLogPending=true;const run=data.run_id;let updated=false;
 try{const r=await fetch('/api/stage-log?stage='+key,{cache:'no-store'});if(r.ok){const record=await r.json();if(data.run_id===run){previewLog=record;previewLogAt=Date.now();updated=true;}}}catch{}finally{previewLogPending=false;}
 if(updated&&previewKey===key&&data.run_id===run&&previewLog?.stage===key)showPreview(key);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hidePreview();$('console').hidden=true;$('logs').setAttribute('aria-expanded','false');$('logs').textContent='Show record';}});
function roundedRoute(points,radius=6){
 const clean=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);
 let d=`M${clean[0].join(',')}`;
 for(let i=1;i<clean.length-1;i++){
  const a=clean[i-1],b=clean[i],c=clean[i+1],u=Math.hypot(b[0]-a[0],b[1]-a[1]),v=Math.hypot(c[0]-b[0],c[1]-b[1]),r=Math.min(radius,u/2,v/2);
  d+=`L${b[0]+(a[0]-b[0])*r/u},${b[1]+(a[1]-b[1])*r/u}Q${b.join(',')} ${b[0]+(c[0]-b[0])*r/v},${b[1]+(c[1]-b[1])*r/v}`;
 }
 return d+`L${clean.at(-1).join(',')}`;
}
function qualityStatus(){
 const actual=data?.intake_stages?.find(j=>j.key==='qc');if(actual&&!actual.skipped)return actual.correction_phase==='resubmitting'?'failed':actual.status;
 const q=data?.data_intake?.quality_check;
 return sending&&changeKind==='data'?'running':q?(q.accepted?'completed':'failed'):'waiting';
}
function drawQuality(){
 let gate=$('quality-gate');if(!gate){
  gate=document.createElement('button');gate.id='quality-gate';gate.type='button';gate.dataset.key='qc';gate.innerHTML='<strong>QC</strong><small></small>';
  gate.onclick=()=>{qualityRecordOpen=true;hidePreview();$('console').hidden=false;$('logs').textContent='Hide record';$('logs').setAttribute('aria-expanded','true');showQualityRecord();};
  gate.onmouseenter=()=>showPreview('qc');gate.onmouseleave=hidePreview;gate.onfocus=()=>showPreview('qc');gate.onblur=hidePreview;$('chain').append(gate);
 }
 let submission=$('submission-node');if(!submission){submission=document.createElement('div');submission.id='submission-node';submission.dataset.key='submission';submission.className='submission-node';submission.innerHTML='<button class="node-control"><strong>Data submission</strong></button>';submission.onclick=()=>{selected='data';dataDraft='new';draw();};$('chain').append(submission);}
 submission.classList.toggle('selected',selected==='data'&&(!dataDraft||dataDraft==='new'));
 node('data').classList.toggle('selected',selected==='data'&&dataDraft!=='new');
 let ingest=$('ingest-node');if(!ingest){ingest=document.createElement('button');ingest.id='ingest-node';ingest.dataset.key='ingest';ingest.textContent='Prepare & load';ingest.title='Owner · Jessica, Tiffany. Align fields, formats and units; load accepted records into the database.';$('chain').append(ingest);}
 for(const [key,el] of [['submission',submission],['qc',gate]]){
  el.onmouseenter=()=>showPreview(key);el.onmouseleave=hidePreview;
  let link=el.querySelector('.source-link');if(!link){link=document.createElement('a');link.className='source-link';link.textContent='↗';link.onclick=e=>{e.preventDefault();e.stopPropagation();openSource(key);};link.onmouseenter=hidePreview;el.append(link);}sourceLink(key);
 }

 const actualIngest=data.intake_stages?.find(j=>j.key==='ingest');
 const actualSubmission=data.intake_stages?.find(j=>j.key==='submission');
 submission.dataset.status=actualSubmission?.status||'waiting';submission.classList.toggle('running',actualSubmission?.status==='running');
 ingest.onclick=()=>{selected='data';dataDraft='new';draw();showPreview('ingest');};
 let label=ingest.querySelector('.ingest-label');if(!label){label=document.createElement('span');label.className='ingest-label';ingest.replaceChildren(label);}label.textContent=(actualIngest&&!actualIngest.skipped?(icons[actualIngest.status]||'·')+' ':'')+'Prepare & load';
 const state=qualityStatus();ingest.className='ingest-node '+(actualIngest?.status||(state==='failed'?'blocked':state==='completed'&&data.data_intake?.published?'completed':'waiting'));submission.classList.toggle('needs-correction',state==='failed');
 const stamp=data?.data_intake?.checked_at;if(state==='failed'&&stamp&&stamp!==qualityAlertStamp){qualityAlertStamp=stamp;notice('QC returned the submission: '+(data.data_intake.quality_check.errors?.[0]?.message||'Correct the flagged records.')+' The corrected example is resubmitted automatically.');}
 gate.className='quality-gate '+state;gate.querySelector('small').textContent={completed:'✓ Pass',failed:'× Fail',running:'Check…',waiting:'Ready'}[state];
 gate.style.transform='translateY(-83px)';
 gate.title='View the data quality check';
 if(!ingest.querySelector('.source-link')){const link=document.createElement('a');link.className='source-link';link.textContent='↗';link.onclick=e=>{e.preventDefault();e.stopPropagation();openSource('ingest');};ingest.append(link);}sourceLink('ingest');ingest.onmouseenter=()=>showPreview('ingest');ingest.onmouseleave=hidePreview;
 const intakeSelected=selected==='data'&&(!dataDraft||dataDraft==='new');for(const el of [submission,gate,ingest]){el.classList.toggle('impacted',intakeSelected);el.classList.toggle('outside-impact',!!selected&&!intakeSelected);}
 gate.setAttribute('aria-label','Quality check: '+{completed:'passed',failed:'failed',running:'checking',waiting:'ready'}[state]+'. View checks.');
}
function showQualityRecord(){
 $('console-title').textContent='Data quality check · before extraction';
 $('console-lines').textContent=qualityRecord().join('\n')||'Incoming data are checked before a release is published. Select Data to add a checked batch or test a rejected batch.';
 $('console-link').removeAttribute('href');$('console-link').textContent='';
}
function links(){
 const root=$('chain');root.querySelector('.edges')?.remove();if(!data)return;
 const impact=affected(),rect=root.getBoundingClientRect(),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 const failedQC=qualityStatus()==='failed',failedIntake=failedQC&&(!selected||(selected==='data'&&(!dataDraft||dataDraft==='new')));
 if(selected==='data'){impact.add('data');if(!dataDraft||dataDraft==='new'){impact.add('submission');impact.add('qc');impact.add('ingest');}}
 const stages=new Map(data.stages.map(s=>[s.key,s]));stages.set('qc',{status:qualityStatus()});
 svg.classList.add('edges');svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
 const defs=document.createElementNS(ns,'defs');
 for(const [id,color] of Object.entries({base:'#657f91',muted:'#9bb0bc',selected:'#0085ca',active:'#b77b1c',failed:'#be593d'})){
  const marker=document.createElementNS(ns,'marker');for(const [name,value] of Object.entries({id:'arrow-'+id,viewBox:'0 0 7 7',refX:'6',refY:'3.5',markerWidth:'7',markerHeight:'7',markerUnits:'userSpaceOnUse',orient:'auto'}))marker.setAttribute(name,value);
  const head=document.createElementNS(ns,'path');head.setAttribute('d','M0 0L6 3.5L0 7Z');head.setAttribute('style','fill:'+color+';stroke:none');marker.append(head);defs.append(marker);
 }svg.append(defs);
 for(const [first,last,fill,stroke] of [['data','extract','#edf7ee','#b4d5b8'],['cpue_vessel','cpue_report','#ebf5fc','#aacfe8'],['prepare_vessel','report','#f4effa','#cfbce0']]){
  const a=node(first).getBoundingClientRect(),b=(last==='cpue_report'?$(last):node(last))?.getBoundingClientRect();if(!b)continue;
  const band=document.createElementNS(ns,'rect');band.dataset.module=first;for(const [k,v] of Object.entries({x:a.left-rect.left-4,y:-17,width:b.right-a.left+8,height:rect.height+29,rx:9,fill,stroke,'stroke-width':1}))band.setAttribute(k,v);svg.append(band);
 }

 const all=[{key:'qc',parents:['submission'],status:qualityStatus()},{key:'ingest',parents:['qc']},{key:'data',parents:['ingest']},...data.stages.map(s=>s.key==='extract'?{...s,parents:['data']}:s)];
 for(const child of all.filter(s=>!['cpue_summary','cpue_report'].includes(s.key)))for(const parent of child.parents||[]){
  const a=root.querySelector(`[data-key="${parent}"]`)?.getBoundingClientRect(),b=root.querySelector(`[data-key="${child.key}"]`)?.getBoundingClientRect();if(!a||!b)continue;
  const inPath=impact.has(child.key)&&impact.has(parent),reusedInput=child.reused||stages.get(parent)?.reused;
  const muted=(selected?!inPath:!!reusedInput)||(failedIntake&&child.key!=='qc');
  let x=a.right-rect.left+1,y=a.top+a.height/2-rect.top,X=b.left-rect.left-4,Y=b.top+b.height/2-rect.top,points;
  const path=document.createElementNS(ns,'path');path.dataset.from=parent;path.dataset.to=child.key;
  if(parent==='submission'||parent==='qc'||parent==='ingest'){
   x=a.left+a.width/2-rect.left;y=a.bottom-rect.top+1;X=b.left+b.width/2-rect.left;Y=b.top-rect.top-4;points=[[x,y],[X,Y]];
  }else if(parent==='extract'&&child.key.startsWith('prepare_')){
   const top=child.key==='prepare_vessel',rail=top?-4:rect.height+4;
   x=a.left+a.width*.5-rect.left;y=(top?a.top-1:a.bottom+1)-rect.top;
   X=b.left+b.width*.55-rect.left;Y=(top?b.top-4:b.bottom+4)-rect.top;
   points=[[x,y],[x,rail],[X,rail],[X,Y]];path.classList.add('data-edge');
   const label=document.createElementNS(ns,'text');label.classList.add('edge-label');label.classList.toggle('muted',muted);label.setAttribute('x',x+10);label.setAttribute('y',rail+(top?-6:13));label.textContent='Catch · length/age comps';svg.append(label);
  }else{
   if(parent==='extract'&&child.key.startsWith('cpue_'))y+=child.key==='cpue_vessel'?-12:12;
   if(child.key.startsWith('assessment_'))y+=child.key.endsWith('_ref')?-10:10;
   let m=(x+X)/2;
   if(child.key==='synthesis'){
    const i=child.parents.indexOf(parent),ports=[12,28,b.height-28,b.height-12];
    Y=b.top+ports[i]-rect.top;m=x+(X-x)*([0,3].includes(i)?.68:.34);
   }
   points=Math.abs(y-Y)<1?[[x,y],[X,Y]]:[[x,y],[m,y],[m,Y],[X,Y]];
  }
  path.setAttribute('d',roundedRoute(points));path.classList.toggle('preview',!!selected&&inPath&&!muted);path.classList.toggle('muted',!!muted);
  const blocked=failedQC&&parent==='qc',running=!expected&&!sending&&!muted&&!reusedInput&&child.status==='running';
  path.classList.toggle('blocked-edge',blocked);path.classList.toggle('active',running);
  if(!blocked)path.setAttribute('marker-end','url(#arrow-'+(muted?'muted':running?'active':selected&&inPath?'selected':'base')+')');
  svg.append(path);
 }
 const combinedAffected=impact.has('cpue_summary')||impact.has('cpue_report');
 for(const [from,to] of [['cpue_vessel','cpue_summary'],['cpue_year','cpue_summary'],['cpue_summary','cpue_report']]){
  const isAnalysis=from!=='cpue_summary',source=isAnalysis?node(from):$(from),target=$(to);if(!source||!target)continue;
  const muted=(selected?!(impact.has(from)&&impact.has(to)):isAnalysis?!!stages.get(from)?.reused:['cpue_vessel','cpue_year'].every(k=>stages.get(k)?.reused))||failedIntake;
  const a=source.getBoundingClientRect(),b=target.getBoundingClientRect();let points;
  if(isAnalysis){const top=from==='cpue_vessel',x=a.right-rect.left+1,y=(top?a.bottom-9:a.top+9)-rect.top,X=b.left-rect.left-4,Y=b.top+b.height*(top?.35:.7)-rect.top,m=(x+X)/2;points=[[x,y],[m,y],[m,Y],[X,Y]];}
  else{const x=a.left+a.width/2-rect.left;points=[[x,a.bottom-rect.top+1],[x,b.top-rect.top-3]];}
  const path=document.createElementNS(ns,'path');path.dataset.from=from;path.dataset.to=to;path.classList.add('product-edge');path.classList.toggle('muted',muted);path.classList.toggle('preview',!!selected&&!muted);
  path.setAttribute('d',roundedRoute(points,5));path.setAttribute('marker-end','url(#arrow-'+(muted?'muted':selected?'selected':'base')+')');svg.append(path);
 }
 if(failedQC){
  const a=$('quality-gate').getBoundingClientRect(),b=$('submission-node').getBoundingClientRect(),x=a.right-rect.left+1,y=a.top+a.height/2-rect.top,X=b.right-rect.left+4,Y=b.top+b.height/2-rect.top,rail=X+12;
  const returned=document.createElementNS(ns,'path');returned.classList.add('return-edge');returned.dataset.from='qc';returned.dataset.to='submission';returned.setAttribute('d',roundedRoute([[x,y],[rail,y],[rail,Y],[X,Y]]));returned.setAttribute('marker-end','url(#arrow-failed)');svg.append(returned);
 }
 root.append(svg);
}
new ResizeObserver(()=>requestAnimationFrame(()=>{links();if(previewKey)showPreview(previewKey);if($('sql-view').open)placePopup($('sql-view'),node('extract'));})).observe($('chain'));
function friendlyStep(name){if(name==='Retrieve locked analysis modules')return 'Load six code repositories at locked commits';if(name==='Prepare the pinned Docker environment')return 'Pull container image';if(name==='Checkout')return 'Check out analysis code';if(name==='Checkout source data')return 'Check out data settings';if(name==='Fetch versioned database snapshot')return 'Download the recorded data release';if(name==='Set up job')return 'Start runner';if(name==='Save the complete workflow outputs')return 'Save outputs';const stage=data?.stages.find(s=>s._step_number===data.execution?.jobs?.[0]?.steps.find(x=>x.name===name)?.number);return stage?names[stage.key]+(name.endsWith(' · reused')?' · reused':''):name;}
function showConsole(){const space=document.querySelector('main').getBoundingClientRect().bottom-document.querySelector('.action-bar').getBoundingClientRect().top+10;$('console').style.bottom=space+'px';$('notice').style.bottom=space+'px';if(!data)return;if(qualityRecordOpen){showQualityRecord();return;}if(data.has_run===false){$('console-title').textContent='Ready for a new demonstration';$('console-lines').textContent='The previous execution records have been cleared.';$('console-link').removeAttribute('href');return;}const steps=(data.execution?.jobs||[]).flatMap(j=>j.steps||[]),actual=consoleRecord?.run_id===data.run_id&&consoleRecord?.attempt===data.attempt;let lines=[];if(actual){$('console-title').textContent='GitHub console · completed run';lines=consoleRecord.lines.map(line=>line.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*/,(_,t)=>time(t)+'  '));}else{$('console-title').textContent='Live GitHub step record';for(const s of steps)if(s.started_at&&['in_progress','completed'].includes(s.status))lines.push(time(s.started_at)+'  '+(s.status==='completed'?(s.conclusion==='success'?'✓':s.name.endsWith(' · reused')?'↺':'×'):'▶')+' '+s.name);if(!lines.length)lines=['Waiting for GitHub to assign a runner.'];}if(expected){$('console-title').textContent='Update stored · waiting for GitHub';lines=[expected.startsWith('db-')?'Database release '+expected.slice(3):'Settings commit '+expected.slice(0,8),'The update triggers the workflow in the analysis repository.'];}const qc=data.data_intake?.quality_check,qcView=qc&&(!qc.accepted||selected==='data');if(qcView){$('console-title').textContent='Data quality check · Database';lines=qualityRecord();}const text=lines.join('\n'),el=$('console-lines');if(el.textContent!==text){el.textContent=text;el.scrollTop=el.scrollHeight;}$('console-link').href=data.run_url;$('console-link').textContent=qcView&&!qc.accepted?'View failed GitHub run ↗':'View run ↗';}
async function loadConsole(){if(data.has_run===false||consolePending||data.status!=='completed'||(consoleRecord?.run_id===data.run_id&&consoleRecord?.attempt===data.attempt))return;consolePending=true;try{const r=await fetch('/api/console',{cache:'no-store'});if(r.ok){const next=await r.json();if(next.ready&&next.lines.length)consoleRecord=next;}}catch{}finally{consolePending=false;showConsole();}}
function notice(text){$('notice-text').textContent=text;$('notice').hidden=false;}
function draw(){if(!data)return;const impact=affected(),key=selectedKey(),steps=(data.execution?.jobs||[]).flatMap(j=>j.steps||[]),active=steps.find(s=>s.status==='in_progress'),reused=data.stages.filter(s=>s.reused).length,busy=sending||!!expected||data.status!=='completed',stale=data.source?.stale,cloudBlocked=data.session&&!data.session.can_update;
 $('run-link').textContent=data.has_run===false?'Ready':'Run #'+data.number;$('run-link').href=data.run_url;$('run-state').textContent=data.demo?.phase==='cleaning'?'Resetting…':data.has_run===false?'Ready for a fresh demonstration':stale?'Last verified state':expected?'New run pending':data.status==='completed'?(data.conclusion==='success'?'Complete · '+(data.stages.length-reused+(data.intake_stages||[]).filter(j=>!j.skipped).length)+' run · '+reused+' reused':data.conclusion):data.stages.filter(s=>s.status==='running').length>1?data.stages.filter(s=>s.status==='running').length+' analyses running in parallel':data.status.replaceAll('_',' ');$('live-dot').className='dot '+(busy?'live':data.conclusion==='success'?'success':'');
 const source=node('data');source.classList.toggle('selected',selected==='data');source.querySelector('.node-control').setAttribute('aria-pressed',String(selected==='data'));const qc=data.data_intake?.quality_check,version=(data.intake_stages?.some(j=>j.key==='submission'&&!j.skipped)&&!data.intake_stages?.some(j=>j.key==='ingest'&&j.status==='completed')?data.latest_database_version:data.database_version)||(data.data_intake?.published?qc?.proposed_version:null);source.querySelector('.release').textContent=version?'v'+version:'Versioned data';source.querySelector('.qc').textContent=sending&&changeKind==='data'?'Checking QC…':qc?(qc.accepted?'✓ QC passed':'× QC failed'):'QC before release';if(Number(version)>=2024&&(!qc||qc.accepted))source.querySelector('.qc').textContent='✓ One added batch';source.querySelector('.qc').classList.toggle('failed',!!qc&&!qc.accepted);
 for(const s of data.stages){const el=node(s.key),state=expected?(impact.has(s.key)||!selected?'waiting':s.status):s.status;el.className='stage '+state+(s.reused&&!expected?' reused':'')+(selected&&impact.has(s.key)?' impacted':'')+(selected&&!impact.has(s.key)?' outside-impact':'')+(selected===s.key?' selected':'');el.querySelector('.state-icon').textContent=s.reused&&!expected?'↺':icons[state]||'·';el.querySelector('.state-label').textContent=s.reused&&!expected?'Reused':states[state]||state;el.querySelector('.node-control').setAttribute('aria-pressed',String(selected===s.key));el.title=(s.parents.length?'Inputs: '+s.parents.map(p=>names[p]).join(' + '):'Input: accepted database release')+' · select to update downstream';}
 const submittingData=key==='data'&&(!dataDraft||dataDraft==='new');
 const count=(selected?data.stages.filter(s=>impact.has(s.key)).length:data.stages.length)+(submittingData?3:0),pendingCount=plannedRoots().length,replayData=key==='data'&&Number(data.database_version)>=2024;
 $('selection-title').textContent=key==='data'?(replayData?'Replay data update':'New data'):names[key]+(key.startsWith('prepare_')||key.startsWith('assessment_')?' · CPUE '+(key.includes('vessel')?'A':'B'):'');
 $('progress').textContent=(data.has_run===false&&!data.baseline_available&&key!=='data'?'Prepare initial inputs → ':key==='data'?(replayData?'Replay the accepted data update → ':'Add one batch → QC → '):pendingCount>1?pendingCount+' starting stages → ':'Run this stage → ')+count+' stages run'+(count<data.stages.length?' · '+(data.stages.length-count)+' kept':'');
 for(const item of ['data',...data.stages.map(s=>s.key)])sourceLink(item);drawBranchButton(busy);
 $('data-picker').hidden=key!=='data';
 if(key==='data'){const choices=[...(data.data_versions||[2023]).map(v=>[String(v),'Release '+v]),['new',Number(data.latest_database_version)>=2024?'Replay new-data update':'Add checked batch']];const signature=JSON.stringify(choices);if($('data-version').dataset.choices!==signature){$('data-version').replaceChildren(...choices.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));$('data-version').dataset.choices=signature;}$('data-version').value=dataDraft||'new';}
 $('sql-button').hidden=key!=='extract';$('sql-button').disabled=!nextSource('extract');
 drawBranches(key,busy);
 $('run').disabled=busy||!!stale;$('run').setAttribute('aria-disabled',String(busy||!!stale||!!cloudBlocked));$('run').textContent=sending?'Submitting…':expected?'Starting…':key==='data'?(replayData?'Replay data update →':'Add data + run →'):pendingCount>1?'Run selected changes →':'Run from '+names[key]+' →';if(key==='data'&&(!dataDraft||dataDraft==='new')&&qualityStatus()==='failed'&&!busy){$('selection-title').textContent='Retry data submission';$('run').textContent='Retry submission →';}
 if(submittingData&&qualityStatus()!=='failed'&&!busy){$('selection-title').textContent='Data submission';$('progress').textContent='QC returns once → automatic resubmission → full workflow';$('run').textContent='Submit data →';}
 if(key==='data'&&dataDraft&&dataDraft!=='new'){$('selection-title').textContent='Data release '+dataDraft;$('progress').textContent='Restore this snapshot → 13 analysis stages';$('run').textContent=busy?'Starting…':'Run with v'+dataDraft+' →';}
 $('run').title=cloudBlocked?data.session.message:'Run from '+$('selection-title').textContent+' and update its dependent stages on GitHub Actions';$('invalid').hidden=key!=='data'||dataDraft!=='new'||!data.database_connected;$('invalid').disabled=busy||!!stale;
 $('record-dot').className=$('live-dot').className;$('verified').textContent=time(data.source?.last_success);$('message').className='';
 $('message').textContent=sending?(changeKind==='data'?'Validate and publish incoming data…':'Commit the selected update…'):expected?'Update stored → waiting for the next GitHub run':stale?'Connection interrupted · showing the last verified run':active?'Running on GitHub · '+(data.stages.filter(s=>s.status==='running').map(s=>names[s.key]).join(' + ')||friendlyStep(active.name)):data.status==='completed'?(data.conclusion==='success'?'✓ Outputs saved · report ready':'GitHub run '+data.conclusion):'GitHub is assigning a runner…';
 if(data.has_run===false&&!busy){$('message').textContent='Ready · verified baseline inputs available';$('run-link').removeAttribute('href');}
 if(data.demo?.reset_at&&!busy){const seconds=Math.max(0,Math.ceil((Date.parse(data.demo.reset_at)-Date.now())/1000));$('message').textContent+=' · resets in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
 if(cloudBlocked&&!busy&&!stale){$('message').textContent=data.session.message.includes('owner')?'Viewing only · owner GitHub connection needed':data.session.message;$('message').className='read-only';}
 if(data.intake_stages?.some(j=>j.correction_phase==='resubmitting')){$('message').textContent='QC returned the example → correcting and resubmitting automatically';}else if(data.intake_stages?.some(j=>j.correction_phase==='rechecking')){$('message').textContent='Corrected example submitted → checking again';}
 if(qc&&!qc.accepted&&!busy){$('message').textContent='QC failed on GitHub · returned to Korea · loading and extraction blocked';}
 drawQuality();drawCpueProducts();requestAnimationFrame(links);showConsole();loadConsole();if(previewKey)showPreview(previewKey);}
async function refresh(force=false){if(window.workshopActive===false||refreshing)return;if(!force&&data?.status==='completed'&&!expected&&Date.now()-lastRefresh<10000)return;refreshing=true;lastRefresh=Date.now();try{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error();const next=await r.json();if(!next.ready)throw Error();data=next;if(data.has_run===false&&!expected){consoleRecord=null;$('console').hidden=true;$('logs').setAttribute('aria-expanded','false');$('logs').textContent='Show record';}if(expected===data.commit||(data.database_version&&expected==='db-'+data.database_version)){expected='';loadBranches();}draw();}catch{$('message').textContent='Live connection unavailable · retrying';$('run').disabled=true;}finally{refreshing=false;}}
function drawBranches(key,busy){
 const choices=branchCatalog?.options[key]||{},entries=Object.entries(choices),picker=$('branch');
 $('branch-picker').hidden=key==='data'||!entries.length;if(!entries.length)return;
 const preferred=branchDrafts[key]||branchCatalog.sources[key]?.branch||entries[0][0];
 if(picker.dataset.stage!==key||picker.dataset.options!==entries.map(([b])=>b).join(',')){
  picker.replaceChildren(...entries.map(([branch])=>{const option=document.createElement('option');option.value=branch;option.textContent=branch;return option;}));
  picker.dataset.stage=key;picker.dataset.options=entries.map(([b])=>b).join(',');
 }
 picker.value=preferred;picker.disabled=busy;
 const source=choices[preferred];$('branch-commit').textContent=source.commit.slice(0,8)+' ↗';$('branch-commit').href='https://github.com/'+source.repository+'/commit/'+source.commit;$('branch-commit').onclick=e=>{e.preventDefault();openSource(key);};
 $('branch-picker').title='Each stage has its own branch. Run applies all pending choices together.';
}
function stageTitle(key){return names[key]+(key.startsWith('prepare_')||key.startsWith('assessment_')?' · CPUE '+(key.includes('vessel')?'A':'B'):'');}
function branchStages(){const impact=selected?affected():new Set(data?.stages.map(s=>s.key)||[]);return (data?.stages||[]).filter(s=>impact.has(s.key));}
function drawBranchButton(busy){
 let button=$('branch-list-button');if(!button){button=document.createElement('button');button.id='branch-list-button';button.onclick=()=>{hidePreview();drawBranchList();$('branch-view').showModal();};$('run').before(button);}
 button.textContent='All branches · '+branchStages().length;button.disabled=busy||!branchCatalog;
}
function drawBranchList(){
 const title=selectedKey()==='data'?'Database':stageTitle(selectedKey());$('branch-heading').textContent='Branches from '+title;
 $('branch-scope').textContent='Start stays at '+title+'. Choose each stage’s branch, then run the connected path.';
 $('branch-rows').replaceChildren(...branchStages().map(stage=>{
  const row=document.createElement('div');row.className='branch-row';row.dataset.stage=stage.key;
  const label=document.createElement('label'),picker=document.createElement('select'),link=document.createElement('a');
  picker.id='choose-'+stage.key;label.htmlFor=picker.id;label.textContent=stageTitle(stage.key);picker.setAttribute('aria-label',stageTitle(stage.key)+' branch');
  const options=branchCatalog?.options[stage.key]||{};picker.replaceChildren(...Object.keys(options).map(branch=>{const option=document.createElement('option');option.value=branch;option.textContent=branch;return option;}));
  picker.value=branchDrafts[stage.key]||branchCatalog?.sources[stage.key]?.branch||Object.keys(options)[0];
  const update=()=>{const source=options[picker.value];link.textContent=source?.commit.slice(0,8)+' ↗';link.href=source?'https://github.com/'+source.repository+'/commit/'+source.commit:'#';};
  picker.onchange=()=>{branchDrafts[stage.key]=picker.value;update();draw();};
  link.onclick=e=>{e.preventDefault();openSource(stage.key);};update();row.append(label,picker,link);return row;
 }));
}
$('branch-close').onclick=$('branch-done').onclick=()=>$('branch-view').close();
const sourceCache=new Map();let sourceTicket=0;
$('source-close').onclick=()=>$('source-view').close();
$('source-view').addEventListener('close',()=>{++sourceTicket;$('source-body').replaceChildren();});
async function openSource(key){
 hidePreview();const ticket=++sourceTicket,body=$('source-body');$('source-title').textContent=key==='data'?'Database':'Code repository · '+stageTitle(key);$('source-meta').textContent='';body.replaceChildren();$('source-view').showModal();
 if(key==='data'){
  $('source-meta').textContent='Supabase · saved snapshot · read-only records';const frame=document.createElement('iframe');frame.title='Database snapshot preview';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.referrerPolicy='no-referrer';frame.src='https://kyuhank.github.io/cpue-actions-demo/data.html?version='+(dataDraft&&dataDraft!=='new'?dataDraft:data?.database_version||2023);body.append(frame);return;
 }
 const source=nextSource(key);if(!source||!/^kyuhank\/cpue-(actions-demo|demo-(extract|cpue|inputs|assessment|synthesis|report))$/.test(source.repository)||!/^[a-f0-9]{40}$/.test(source.commit)){body.textContent='Loading the registered source. Try again in a moment.';return;}
 $('source-meta').textContent=source.repository+' · '+source.branch+' · '+source.commit.slice(0,12);
 const picker=document.createElement('select'),code=document.createElement('pre');picker.id='source-file';picker.setAttribute('aria-label','Repository file');body.append(picker,code);
 const base='https://raw.githubusercontent.com/'+source.repository+'/'+source.commit+'/';
 const load=async()=>{const file=picker.value;code.textContent='Loading '+file+'…';try{const url=base+file.split('/').map(encodeURIComponent).join('/');let text=sourceCache.get(url);if(text===undefined){const r=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('The file is temporarily unavailable.');text=(await r.text()).slice(0,60000);sourceCache.set(url,text);}if(ticket===sourceTicket&&picker.value===file)code.textContent=text;}catch(e){if(ticket===sourceTicket)code.textContent=e.message;}};
 picker.onchange=load;
 // All files come from the fixed public module and the selected, registered commit.
 let files=source.repository==='kyuhank/cpue-actions-demo'?['scripts/data_intake.py','.github/workflows/toy-pipeline.yml','supabase/functions/workshop-api/batches.json']:['README.md'];
 try{const url='https://api.github.com/repos/'+source.repository+'/git/trees/'+source.commit;let tree=sourceCache.get(url);if(!tree){const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(r.ok){tree=await r.json();sourceCache.set(url,tree);}}if(tree?.tree&&source.repository!=='kyuhank/cpue-actions-demo')files=tree.tree.filter(f=>f.type==='blob'&&/\.(md|py|sql|json|yml|qmd)$/.test(f.path)).map(f=>f.path).sort((a,b)=>a==='README.md'?-1:b==='README.md'?1:a.localeCompare(b));}catch{}
 if(ticket!==sourceTicket)return;
 picker.replaceChildren(...files.map(file=>{const option=document.createElement('option');option.value=file;option.textContent=file;return option;}));load();
}
async function loadBranches(){if(branchLoading)return;branchLoading=true;try{const response=await fetch('/api/branches',{cache:'no-store'});if(response.ok){branchCatalog=await response.json();if(data)draw();}}catch{}finally{branchLoading=false;}}
$('branch').onchange=()=>{branchDrafts[selectedKey()]=$('branch').value;hidePreview();draw();};
async function publish(invalid=false){
 if(!data||sending||expected||data.status!=='completed'||data.source?.stale)return;
 if(data.session&&!data.session.can_update){notice(data.session.message);return;}
 const stage=selectedKey(),choices=pendingBranches();
 if(stage!=='data'&&branchCatalog?.options[stage])choices[stage]=$('branch').value;
 if(!invalid&&!branchCatalog){notice('Loading registered branches. Please try again in a moment.');loadBranches();return;}
 qualityRecordOpen=false;runRoots=[...new Set([dataDraft&&dataDraft!=='new'&&Number(dataDraft)!==Number(data.database_version)?'data':stage,...Object.keys(choices)])];hidePreview();sending=true;changeKind=stage;$('notice').hidden=true;draw();
 try{
  const r=await fetch(invalid?'/api/check-invalid-data':'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Workshop-Action':'publish-synthetic-data','X-Workshop-Request':crypto.randomUUID()},body:invalid?'{}':JSON.stringify({start:stage,branches:choices,...(dataDraft&&dataDraft!=='new'?{data_version:Number(dataDraft)}:{})})}),result=await r.json();
  if(!r.ok)throw Error(result.detail||'Update failed');
  expected=result.published===false?'':result.commit||(result.database_version?'db-'+result.database_version:'');
  if(result.published===false){$('console').hidden=true;$('logs').setAttribute('aria-expanded','false');$('logs').textContent='Show record';}
 }catch(e){notice(e.message);}finally{sending=false;draw();await refresh(true);}
}
$('sql-close').onclick=()=>$('sql-view').close();
$('sql-button').onclick=async()=>{
 hidePreview();const source=nextSource('extract');if(!source||source.repository!=='kyuhank/cpue-demo-extract'||!/^[a-f0-9]{40}$/.test(source.commit))return;
 $('sql-view').showModal();$('sql-source').textContent=source.repository+' · '+source.branch+' @ '+source.commit.slice(0,8);$('sql-content').textContent='Loading the recorded source…';placePopup($('sql-view'),node('extract'));
 try{
  const blocks=await Promise.all(['extract.sql','extract-catch.sql'].map(async(name)=>{
   const response=await fetch('https://raw.githubusercontent.com/'+source.repository+'/'+source.commit+'/'+name,{signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('SQL source is unavailable.');const text=await response.text();if(text.length>16000)throw Error('SQL source exceeds the demo limit.');
   const section=document.createElement('section'),heading=document.createElement('h3'),link=document.createElement('a'),pre=document.createElement('pre');
   link.textContent=name+' ↗';link.href='https://github.com/'+source.repository+'/blob/'+source.commit+'/'+name;link.target='_blank';link.rel='noopener';heading.append(link);pre.textContent=text;section.append(heading,pre);return section;
  }));$('sql-content').replaceChildren(...blocks);
 }catch(error){$('sql-content').textContent=error.message;}
 if($('sql-view').open)placePopup($('sql-view'),node('extract'));
};
$('data-version').onchange=()=>{dataDraft=$('data-version').value;draw();};
 $('run').onclick=()=>publish(selectedKey()==='data'&&(!dataDraft||dataDraft==='new')&&qualityStatus()!=='failed');$('invalid').onclick=()=>publish(true);$('logs').onclick=()=>{qualityRecordOpen=false;$('console').hidden=!$('console').hidden;$('logs').setAttribute('aria-expanded',String(!$('console').hidden));$('logs').textContent=$('console').hidden?'Show record':'Hide record';showConsole();};$('dismiss').onclick=()=>{$('notice').hidden=true;};
if(parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');refresh();loadBranches();setInterval(refresh,2000);
async function heartbeat(){try{const r=await fetch('/api/presentation-info',{cache:'no-store'});if(r.ok&&(await r.json()).presentation==='cpue-workshop'&&parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');}catch{}}
heartbeat();setInterval(heartbeat,4000);
