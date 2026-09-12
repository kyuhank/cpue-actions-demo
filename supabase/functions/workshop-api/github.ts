import { unzipSync, gunzipSync } from 'npm:fflate@0.8.2';
export const REPO = 'kyuhank/cpue-toy-data';
export const DEMO_BRANCH = 'demo-runtime';
export const definitions = [
 ['extract','01 Extract',[]], ['cpue_vessel','02 CPUE: year + vessel',['extract']],
 ['cpue_year','02 CPUE: year only',['extract']],
 ['cpue_summary','02 CPUE results summary',['cpue_vessel','cpue_year']],
 ['cpue_report','02 CPUE report',['cpue_summary']],
 ['prepare_vessel','03 Prepare inputs: vessel',['extract','cpue_vessel']],
 ['prepare_year','03 Prepare inputs: year',['extract','cpue_year']],
 ['assessment_vessel_ref','04 Assessment: vessel, lower M',['prepare_vessel']],
 ['assessment_vessel_high_m','04 Assessment: vessel, higher M',['prepare_vessel']],
 ['assessment_year_ref','04 Assessment: year, lower M',['prepare_year']],
 ['assessment_year_high_m','04 Assessment: year, higher M',['prepare_year']],
 ['synthesis','05 Results synthesis',['assessment_vessel_ref','assessment_vessel_high_m','assessment_year_ref','assessment_year_high_m']],
 ['report','06 Report',['synthesis']],
] as const;
export const changeable = new Set(definitions.map(x=>x[0]));
export const intakeKeys=new Set(['submission','qc','ingest']);
export const outputKeys=new Set([...changeable,...intakeKeys]);
export function outputNames(key:string):string[]{
 const common=['results.html','manifest.json','record.json'];
 if(intakeKeys.has(key))return ['submission.json','receipt.json','quality.json','first-quality.json','accepted-submission.json','correction.json','release.json','prepared.json',...common];
 if(['cpue_summary','cpue_report'].includes(key))return ['cpue.csv','comparison.csv','cpue.svg','report.html',...common];
 if(key==='extract')return ['sets.csv','catch.csv','extract.sql','extract-catch.sql',...common];
 if(key.startsWith('cpue_'))return ['cpue.csv','cpue-diagnostics.txt','cpue-diagnostics.json',...common];
 if(key.startsWith('prepare_'))return ['assessment-input.csv','catch.csv','cpue.csv',...common];
 if(key.startsWith('assessment_'))return ['biomass.csv','summary.csv','assessment-input.csv',...common];
 if(['synthesis','report'].includes(key))return [...(key==='report'?['report.html']:[]),'cpue.svg','biomass.svg','summary.csv','biomass.csv','cpue.csv',...common];
 return [];
}
export function outputStage(source:string){const match=source.match(/^(\d+)-(\d+)-([a-z_]+)$/);return match&&outputKeys.has(match[3] as any)?match:null;}
export async function github(path:string, method='GET', body?:unknown, allowMissing=false):Promise<Response> {
 const token=Deno.env.get('WORKSHOP_GITHUB_TOKEN');
 const headers:Record<string,string>={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'cpue-workshop','Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const r=await fetch('https://api.github.com/repos/'+REPO+'/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!r.ok&&r.status!==302&&!(allowMissing&&r.status===404))throw Error('GitHub request could not be confirmed ('+r.status+').');
 return r;
}
export async function json(path:string){return (await github(path)).json();}
export function mapRun(run:any,jobs:any[]){
 const distributed=jobs.some(j=>/\[(?:plan|extract)\]/.test(j.name));
 const physical=distributed?jobs.find(j=>j.name.includes('[plan]')):jobs[0], steps=physical?.steps||[], states:Record<string,string>={};
 const restored=steps.some((s:any)=>s.name==='Restore and verify reusable outputs'&&s.conclusion==='success');
 const stages=definitions.map(([key,label,parents])=>{
  const job=distributed?jobs.find(j=>j.name.includes('['+key+']')):physical;
  const step=distributed?job?.steps?.find((s:any)=>s.name==='Run module'):steps.find((s:any)=>s.name.replace(/ · reused$/,'').replace(/ \(0\.\d+\)/,'')===label);
  const reused=distributed?job?.conclusion==='skipped'&&job.name.includes('· reused'):!!step&&step.name.endsWith(' · reused')&&step.conclusion==='skipped'&&restored;
  let state=reused?'completed':step?.status==='in_progress'?'running':step?.status==='completed'?({success:'completed',failure:'failed',cancelled:'cancelled',skipped:'blocked',timed_out:'failed'} as any)[step.conclusion]||'blocked':run.status==='completed'?'blocked':restored&&parents.every(p=>states[p]==='completed')?'idle':'waiting';
  if(distributed)state=reused?'completed':job?.status==='in_progress'?'running':job?.status==='completed'?({success:'completed',failure:'failed',cancelled:'cancelled',skipped:'blocked',timed_out:'failed'} as any)[job.conclusion]||'blocked':run.status==='completed'?'blocked':'waiting';
  // Warm runners can prepare software while the previous group is still running.
  const barrier=distributed?job?.steps?.find((s:any)=>s.name==='Wait for previous stage group and verify inputs'):null;
  if(distributed&&job?.status==='in_progress'&&(!step||!['in_progress','completed'].includes(step.status)))state='waiting';
  states[key]=state;
  return {key,label:label.slice(3),parents,status:state,reused,source_id:`${run.id}-${run.run_attempt}-${key}`,started_at:distributed?job?.started_at:step?.started_at,completed_at:distributed?job?.completed_at:step?.completed_at,html_url:job?.html_url,_job_id:job?.id,_step_number:step?.number};
 });
 const qcSteps=jobs.find(j=>j.name?.includes('[qc]'))?.steps||[];
 const correction=qcSteps.find((s:any)=>s.name==='Correct and resubmit example'),recheck=qcSteps.find((s:any)=>s.name==='Recheck corrected submission');
 const initial=qcSteps.find((s:any)=>s.name==='QC submitted records');
 const returnStep=qcSteps.find((s:any)=>s.name==='Return failed submission');
 const returned=returnStep?.status==='in_progress'||initial?.conclusion==='failure'&&(!correction||['pending','queued'].includes(correction.status));
 const correcting=correction&&correction.status==='in_progress';
 const rechecking=correction?.conclusion==='success'&&recheck?.conclusion!=='success';
 const intake_stages=[['submission',[]],['qc',['submission']],['ingest',['qc']]].map(([key,parents])=>{
  const job=jobs.find(j=>j.name?.includes('['+key+']'));
  let status=job?.status==='in_progress'?'running':job?.conclusion==='success'?'completed':job?.conclusion==='failure'?'failed':job?.conclusion==='skipped'?(jobs.some(j=>j.name?.includes('[submission]')&&j.conclusion==='skipped')?'not_requested':'blocked'):'waiting';
  const barrier=job?.steps?.find((s:any)=>s.name==='Wait for accepted upstream records');
  if(status==='running'&&['qc','ingest'].includes(String(key))){
   const operation=job?.steps?.find((s:any)=>s.name===(key==='qc'?'QC submitted records':'Run module'));
   if(!operation||!['in_progress','completed'].includes(operation.status))status='waiting';
  }
  return {key,parents,correction_phase:key==='qc'?(returned?'returned':correcting?'resubmitting':rechecking?'rechecking':recheck?.conclusion==='success'?'corrected':null):null,status,skipped:job?.conclusion==='skipped',source_id:`${run.id}-${run.run_attempt}-${key}`,_job_id:job?.id,html_url:job?.html_url};
 });
 return {ready:true,has_run:true,stages,intake_stages,run_id:run.id,number:run.run_number,attempt:run.run_attempt,run_url:run.html_url,commit:run.head_sha,status:run.status,conclusion:run.conclusion,branch:run.head_branch,
 trigger_message:run.display_title.startsWith('Database version ')?run.display_title:(run.head_commit?.message||run.display_title).split('\n')[0].slice(0,160),database_version:/^Database version 20\d{2}$/.test(run.display_title)?Number(run.display_title.slice(-4)):null,
 execution:{mode:distributed?'module_jobs':'steps',job_count:jobs.length,jobs},source:{stale:false,last_success:new Date().toISOString()},created_at:run.created_at,completed_at:run.status==='completed'?run.updated_at:null};
}
export function emptyRun(){return {ready:true,has_run:false,baseline_available:true,stages:definitions.map(([key,label,parents])=>({key,label:label.slice(3),parents,status:'waiting',reused:false,source_id:'',_step_number:null})),run_id:null,number:null,attempt:null,run_url:'',commit:'',status:'completed',conclusion:'success',database_version:2023,execution:{mode:'steps',job_count:0,jobs:[]},source:{stale:false,last_success:new Date().toISOString()},created_at:null,completed_at:null};}
type ModuleSource={repository:string,branch:string,commit:string};
const moduleCache = new Map<string,{sources:Record<string,ModuleSource>,options:Record<string,Record<string,ModuleSource>>,dataVersion?:number,intakeSource?:ModuleSource}>();
export function validSource(key:string,source:any):source is ModuleSource{
 const part=key.split('_')[0],repo=({prepare:'inputs'} as Record<string,string>)[part]||part;
 return changeable.has(key as any)&&source?.repository==='kyuhank/cpue-demo-'+repo&&/^[a-f0-9]{40}$/.test(source.commit)&&/^[a-z0-9-]{1,60}$/.test(source.branch);
}
export function selectedModules(locked:any,catalog:any,selections:any){
 const sources:Record<string,ModuleSource>={},options:Record<string,Record<string,ModuleSource>>={};
 for(const [key] of definitions){
  if(!validSource(key,locked[key]))throw Error('Invalid module source.');
  sources[key]=locked[key];options[key]={};
  for(const [branch,source] of Object.entries(catalog[key]||{}))if(validSource(key,source)&&source.branch===branch)options[key][branch]=source;
 }
 for(const [key,value] of Object.entries(selections||{})){
  const branch=(value as any)?.branch,source=options[key]?.[branch];
  if(!source)throw Error('Unregistered branch in the recorded configuration.');
  sources[key]=source;
 }
 return {sources,options};
}
async function moduleConfiguration(triggerCommit:string){
 if(!/^[a-f0-9]{40}$/.test(triggerCommit))throw Error('An exact workflow commit is required.');
 if(moduleCache.has(triggerCommit))return moduleCache.get(triggerCommit)!;
 const workflow=await json(`contents/.github/workflows/update.yml?ref=${triggerCommit}`);
 const commit=atob(workflow.content.replace(/\s/g,'')).match(/uses:\s*kyuhank\/cpue-actions-demo\/\.github\/workflows\/toy-pipeline\.yml@([a-f0-9]{40})/)?.[1];
 if(!commit)throw Error('A pinned workshop workflow is required.');
 async function read(name:string,optional=false){
  const r=await fetch(`https://raw.githubusercontent.com/kyuhank/cpue-actions-demo/${commit}/${name}`,{signal:AbortSignal.timeout(10000)});
  if(optional&&r.status===404)return {};
  if(!r.ok)throw Error('Module versions are unavailable.');return r.json();
 }
 const [locked,catalog,config,dataConfig]=await Promise.all([read('modules.lock.json'),read('module-branches.json',true),github(`contents/config/modules.json?ref=${triggerCommit}`,'GET',undefined,true),github(`contents/config/data.json?ref=${triggerCommit}`,'GET',undefined,true)]);
 const selections=config.ok?JSON.parse(atob((await config.json()).content.replace(/\s/g,''))):{};
 const rawData=dataConfig.ok?JSON.parse(atob((await dataConfig.json()).content.replace(/\s/g,''))):{};
 const result={...selectedModules(locked,catalog,selections),intakeSource:{repository:'kyuhank/cpue-actions-demo',branch:'main',commit},dataVersion:[2021,2022,2023,2024].includes(rawData.version)?rawData.version:undefined};
 if(moduleCache.size>=16)moduleCache.clear();moduleCache.set(triggerCommit,result);return result;
}
async function runModules(run:any){try{return await moduleConfiguration(run.head_sha);}catch{return {sources:{} as Record<string,ModuleSource>,dataVersion:undefined,intakeSource:undefined};}}
export async function branches(){
 const branch=await github('git/ref/heads/'+DEMO_BRANCH,'GET',undefined,true);
 const head=branch.ok?await branch.json():await json('git/ref/heads/main');
 return moduleConfiguration(head.object.sha);
}
export async function current(){const runs=(await json('actions/workflows/update.yml/runs?per_page=1')).workflow_runs;
 if(!runs.length)return emptyRun();const r=runs[0];const [jobs,sources]=await Promise.all([json(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`),runModules(r)]);
 const result=mapRun(r,jobs.jobs);return {...result,database_version:result.database_version||sources.dataVersion||null,stages:result.stages.map(s=>({...s,code_source:sources.sources[s.key]})),intake_stages:result.intake_stages.map(s=>({...s,code_source:sources.intakeSource}))};
}
export async function ensureBranch(){
 const existing=await github('git/ref/heads/'+DEMO_BRANCH,'GET',undefined,true);
 if(existing.ok)return;
 const base=await json('git/ref/heads/main');
 await github('git/refs','POST',{ref:'refs/heads/'+DEMO_BRANCH,sha:base.object.sha});
}
export async function dispatch(version?:number,intakeMode='none',request=''){
 await ensureBranch();
 await github('actions/workflows/update.yml/dispatches','POST',{ref:DEMO_BRANCH,inputs:{...(version?{data_version:String(version)}:{}),...(intakeMode==='none'?{}:{intake_mode:intakeMode,request_id:request})}});
}
export async function removeDemonstrationRuns(upToRun:number){
 // Fixed workflow and repository: no guest can choose a deletion target.
 // Delete pages from the front because removing a run changes pagination.
 for(let page=0;page<20;page++){
  const runs=(await json('actions/workflows/update.yml/runs?per_page=100')).workflow_runs;
  if(!runs.length)break;
  if(runs.some((r:any)=>r.id>upToRun||r.status!=='completed'||r.path!=='.github/workflows/update.yml'))throw Error('A newer workflow is active; cleanup will wait.');
  for(const r of runs)await github('actions/runs/'+r.id,'DELETE',undefined,true);
 }
 const remaining=(await json('actions/workflows/update.yml/runs?per_page=1')).workflow_runs;
 if(remaining.length)throw Error('More demonstration records remain; cleanup will resume.');
 const branch=await github('git/ref/heads/'+DEMO_BRANCH,'GET',undefined,true);
 if(branch.ok)await github('git/refs/heads/'+DEMO_BRANCH,'DELETE',undefined,true);
}
async function download(response:Response,limit:number):Promise<Uint8Array>{
 let r=response;if(r.status===302){const url=new URL(r.headers.get('location')||'');if(url.protocol!=='https:'||!(/(^|\.)(githubusercontent\.com|blob\.core\.windows\.net)$/.test(url.hostname)))throw Error('Unknown GitHub download host.');r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});}
 if(!r.ok||Number(r.headers.get('content-length')||0)>limit)throw Error('Output unavailable or too large.');
 const reader=r.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Output exceeds demonstration limit.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
export async function stageOutputs(source:string){
 const id=outputStage(source);if(!id)throw Error('Unknown output.');
 const run=await json('actions/runs/'+id[1]);if(run.path!=='.github/workflows/update.yml'||run.run_attempt!==Number(id[2]))throw Error('Unknown successful workshop run.');
 const artifacts=(await json(`actions/runs/${id[1]}/artifacts?per_page=100`)).artifacts.filter((x:any)=>!x.expired);
 const a=artifacts.find((x:any)=>x.name==='stage-'+id[2]+'-'+id[3])||artifacts.find((x:any)=>x.name==='workflow-'+id[2])||artifacts.find((x:any)=>x.name==='workflow-context-'+id[2]);
 if(!a||a.size_in_bytes>16*1024*1024)throw Error('Report artifact unavailable.');
 const bytes=await download(await github(`actions/artifacts/${a.id}/zip`),16*1024*1024);
 if(a.digest?.startsWith('sha256:')){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');if(a.digest!=='sha256:'+hash)throw Error('Artifact checksum mismatch.');}
 const wanted=new Map(outputNames(id[3]).map(name=>[id[3]+(name==='record.json'?'/':'/outputs/')+name,name]));
 if(a.name!=='workflow-'+id[2]){
  const packedName=a.name.startsWith('stage-')?a.name+'.tar.gz':'workflow-context.tar.gz';
  const packed=unzipSync(bytes,{filter:f=>f.name===packedName&&f.originalSize<=16*1024*1024})[packedName];
  if(!packed||packed.length<8||new DataView(packed.buffer,packed.byteOffset+packed.length-4,4).getUint32(0,true)>32*1024*1024)throw Error('Invalid stage archive.');
  const tar=gunzipSync(packed),decoder=new TextDecoder(),result:Record<string,string>={};
  for(let offset=0;offset+512<=tar.length;){
   const header=tar.subarray(offset,offset+512),name=decoder.decode(header.subarray(0,100)).split('\0')[0];if(!name)break;
   const size=parseInt(decoder.decode(header.subarray(124,136)).replace(/\0/g,'').trim()||'0',8);
   if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw Error('Invalid stage file.');
   const target=wanted.get(name.replace(/^stages\//,''));
   if(target&&size<=2*1024*1024&&(header[156]===0||header[156]===48))result[target]=decoder.decode(tar.subarray(offset+512,offset+512+size));
   offset+=512+Math.ceil(size/512)*512;
  }
  if(!result['record.json'])throw Error('This job has no completed output record yet.');
  const record=JSON.parse(result['record.json']);if(record.stage!==id[3]||!record.completed_at)throw Error('Job outputs are incomplete.');
  for(const [name,text] of Object.entries(result))if(name!=='record.json'){
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   if(record.outputs?.[name]!==hash)throw Error('Job output checksum mismatch.');
  }
  return result;
 }
 const entries=unzipSync(bytes,{filter:f=>wanted.has(f.name)&&f.originalSize<=2*1024*1024});
 return Object.fromEntries([...wanted].filter(([path])=>entries[path]).map(([path,name])=>[name,new TextDecoder().decode(entries[path])]));
}
export async function output(source:string,file:string){
 const id=outputStage(source);if(!id||!outputNames(id[3]).includes(file))throw Error('Unknown output.');
 const files=await stageOutputs(source);if(!(file in files))throw Error('Output not found.');return files[file];
}
export async function consoleLines(status:any){
 if(status.status!=='completed'||!status.execution?.jobs?.[0])return {ready:false,lines:[]};
 const jobs=status.execution.mode==='module_jobs'?status.execution.jobs.filter((j:any)=>j.status==='completed'&&j.conclusion!=='skipped'):[status.execution.jobs[0]];
 const logs=await Promise.all(jobs.map(async(j:any)=>new TextDecoder().decode(await download(await github(`actions/jobs/${j.id}/logs`),8*1024*1024))));const text=logs.join('\n');
 const keep=/SUBMISSION complete:|QC |PREPARE:|LOAD complete:|CPUE SUMMARY complete:|CPUE REPORT complete:|CI PASSED:|SOURCE:|INPUTS:|OUTPUTS:|MODULE [a-z_]+:|DATA QUALITY:|DATABASE SNAPSHOT:|Pulling from|Pull complete|Already exists|Digest: sha256:|Status: Downloaded|Status: Image is up to date|WORKFLOW PLAN:|PRESENTATION PACE:|(?:EXTRACT|CPUE|INPUT PREPARATION|ASSESSMENT|SYNTHESIS|REPORT) complete:/;
 return {ready:true,run_id:status.run_id,attempt:status.attempt,source:'GitHub Actions console log',lines:text.split('\n').filter(x=>keep.test(x)).sort().slice(-70)};
}
export async function change(stage:string){
 if(!changeable.has(stage as any))throw Error('Unknown stage.');
 await ensureBranch();
 const record=await json('contents/config/stages.json?ref='+DEMO_BRANCH),config=JSON.parse(atob(record.content.replaceAll('\n','')));
 let setting,description;
 if(['cpue_vessel','cpue_year'].includes(stage)){const value=config[stage]?.min_hooks===2000?0:2000;setting={min_hooks:value};description=`${stage}: minimum hooks = ${value}`;}
 else if(stage.startsWith('assessment_')){const base=stage.endsWith('high_m')?.30:.20;const value=config[stage]?.M===undefined||config[stage].M===base?Math.round((base+.05)*100)/100:base;setting={M:value};description=`${stage}: natural mortality M = ${value.toFixed(2)}`;}
 else{const value=config[stage]?.revision===1?0:1;setting={revision:value};description=`${stage}: rerun revision ${value}`;}
 config[stage]=setting;
 const body={message:'Update synthetic '+description,sha:record.sha,branch:DEMO_BRANCH,content:btoa(JSON.stringify(config,null,2)+'\n'),author:{name:'kyuhank',email:'kh2064@gmail.com'},committer:{name:'kyuhank',email:'kh2064@gmail.com'}};
 const committed=await (await github('contents/config/stages.json','PUT',body)).json();
 await dispatch();
 return {stage,setting,description,commit:committed.commit.sha,url:committed.commit.html_url};
}

export function parseSelection(text:string){
 if(text.length>2048)throw Error('Workshop selection is too large.');
 const value=JSON.parse(text);
 if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['branches','start','data_version'].includes(k))||(value.data_version!==undefined&&![2021,2022,2023,2024].includes(value.data_version))
    ||(value.start!=='data'&&!changeable.has(value.start))||!value.branches||typeof value.branches!=='object'||Array.isArray(value.branches)
    ||Object.keys(value.branches).length>definitions.length)throw Error('Choose a stage and registered branches.');
 for(const [key,branch] of Object.entries(value.branches))if(!changeable.has(key as any)||typeof branch!=='string'||!/^[a-z0-9-]{1,60}$/.test(branch))throw Error('Unknown module branch.');
 return value as {start:string,branches:Record<string,string>,data_version?:number};
}
export function branchUpdates(start:string,choices:Record<string,string>,available:{sources:Record<string,ModuleSource>,options:Record<string,Record<string,ModuleSource>>}){
 if(start!=='data'&&!changeable.has(start as any))throw Error('Unknown workshop stage.');
 const result:Record<string,ModuleSource>={};
 for(const [key,branch] of Object.entries(choices)){
  const source=available.options[key]?.[branch];if(!source)throw Error('Only registered workshop branches can run.');
  if(available.sources[key]?.branch!==branch)result[key]=source;
 }
 if(start!=='data'){
  const branch=choices[start]||available.sources[start]?.branch,source=available.options[start]?.[branch];
  if(!source)throw Error('Only registered workshop branches can run.');result[start]=source;
 }
 return result;
}
export async function runBranches(start:string,choices:Record<string,string>,request:string,submit=true,dataVersion?:number){
 branchUpdates(start,choices,await branches());
 await ensureBranch();
 const head=(await json('git/ref/heads/'+DEMO_BRANCH)).object.sha;
 // Resolve the complete selection against the exact caller's trusted catalog.
 const updates=branchUpdates(start,choices,await moduleConfiguration(head));
 if(!Object.keys(updates).length)return {stage:start,branches:{},commit:head,url:`https://github.com/${REPO}/commit/${head}`};
 const parent=await json('git/commits/'+head);
 async function config(name:string){
  const r=await github(`contents/config/${name}.json?ref=${head}`,'GET',undefined,true);
  return r.ok?JSON.parse(atob((await r.json()).content.replace(/\s/g,''))):{};
 }
 const [modules,settings]=await Promise.all([config('modules'),config('stages')]);
 for(const [key,source] of Object.entries(updates)){modules[key]={branch:source.branch,request};delete settings[key];}
 // The entire combination enters one commit; no partial branch selection can run.
 const tree=await (await github('git/trees','POST',{base_tree:parent.tree.sha,tree:[
  {path:'config/modules.json',mode:'100644',type:'blob',content:JSON.stringify(modules,null,2)+'\n'},
  {path:'config/stages.json',mode:'100644',type:'blob',content:JSON.stringify(settings,null,2)+'\n'},
  ...(dataVersion===undefined?[]:[{path:'config/data.json',mode:'100644',type:'blob',content:JSON.stringify({version:dataVersion})+'\n'}]),
 ]})).json();
 const identity={name:'kyuhank',email:'kh2064@gmail.com'};
 const description=Object.entries(updates).map(([key,source])=>`${key}: ${source.branch} @ ${source.commit.slice(0,8)}`).join('; ');
 const committed=await (await github('git/commits','POST',{message:'Run module selection: '+description,tree:tree.sha,parents:[head],author:identity,committer:identity})).json();
 await github('git/refs/heads/'+DEMO_BRANCH,'PATCH',{sha:committed.sha,force:false});
 if(submit)await dispatch(dataVersion);
 return {stage:start,branches:updates,commit:committed.sha,url:`https://github.com/${REPO}/commit/${committed.sha}`};
}
export async function changeBranch(stage:string,branch:string,request:string){
 const result=await runBranches(stage,{[stage]:branch},request);
 return {...result,branch,code_source:result.branches[stage]};
}

export async function stageLog(status:any,key:string){
 if(!outputKeys.has(key as any))throw Error('Unknown stage.');
 const stage=[...status.stages,...(status.intake_stages||[])].find((s:any)=>s.key===key),job=status.execution?.jobs?.find((j:any)=>j.id===stage?._job_id)||status.execution?.jobs?.[0];
 const base={run_id:status.run_id,stage:key,source:'GitHub steps'};
 if(stage?.status==='not_requested')return {...base,lines:['Not requested: this run uses an already accepted database release.']};
 if(stage?.reused)return {...base,lines:['Verified outputs restored; no runner needed.']};
 if(!job)return {...base,lines:['Waiting for a GitHub runner.']};
 const stamp=(date:string)=>date?date.slice(11,19):'';
 if(job.status==='completed'&&job.conclusion!=='skipped'){
  try{
   const log=new TextDecoder().decode(await download(await github(`actions/jobs/${job.id}/logs`),8*1024*1024));
   const keep=/SUBMISSION complete:|QC |PREPARE:|LOAD complete:|CPUE SUMMARY complete:|CPUE REPORT complete:|SOURCE:|DATA: release|INPUTS:|OUTPUTS:|Pulling from|Pull complete|Already exists|Digest: sha256:|Status: Downloaded|Status: Image is up to date|(?:EXTRACT|CPUE|INPUT PREPARATION|ASSESSMENT|SYNTHESIS|REPORT) complete:|REPRODUCIBILITY:|ERROR|Error:|ValueError:/;
   let lines=log.split('\n').filter(x=>keep.test(x)&&!x.includes('##[group]')).map(x=>x.replace(/^(\S+)\s*/,(_,t)=>stamp(t)+'  ').slice(0,240));
   if(status.execution.mode==='steps'){
    const tags:Record<string,string>={extract:'EXTRACT complete:',cpue_vessel:'vessel_adjusted',cpue_year:'year_only',prepare_vessel:'INPUT PREPARATION complete:',prepare_year:'INPUT PREPARATION complete:',synthesis:'SYNTHESIS complete:',report:'REPORT complete:'};
    lines=lines.filter(x=>x.includes(tags[key]||key));
   }
   if(lines.length)return {...base,source:'GitHub log',lines:lines.slice(-4)};
  }catch{/* Preserve the actual step record if the downloadable log is delayed. */}
 }
 let steps=(job.steps||[]).filter((s:any)=>s.started_at&&s.name!=='Complete job'&&!s.name.startsWith('Post '));
 if(status.execution.mode==='steps'&&key!=='extract')steps=steps.filter((s:any)=>s.number===stage._step_number);
 const lines=steps.slice(-3).map((s:any)=>stamp(s.started_at)+'  '+(s.status==='in_progress'?'▶ ':s.conclusion==='success'?'✓ ':'× ')+s.name.replace('Prepare the pinned Docker environment','Start container'));
 return {...base,lines:lines.length?lines:['Waiting for dependency outputs.']};
}
