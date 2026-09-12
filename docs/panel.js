
const $=id=>document.getElementById(id);
const positions={data:[1,1,5],extract:[2,1,5],cpue_vessel:[3,1,3],cpue_year:[3,3,5],prepare_vessel:[4,1,3],prepare_year:[4,3,5],assessment_vessel_ref:[5,1,2],assessment_vessel_high_m:[5,2,3],assessment_year_ref:[5,3,4],assessment_year_high_m:[5,4,5],synthesis:[6,1,5],report:[7,1,5]};
const names={data:'Data',extract:'Extract',cpue_vessel:'CPUE A',cpue_year:'CPUE B',prepare_vessel:'Input prep',prepare_year:'Input prep',assessment_vessel_ref:'Assessment 1',assessment_vessel_high_m:'Assessment 2',assessment_year_ref:'Assessment 1',assessment_year_high_m:'Assessment 2',synthesis:'Synthesis',report:'Report'};
const states={waiting:'Waiting',queued:'Queued',idle:'Queued',running:'Running',completed:'Complete',failed:'Failed',blocked:'Blocked',cancelled:'Cancelled'},icons={completed:'✓',running:'◌',failed:'×',blocked:'×',cancelled:'–'};
let branchCatalog=null,branchLoading=false,runRoots=null;const branchDrafts={};
let data=null,sending=false,expected='',selected=null,consoleRecord=null,consolePending=false,changeKind='data',lastRefresh=0,refreshing=false,previewKey=null,previewTimer=null;
const time=t=>t?new Date(t).toLocaleTimeString('en-GB',{hour12:false}):'';
const selectedKey=()=>selected||'data';
function pendingBranches(){return Object.fromEntries(Object.entries(branchDrafts).filter(([key,branch])=>branch!==branchCatalog?.sources[key]?.branch));}
function affected(){
 if(!data||(!selected&&!runRoots&&!Object.keys(pendingBranches()).length))return new Set();
 const roots=runRoots&&(sending||expected||data.status!=='completed')?runRoots:[...Object.keys(pendingBranches()),...(selected?[selected]:[])];
 if(roots.includes('data')||(data.has_run===false&&!data.baseline_available))return new Set(data.stages.map(s=>s.key));
 const result=new Set(roots);
 let changed=true;while(changed){changed=false;for(const s of data.stages)if(!result.has(s.key)&&(s.parents||[]).some(p=>result.has(p))){result.add(s.key);changed=true;}}
 return result;
}
function node(key){let el=$('chain').querySelector(`[data-key="${key}"]`);if(el)return el;el=document.createElement('button');el.dataset.key=key;el.className=key==='data'?'data-node':'stage';const [col,start,end]=positions[key];el.style.gridColumn=col;el.style.gridRow=`${start} / ${end}`;const title=document.createElement('strong');title.textContent=names[key];el.append(title);if(key==='data'){const version=document.createElement('div');version.className='release';const qc=document.createElement('div');qc.className='qc';el.append(version,qc);}else{const state=document.createElement('small');state.innerHTML='<span class="state-icon"></span><span class="state-label"></span>';el.append(state);}el.onclick=()=>{selected=key;draw();showPreview(key);};el.onmouseenter=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>showPreview(key),180);};el.onmouseleave=hidePreview;el.onfocus=()=>showPreview(key);el.onblur=hidePreview;$('chain').append(el);return el;}
function qualityRecord(){const q=data?.data_intake?.quality_check;if(!q)return [];const stamp=time(data.data_intake.checked_at?data.data_intake.checked_at*1000:null),lines=[(stamp?stamp+'  ':'')+'CHECK  incoming release '+q.proposed_version+' · '+q.rows_received+' records'];for(const e of q.errors||[]){lines.push('FAIL  '+e.code+' · '+e.message);if(e.failed_records)lines.push('      '+e.failed_records+' record(s) failed');for(const example of e.examples||[])lines.push('      '+example.set_id+' · '+(e.field||'value')+' = '+JSON.stringify(example.observed));}if(q.accepted)lines.push('PASS  '+(q.checks||[]).join(' · '));lines.push(q.accepted?'ACCEPT  validated records may be published':'RETURN  correct the data and resubmit · no release or analysis run');if(q.rule_version)lines.push('RULES  v'+q.rule_version+' · '+(q.rules_sha256||'').slice(0,12));return lines;}
function hidePreview(){clearTimeout(previewTimer);previewKey=null;$('preview').hidden=true;}
function showPreview(key){if(!data||sending)return;previewKey=key;const s=data.stages.find(s=>s.key===key),steps=(data.execution?.jobs||[]).flatMap(j=>j.steps||[]),step=s?steps.find(x=>x.number===s._step_number):null;
 $('preview-title').textContent=names[key]+(key.includes('assessment_')||key.includes('prepare_')?' · CPUE '+(key.includes('vessel')?'A':'B'):'');
 let lines=[];
 if(key==='data'){const q=data.data_intake?.quality_check;$('preview-state').textContent='Database release '+(data.database_version||'');lines=q?(q.accepted?['Quality check passed. Accepted records form an immutable snapshot.']:qualityRecord().slice(1,-2)):['New data → quality check → release → GitHub workflow.'];if(q&&!q.accepted)$('preview-state').textContent='QC failed · Database · incoming '+q.proposed_version;}
 else if(data.has_run===false){$('preview-state').textContent='Ready · no active demonstration';lines=['A verified baseline supplies unchanged inputs.','Only this stage and its dependants run.'];}
 else{
  $('preview-state').textContent=(s.reused?'Reused · verified outputs':states[s.status]||s.status)+' · GitHub #'+data.number;
  if(s.reused)lines=['Restored outputs passed checksum verification.','This stage was not recalculated in this run.'];
  else if(expected)lines=['The update is stored. Waiting for the new GitHub run.'];
  else if(step?.started_at||s.started_at)lines=[time(step?.started_at||s.started_at)+'  '+(s.status==='running'?'Started · running now':'Started'),...(s.completed_at?[time(s.completed_at)+'  Completed']:[])];
  else lines=['Waiting for '+(s.parents.length?s.parents.map(p=>names[p]).join(' + '):'a runner and the data snapshot')+'.'];
  if(s.status==='running')lines.push('Live step status from GitHub Actions.');
  const tags={extract:'EXTRACT',cpue_vessel:'CPUE',cpue_year:'CPUE',prepare_vessel:'INPUT PREPARATION',prepare_year:'INPUT PREPARATION',synthesis:'SYNTHESIS',report:'REPORT'};
  const tag=tags[key]||'ASSESSMENT';
  if(!s.reused&&consoleRecord?.run_id===data.run_id&&consoleRecord?.attempt===data.attempt){const matching=consoleRecord.lines.filter(x=>x.includes(tag+' complete:')&&(!key.startsWith('cpue_')||x.includes(key.includes('vessel')?'vessel_adjusted':'year_only'))&&(!key.startsWith('assessment_')||x.includes(key)));if(matching.length)lines.push(matching.at(-1).replace(/^\S+\s*/,''));}
  if(key==='extract'&&!s.started_at){const setup=steps.find(x=>x.status==='in_progress');if(setup)lines.push('GitHub: '+friendlyStep(setup.name));}
 }
 const source=s?.code_source;$('preview-source').hidden=!source;$('preview-source').textContent=source?source.repository.replace('kyuhank/','')+' · '+source.branch+' @ '+source.commit.slice(0,8):'';
 $('preview-inputs').hidden=!key.startsWith('prepare_');$('preview-inputs').textContent='Typical inputs: CPUE, catch, length and age compositions, and other assessment data.\nThis demo calculates with CPUE and catch.';
 $('preview-record').textContent=lines.join('\n');$('preview').hidden=false;const anchor=node(key).getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect(),box=$('preview');box.style.left=Math.min(main.width-box.offsetWidth-12,Math.max(12,anchor.left-main.left+anchor.width/2-box.offsetWidth/2))+'px';const below=anchor.bottom-main.top+8;box.style.top=(below+box.offsetHeight<340?below:Math.max(42,anchor.top-main.top-box.offsetHeight-8))+'px';
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hidePreview();$('console').hidden=true;$('logs').setAttribute('aria-expanded','false');$('logs').textContent='Show record';}});
function links(){
 const root=$('chain');root.querySelector('.edges')?.remove();if(!data)return;
 const impact=affected(),stages=new Map(data.stages.map(s=>[s.key,s])),rect=root.getBoundingClientRect(),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.classList.add('edges');svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
 for(const child of data.stages)for(const parent of child.key==='extract'?['data']:child.parents||[]){
  const a=root.querySelector(`[data-key="${parent}"]`)?.getBoundingClientRect(),b=root.querySelector(`[data-key="${child.key}"]`)?.getBoundingClientRect();if(!a||!b)continue;
  // Highlight the selected execution path, not every input feeding an affected stage.
  const inPath=impact.has(child.key)&&(impact.has(parent)||(parent==='data'&&selected==='data'));
  const reusedInput=child.reused||stages.get(parent)?.reused;
  const muted=selected?!inPath:!!reusedInput;
  const x=a.right-rect.left,y=a.top+a.height/2-rect.top,X=b.left-rect.left,Y=b.top+b.height/2-rect.top,m=(x+X)/2,path=document.createElementNS(ns,'path');
  path.dataset.from=parent;path.dataset.to=child.key;
  if(parent==='extract'&&child.key.startsWith('prepare_')){
   const top=child.key==='prepare_vessel',rail=top?3:rect.height-3,target=b.left-rect.left+b.width*.6,end=top?b.top-rect.top:b.bottom-rect.top;
   path.classList.add('data-edge');path.setAttribute('d',`M${x},${y}C${x+12},${y} ${x+12},${rail} ${x+28},${rail}H${target-10}Q${target},${rail} ${target},${end} M${target-3},${end+(top?-4:4)}L${target},${end}L${target+3},${end+(top?-4:4)}`);
   const label=document.createElementNS(ns,'text');label.classList.add('edge-label');label.classList.toggle('muted',muted);label.setAttribute('x',x+32);label.setAttribute('y',rail+(top?-5:12));label.textContent='Catch · length/age comps · …';svg.append(label);
  }else path.setAttribute('d',`M${x},${y}C${m},${y} ${m},${Y} ${X},${Y} M${X-4},${Y-3}L${X},${Y}L${X-4},${Y+3}`);
  path.classList.toggle('preview',!!selected&&inPath);
  path.classList.toggle('muted',muted);
  path.classList.toggle('active',!expected&&!sending&&!muted&&!reusedInput&&child.status==='running');
  svg.append(path);
 }
 root.append(svg);
}
new ResizeObserver(()=>requestAnimationFrame(links)).observe($('chain'));
function friendlyStep(name){if(name==='Retrieve locked analysis modules')return 'Load six code repositories at locked commits';if(name==='Prepare the pinned Docker environment')return 'Pull container image';if(name==='Checkout')return 'Check out analysis code';if(name==='Checkout source data')return 'Check out data settings';if(name==='Fetch versioned database snapshot')return 'Download the recorded data release';if(name==='Set up job')return 'Start runner';if(name==='Save the complete workflow outputs')return 'Save outputs';const stage=data?.stages.find(s=>s._step_number===data.execution?.jobs?.[0]?.steps.find(x=>x.name===name)?.number);return stage?names[stage.key]+(name.endsWith(' · reused')?' · reused':''):name;}
function showConsole(){if(!data)return;if(data.has_run===false){$('console-title').textContent='Ready for a new demonstration';$('console-lines').textContent='The previous execution records have been cleared.';$('console-link').removeAttribute('href');return;}const steps=(data.execution?.jobs||[]).flatMap(j=>j.steps||[]),actual=consoleRecord?.run_id===data.run_id&&consoleRecord?.attempt===data.attempt;let lines=[];if(actual){$('console-title').textContent='GitHub console · completed run';lines=consoleRecord.lines.map(line=>line.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*/,(_,t)=>time(t)+'  '));}else{$('console-title').textContent='Live GitHub step record';for(const s of steps)if(s.started_at&&['in_progress','completed'].includes(s.status))lines.push(time(s.started_at)+'  '+(s.status==='completed'?(s.conclusion==='success'?'✓':s.name.endsWith(' · reused')?'↺':'×'):'▶')+' '+s.name);if(!lines.length)lines=['Waiting for GitHub to assign a runner.'];}if(expected){$('console-title').textContent='Update stored · waiting for GitHub';lines=[expected.startsWith('db-')?'Database release '+expected.slice(3):'Settings commit '+expected.slice(0,8),'The update triggers the workflow in the analysis repository.'];}const qc=data.data_intake?.quality_check,qcView=qc&&(!qc.accepted||selected==='data');if(qcView){$('console-title').textContent='Data quality check · Database';lines=qualityRecord();}const text=lines.join('\n'),el=$('console-lines');if(el.textContent!==text){el.textContent=text;el.scrollTop=el.scrollHeight;}$('console-link').href=data.run_url;$('console-link').textContent=qcView&&!qc.accepted?'Previous GitHub run ↗':'View run ↗';}
async function loadConsole(){if(data.has_run===false||consolePending||data.status!=='completed'||(consoleRecord?.run_id===data.run_id&&consoleRecord?.attempt===data.attempt))return;consolePending=true;try{const r=await fetch('/api/console',{cache:'no-store'});if(r.ok){const next=await r.json();if(next.ready&&next.lines.length)consoleRecord=next;}}catch{}finally{consolePending=false;showConsole();}}
function notice(text){$('notice-text').textContent=text;$('notice').hidden=false;}
function draw(){if(!data)return;const impact=affected(),key=selectedKey(),steps=(data.execution?.jobs||[]).flatMap(j=>j.steps||[]),active=steps.find(s=>s.status==='in_progress'),reused=data.stages.filter(s=>s.reused).length,busy=sending||!!expected||data.status!=='completed',stale=data.source?.stale,cloudBlocked=data.session&&!data.session.can_update;
 $('run-link').textContent=data.has_run===false?'Ready':'Run #'+data.number;$('run-link').href=data.run_url;$('run-state').textContent=data.demo?.phase==='cleaning'?'Resetting…':data.has_run===false?'Ready for a fresh demonstration':stale?'Last verified state':expected?'New run pending':data.status==='completed'?(data.conclusion==='success'?'Complete · '+(data.stages.length-reused)+' run · '+reused+' reused':data.conclusion):data.stages.filter(s=>s.status==='running').length>1?data.stages.filter(s=>s.status==='running').length+' analyses running in parallel':data.status.replaceAll('_',' ');$('live-dot').className='dot '+(busy?'live':data.conclusion==='success'?'success':'');
 const source=node('data');source.classList.toggle('selected',selected==='data');source.setAttribute('aria-pressed',String(selected==='data'));const qc=data.data_intake?.quality_check,version=data.database_version||(data.data_intake?.published?qc?.proposed_version:null);source.querySelector('.release').textContent=version?'v'+version:'Versioned data';source.querySelector('.qc').textContent=sending&&changeKind==='data'?'Checking QC…':qc?(qc.accepted?'✓ QC passed':'× QC failed'):'QC before release';if(Number(version)>=2024&&(!qc||qc.accepted))source.querySelector('.qc').textContent='✓ One added batch';source.querySelector('.qc').classList.toggle('failed',!!qc&&!qc.accepted);
 for(const s of data.stages){const el=node(s.key),state=expected?(impact.has(s.key)||!selected?'waiting':s.status):s.status;el.className='stage '+state+(s.reused&&!expected?' reused':'')+(selected&&impact.has(s.key)?' impacted':'')+(selected&&!impact.has(s.key)?' outside-impact':'')+(selected===s.key?' selected':'');el.querySelector('.state-icon').textContent=s.reused&&!expected?'↺':icons[state]||'·';el.querySelector('.state-label').textContent=s.reused&&!expected?'Reused':states[state]||state;el.setAttribute('aria-pressed',String(selected===s.key));el.title=(s.parents.length?'Inputs: '+s.parents.map(p=>names[p]).join(' + '):'Input: accepted database release')+' · select to update downstream';}
 const count=selected?impact.size:data.stages.length,pendingCount=new Set([key,...Object.keys(pendingBranches())]).size,replayData=key==='data'&&Number(data.database_version)>=2024;
 $('selection-title').textContent=key==='data'?(replayData?'Replay data update':'New data'):names[key]+(key.startsWith('prepare_')||key.startsWith('assessment_')?' · CPUE '+(key.includes('vessel')?'A':'B'):'');
 $('progress').textContent=(data.has_run===false&&!data.baseline_available&&key!=='data'?'Prepare initial inputs → ':key==='data'?(replayData?'Replay the accepted data update → ':'Add one batch → QC → '):pendingCount>1?pendingCount+' starting stages → ':'Run this stage → ')+count+' stages run'+(count<data.stages.length?' · '+(data.stages.length-count)+' kept':'');
 drawBranches(key,busy);
 $('run').disabled=busy||!!stale;$('run').setAttribute('aria-disabled',String(busy||!!stale||!!cloudBlocked));$('run').textContent=sending?'Submitting…':expected?'Starting…':key==='data'?(replayData?'Replay data update →':'Add data + run →'):pendingCount>1?'Run selected changes →':'Run from '+names[key]+' →';$('run').title=cloudBlocked?data.session.message:'Run from '+$('selection-title').textContent+' and update its dependent stages on GitHub Actions';$('invalid').hidden=key!=='data'||!data.database_connected;$('invalid').disabled=busy||!!stale;
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
 runRoots=[...new Set([stage,...Object.keys(choices)])];hidePreview();sending=true;changeKind=stage;$('notice').hidden=true;draw();
 try{
  const r=await fetch(invalid?'/api/check-invalid-data':'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Workshop-Action':'publish-synthetic-data','X-Workshop-Request':crypto.randomUUID()},body:invalid?'{}':JSON.stringify({start:stage,branches:choices})}),result=await r.json();
  if(!r.ok)throw Error(result.detail||'Update failed');
  expected=result.published===false?'':result.commit||(result.database_version?'db-'+result.database_version:'');
  if(result.published===false){$('console').hidden=false;$('logs').setAttribute('aria-expanded','true');$('logs').textContent='Hide record';}
 }catch(e){notice(e.message);}finally{sending=false;draw();await refresh(true);}
}
$('run').onclick=()=>publish();$('invalid').onclick=()=>publish(true);$('logs').onclick=()=>{$('console').hidden=!$('console').hidden;$('logs').setAttribute('aria-expanded',String(!$('console').hidden));$('logs').textContent=$('console').hidden?'Show record':'Hide record';showConsole();};$('dismiss').onclick=()=>{$('notice').hidden=true;};
if(parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');refresh();loadBranches();setInterval(refresh,2000);
async function heartbeat(){try{const r=await fetch('/api/presentation-info',{cache:'no-store'});if(r.ok&&(await r.json()).presentation==='cpue-workshop'&&parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');}catch{}}
heartbeat();setInterval(heartbeat,4000);
