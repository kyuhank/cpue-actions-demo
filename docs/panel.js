
const $=id=>document.getElementById(id);
const positions={data:[1,1,5],extract:[2,1,5],cpue_vessel:[3,1,3],cpue_year:[3,3,5],prepare_vessel:[4,1,3],prepare_year:[4,3,5],assessment_vessel_ref:[5,1,2],assessment_vessel_high_m:[5,2,3],assessment_year_ref:[5,3,4],assessment_year_high_m:[5,4,5],synthesis:[6,1,5],report:[7,1,5]};
const names={data:'Data',extract:'Extract',cpue_vessel:'CPUE A',cpue_year:'CPUE B',prepare_vessel:'Input prep',prepare_year:'Input prep',assessment_vessel_ref:'Assessment 1',assessment_vessel_high_m:'Assessment 2',assessment_year_ref:'Assessment 1',assessment_year_high_m:'Assessment 2',synthesis:'Synthesis',report:'Report'};
const states={waiting:'Waiting',queued:'Queued',idle:'Queued',running:'Running',completed:'Complete',failed:'Failed',blocked:'Blocked',cancelled:'Cancelled'},icons={completed:'✓',running:'◌',failed:'×',blocked:'×',cancelled:'–'};
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
 if(dataDraft!==null&&dataDraft!=='new'&&Number(dataDraft)!==Number(data.database_version))return new Set(data.stages.map(s=>s.key));
 if(roots.includes('data')||(data.has_run===false&&!data.baseline_available))return new Set(data.stages.map(s=>s.key));
 const result=new Set(roots);
 let changed=true;while(changed){changed=false;for(const s of data.stages)if(!result.has(s.key)&&(s.parents||[]).some(p=>result.has(p))){result.add(s.key);changed=true;}}
 return result;
}
function nextSource(key){return branchCatalog?.options[key]?.[branchDrafts[key]||branchCatalog?.sources[key]?.branch]||data?.stages.find(s=>s.key===key)?.code_source;}
function sourceLink(key){
 const link=node(key).querySelector('.source-link'),source=nextSource(key);
 link.hidden=key!=='data'&&!source;
 link.href=key==='data'?'https://kyuhank.github.io/cpue-actions-demo/data.html':source?'https://github.com/'+source.repository+'/tree/'+encodeURIComponent(source.branch):'#';
 link.title=key==='data'?'Open the synthetic database':source?'Open '+source.repository+' · '+source.branch:'';
 link.setAttribute('aria-label',link.title);
}
function node(key){
 let el=$('chain').querySelector(`[data-key="${key}"]`);if(el)return el;
 el=document.createElement('div');el.dataset.key=key;el.className=key==='data'?'data-node':'stage';
 const [col,start,end]=positions[key];el.style.gridColumn=col;el.style.gridRow=`${start} / ${end}`;
 const control=document.createElement('button');control.type='button';control.className='node-control';
 const title=document.createElement('strong');title.textContent=names[key];control.append(title);
 if(key==='data'){const version=document.createElement('div');version.className='release';const qc=document.createElement('div');qc.className='qc';control.append(version,qc);}
 else{const state=document.createElement('small');state.innerHTML='<span class="state-icon"></span><span class="state-label"></span>';control.append(state);}
 const link=document.createElement('a');link.className='source-link';link.textContent='↗';link.target='_blank';link.rel='noopener';link.onclick=e=>{e.stopPropagation();hidePreview();};link.onmouseenter=hidePreview;
 el.append(control,link);el.onclick=()=>{selected=key;draw();showPreview(key);};
 el.onmouseenter=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>showPreview(key),180);};el.onmouseleave=hidePreview;control.onfocus=()=>showPreview(key);control.onblur=hidePreview;
 $('chain').append(el);return el;
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
 if(!data||sending||$('sql-view').open)return;previewKey=key;
 const stage=data.stages.find(s=>s.key===key);
 $('preview-title').textContent=names[key]+(key.startsWith('assessment_')||key.startsWith('prepare_')?' · CPUE '+(key.includes('vessel')?'A':'B'):'');
 let lines=[];
 if(key==='data'){
  const q=data.data_intake?.quality_check;$('preview-state').textContent=q&&!q.accepted?'QC failed':'Database · v'+(data.database_version||2023);
  lines=q&&!q.accepted?qualityRecord().filter(x=>x.startsWith('FAIL')||x.startsWith('RETURN')).slice(0,3):['Select a saved release, or add one checked batch.'];
 }else{
  $('preview-state').textContent=(stage.reused?'Reused':states[stage.status]||stage.status)+(data.has_run?' · GitHub #'+data.number:'');
  const record=previewLog?.run_id===data.run_id&&previewLog?.stage===key?previewLog:null;
  if(record?.lines.length){lines=record.lines.slice(-3);$('preview-state').textContent=record.source+' · '+(stage.reused?'Reused':states[stage.status]||stage.status);}
  else lines=stage.reused?['Verified outputs retained.']:stage.status==='waiting'?['Waiting for '+(stage.parents.map(p=>names[p]).join(' + ')||'the selected data release')+'.']:['Reading the GitHub execution record…'];
  loadPreviewLog(key);
 }
 $('preview-record').textContent=lines.join('\n');$('preview').hidden=false;placePopup($('preview'),node(key));
}
async function loadPreviewLog(key){
 if(!data.has_run||previewLogPending||(previewLog?.stage===key&&previewLog?.run_id===data.run_id&&Date.now()-previewLogAt<2500))return;
 previewLogPending=true;const run=data.run_id;let updated=false;
 try{const r=await fetch('/api/stage-log?stage='+key,{cache:'no-store'});if(r.ok){const record=await r.json();if(data.run_id===run){previewLog=record;previewLogAt=Date.now();updated=true;}}}catch{}finally{previewLogPending=false;}
 if(updated&&previewKey===key&&data.run_id===run&&previewLog?.stage===key)showPreview(key);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hidePreview();$('console').hidden=true;$('logs').setAttribute('aria-expanded','false');$('logs').textContent='Show record';}});
function links(){
 const root=$('chain');root.querySelector('.edges')?.remove();if(!data)return;
 const impact=affected(),stages=new Map(data.stages.map(s=>[s.key,s])),rect=root.getBoundingClientRect(),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.classList.add('edges');
 const defs=document.createElementNS(ns,'defs');
 for(const [id,color] of Object.entries({base:'#657f91',muted:'#9bb0bc',selected:'#0085ca',active:'#b77b1c'})){
  const marker=document.createElementNS(ns,'marker');for(const [name,value] of Object.entries({id:'arrow-'+id,viewBox:'0 0 8 8',refX:'7',refY:'4',markerWidth:'7',markerHeight:'7',markerUnits:'userSpaceOnUse',orient:'auto'}))marker.setAttribute(name,value);
  const head=document.createElementNS(ns,'path');head.setAttribute('d','M1 1L7 4L1 7');head.setAttribute('style','fill:none;stroke:'+color+';stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round');marker.append(head);defs.append(marker);
 }svg.append(defs);svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
 for(const child of data.stages)for(const parent of child.key==='extract'?['data']:child.parents||[]){
  const a=root.querySelector(`[data-key="${parent}"]`)?.getBoundingClientRect(),b=root.querySelector(`[data-key="${child.key}"]`)?.getBoundingClientRect();if(!a||!b)continue;
  // Highlight the selected execution path, not every input feeding an affected stage.
  const inPath=impact.has(child.key)&&(impact.has(parent)||(parent==='data'&&selected==='data'));
  const reusedInput=child.reused||stages.get(parent)?.reused;
  const muted=selected?!inPath:!!reusedInput;
  const port=child.key==='synthesis'?(child.parents.indexOf(parent)+1)/(child.parents.length+1):.5;
  const x=a.right-rect.left+1,y=a.top+a.height/2-rect.top,X=b.left-rect.left-5,Y=b.top+b.height*port-rect.top,m=(x+X)/2,path=document.createElementNS(ns,'path');
  path.dataset.from=parent;path.dataset.to=child.key;
  if(parent==='extract'&&child.key.startsWith('prepare_')){
   const top=child.key==='prepare_vessel',rail=top?3:rect.height-3,target=b.left-rect.left+b.width*.6,end=top?b.top-rect.top-5:b.bottom-rect.top+5;
   path.classList.add('data-edge');path.setAttribute('d',`M${x},${y}C${x+12},${y} ${x+12},${rail} ${x+28},${rail}H${target-10}Q${target},${rail} ${target},${end}`);
   const label=document.createElementNS(ns,'text');label.classList.add('edge-label');label.classList.toggle('muted',muted);label.setAttribute('x',x+32);label.setAttribute('y',rail+(top?-5:12));label.textContent='Catch · length/age comps · …';svg.append(label);
  }else path.setAttribute('d',`M${x},${y}C${m},${y} ${m},${Y} ${X},${Y}`);
  path.classList.toggle('preview',!!selected&&inPath);
  path.classList.toggle('muted',muted);
  const running=!expected&&!sending&&!muted&&!reusedInput&&child.status==='running';
  path.classList.toggle('active',running);path.setAttribute('marker-end','url(#arrow-'+(muted?'muted':running?'active':selected&&inPath?'selected':'base')+')');
  svg.append(path);
 }
 root.append(svg);
}
new ResizeObserver(()=>requestAnimationFrame(()=>{links();if(previewKey)showPreview(previewKey);if($('sql-view').open)placePopup($('sql-view'),node('extract'));})).observe($('chain'));
function friendlyStep(name){if(name==='Retrieve locked analysis modules')return 'Load six code repositories at locked commits';if(name==='Prepare the pinned Docker environment')return 'Pull container image';if(name==='Checkout')return 'Check out analysis code';if(name==='Checkout source data')return 'Check out data settings';if(name==='Fetch versioned database snapshot')return 'Download the recorded data release';if(name==='Set up job')return 'Start runner';if(name==='Save the complete workflow outputs')return 'Save outputs';const stage=data?.stages.find(s=>s._step_number===data.execution?.jobs?.[0]?.steps.find(x=>x.name===name)?.number);return stage?names[stage.key]+(name.endsWith(' · reused')?' · reused':''):name;}
function showConsole(){if(!data)return;if(data.has_run===false){$('console-title').textContent='Ready for a new demonstration';$('console-lines').textContent='The previous execution records have been cleared.';$('console-link').removeAttribute('href');return;}const steps=(data.execution?.jobs||[]).flatMap(j=>j.steps||[]),actual=consoleRecord?.run_id===data.run_id&&consoleRecord?.attempt===data.attempt;let lines=[];if(actual){$('console-title').textContent='GitHub console · completed run';lines=consoleRecord.lines.map(line=>line.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*/,(_,t)=>time(t)+'  '));}else{$('console-title').textContent='Live GitHub step record';for(const s of steps)if(s.started_at&&['in_progress','completed'].includes(s.status))lines.push(time(s.started_at)+'  '+(s.status==='completed'?(s.conclusion==='success'?'✓':s.name.endsWith(' · reused')?'↺':'×'):'▶')+' '+s.name);if(!lines.length)lines=['Waiting for GitHub to assign a runner.'];}if(expected){$('console-title').textContent='Update stored · waiting for GitHub';lines=[expected.startsWith('db-')?'Database release '+expected.slice(3):'Settings commit '+expected.slice(0,8),'The update triggers the workflow in the analysis repository.'];}const qc=data.data_intake?.quality_check,qcView=qc&&(!qc.accepted||selected==='data');if(qcView){$('console-title').textContent='Data quality check · Database';lines=qualityRecord();}const text=lines.join('\n'),el=$('console-lines');if(el.textContent!==text){el.textContent=text;el.scrollTop=el.scrollHeight;}$('console-link').href=data.run_url;$('console-link').textContent=qcView&&!qc.accepted?'Previous GitHub run ↗':'View run ↗';}
async function loadConsole(){if(data.has_run===false||consolePending||data.status!=='completed'||(consoleRecord?.run_id===data.run_id&&consoleRecord?.attempt===data.attempt))return;consolePending=true;try{const r=await fetch('/api/console',{cache:'no-store'});if(r.ok){const next=await r.json();if(next.ready&&next.lines.length)consoleRecord=next;}}catch{}finally{consolePending=false;showConsole();}}
function notice(text){$('notice-text').textContent=text;$('notice').hidden=false;}
function draw(){if(!data)return;const impact=affected(),key=selectedKey(),steps=(data.execution?.jobs||[]).flatMap(j=>j.steps||[]),active=steps.find(s=>s.status==='in_progress'),reused=data.stages.filter(s=>s.reused).length,busy=sending||!!expected||data.status!=='completed',stale=data.source?.stale,cloudBlocked=data.session&&!data.session.can_update;
 $('run-link').textContent=data.has_run===false?'Ready':'Run #'+data.number;$('run-link').href=data.run_url;$('run-state').textContent=data.demo?.phase==='cleaning'?'Resetting…':data.has_run===false?'Ready for a fresh demonstration':stale?'Last verified state':expected?'New run pending':data.status==='completed'?(data.conclusion==='success'?'Complete · '+(data.stages.length-reused)+' run · '+reused+' reused':data.conclusion):data.stages.filter(s=>s.status==='running').length>1?data.stages.filter(s=>s.status==='running').length+' analyses running in parallel':data.status.replaceAll('_',' ');$('live-dot').className='dot '+(busy?'live':data.conclusion==='success'?'success':'');
 const source=node('data');source.classList.toggle('selected',selected==='data');source.querySelector('.node-control').setAttribute('aria-pressed',String(selected==='data'));const qc=data.data_intake?.quality_check,version=data.database_version||(data.data_intake?.published?qc?.proposed_version:null);source.querySelector('.release').textContent=version?'v'+version:'Versioned data';source.querySelector('.qc').textContent=sending&&changeKind==='data'?'Checking QC…':qc?(qc.accepted?'✓ QC passed':'× QC failed'):'QC before release';if(Number(version)>=2024&&(!qc||qc.accepted))source.querySelector('.qc').textContent='✓ One added batch';source.querySelector('.qc').classList.toggle('failed',!!qc&&!qc.accepted);
 for(const s of data.stages){const el=node(s.key),state=expected?(impact.has(s.key)||!selected?'waiting':s.status):s.status;el.className='stage '+state+(s.reused&&!expected?' reused':'')+(selected&&impact.has(s.key)?' impacted':'')+(selected&&!impact.has(s.key)?' outside-impact':'')+(selected===s.key?' selected':'');el.querySelector('.state-icon').textContent=s.reused&&!expected?'↺':icons[state]||'·';el.querySelector('.state-label').textContent=s.reused&&!expected?'Reused':states[state]||state;el.querySelector('.node-control').setAttribute('aria-pressed',String(selected===s.key));el.title=(s.parents.length?'Inputs: '+s.parents.map(p=>names[p]).join(' + '):'Input: accepted database release')+' · select to update downstream';}
 const count=selected?impact.size:data.stages.length,pendingCount=new Set([key,...Object.keys(pendingBranches())]).size,replayData=key==='data'&&Number(data.database_version)>=2024;
 $('selection-title').textContent=key==='data'?(replayData?'Replay data update':'New data'):names[key]+(key.startsWith('prepare_')||key.startsWith('assessment_')?' · CPUE '+(key.includes('vessel')?'A':'B'):'');
 $('progress').textContent=(data.has_run===false&&!data.baseline_available&&key!=='data'?'Prepare initial inputs → ':key==='data'?(replayData?'Replay the accepted data update → ':'Add one batch → QC → '):pendingCount>1?pendingCount+' starting stages → ':'Run this stage → ')+count+' stages run'+(count<data.stages.length?' · '+(data.stages.length-count)+' kept':'');
 for(const item of ['data',...data.stages.map(s=>s.key)])sourceLink(item);
 $('data-picker').hidden=key!=='data';
 if(key==='data'){const choices=[...(data.data_versions||[2023]).map(v=>[String(v),'Release '+v]),['new',Number(data.latest_database_version)>=2024?'Replay new-data update':'Add checked batch']];const signature=JSON.stringify(choices);if($('data-version').dataset.choices!==signature){$('data-version').replaceChildren(...choices.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));$('data-version').dataset.choices=signature;}$('data-version').value=dataDraft||'new';}
 $('sql-button').hidden=key!=='extract';$('sql-button').disabled=!nextSource('extract');
 drawBranches(key,busy);
 $('run').disabled=busy||!!stale;$('run').setAttribute('aria-disabled',String(busy||!!stale||!!cloudBlocked));$('run').textContent=sending?'Submitting…':expected?'Starting…':key==='data'?(replayData?'Replay data update →':'Add data + run →'):pendingCount>1?'Run selected changes →':'Run from '+names[key]+' →';if(key==='data'&&dataDraft&&dataDraft!=='new'){$('selection-title').textContent='Data release '+dataDraft;$('progress').textContent='Restore this snapshot → 11 stages run';$('run').textContent=busy?'Starting…':'Run with v'+dataDraft+' →';}
 $('run').title=cloudBlocked?data.session.message:'Run from '+$('selection-title').textContent+' and update its dependent stages on GitHub Actions';$('invalid').hidden=key!=='data'||!data.database_connected;$('invalid').disabled=busy||!!stale;
 $('record-dot').className=$('live-dot').className;$('verified').textContent=time(data.source?.last_success);$('message').className='';
 $('message').textContent=sending?(changeKind==='data'?'Validate and publish incoming data…':'Commit the selected update…'):expected?'Update stored → waiting for the next GitHub run':stale?'Connection interrupted · showing the last verified run':active?'Running on GitHub · '+(data.stages.filter(s=>s.status==='running').map(s=>names[s.key]).join(' + ')||friendlyStep(active.name)):data.status==='completed'?(data.conclusion==='success'?'✓ Outputs saved · report ready':'GitHub run '+data.conclusion):'GitHub is assigning a runner…';
 if(data.has_run===false&&!busy){$('message').textContent='Ready · verified baseline inputs available';$('run-link').removeAttribute('href');}
 if(data.demo?.reset_at&&!busy){const seconds=Math.max(0,Math.ceil((Date.parse(data.demo.reset_at)-Date.now())/1000));$('message').textContent+=' · resets in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
 if(cloudBlocked&&!busy&&!stale){$('message').textContent=data.session.message.includes('owner')?'Viewing only · owner GitHub connection needed':data.session.message;$('message').className='read-only';}
 if(qc&&!qc.accepted&&!busy){$('message').textContent='QC rejected the batch · data and GitHub run unchanged';}
 requestAnimationFrame(links);showConsole();loadConsole();if(previewKey)showPreview(previewKey);}
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
 const source=choices[preferred];$('branch-commit').textContent=source.commit.slice(0,8)+' ↗';$('branch-commit').href='https://github.com/'+source.repository+'/commit/'+source.commit;
 $('branch-picker').title='Each stage has its own branch. Run applies all pending choices together.';
}
async function loadBranches(){if(branchLoading)return;branchLoading=true;try{const response=await fetch('/api/branches',{cache:'no-store'});if(response.ok){branchCatalog=await response.json();if(data)draw();}}catch{}finally{branchLoading=false;}}
$('branch').onchange=()=>{branchDrafts[selectedKey()]=$('branch').value;hidePreview();draw();};
async function publish(invalid=false){
 if(!data||sending||expected||data.status!=='completed'||data.source?.stale)return;
 if(data.session&&!data.session.can_update){notice(data.session.message);return;}
 const stage=selectedKey(),choices=pendingBranches();
 if(stage!=='data'&&branchCatalog?.options[stage])choices[stage]=$('branch').value;
 if(!invalid&&!branchCatalog){notice('Loading registered branches. Please try again in a moment.');loadBranches();return;}
 runRoots=[...new Set([dataDraft&&dataDraft!=='new'&&Number(dataDraft)!==Number(data.database_version)?'data':stage,...Object.keys(choices)])];hidePreview();sending=true;changeKind=stage;$('notice').hidden=true;draw();
 try{
  const r=await fetch(invalid?'/api/check-invalid-data':'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Workshop-Action':'publish-synthetic-data','X-Workshop-Request':crypto.randomUUID()},body:invalid?'{}':JSON.stringify({start:stage,branches:choices,...(dataDraft&&dataDraft!=='new'?{data_version:Number(dataDraft)}:{})})}),result=await r.json();
  if(!r.ok)throw Error(result.detail||'Update failed');
  expected=result.published===false?'':result.commit||(result.database_version?'db-'+result.database_version:'');
  if(result.published===false){$('console').hidden=false;$('logs').setAttribute('aria-expanded','true');$('logs').textContent='Hide record';}
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
 $('run').onclick=()=>publish();$('invalid').onclick=()=>publish(true);$('logs').onclick=()=>{$('console').hidden=!$('console').hidden;$('logs').setAttribute('aria-expanded',String(!$('console').hidden));$('logs').textContent=$('console').hidden?'Show record':'Hide record';showConsole();};$('dismiss').onclick=()=>{$('notice').hidden=true;};
if(parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');refresh();loadBranches();setInterval(refresh,2000);
async function heartbeat(){try{const r=await fetch('/api/presentation-info',{cache:'no-store'});if(r.ok&&(await r.json()).presentation==='cpue-workshop'&&parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');}catch{}}
heartbeat();setInterval(heartbeat,4000);
