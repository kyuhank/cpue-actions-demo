import { unzipSync } from 'npm:fflate@0.8.2';
export const REPO = 'kyuhank/cpue-toy-data';
export const DEMO_BRANCH = 'demo-runtime';
export const definitions = [
 ['extract','01 Extract',[]], ['cpue_vessel','02 CPUE: year + vessel',['extract']],
 ['cpue_year','02 CPUE: year only',['extract']],
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
export function outputNames(key:string):string[]{
 const common=['manifest.json','record.json'];
 if(key==='extract')return ['sets.csv','catch.csv','extract.sql','extract-catch.sql',...common];
 if(key.startsWith('cpue_'))return ['cpue.csv','cpue-diagnostics.txt','cpue-diagnostics.json',...common];
 if(key.startsWith('prepare_'))return ['assessment-input.csv','catch.csv','cpue.csv',...common];
 if(key.startsWith('assessment_'))return ['biomass.csv','summary.csv','assessment-input.csv',...common];
 if(['synthesis','report'].includes(key))return [...(key==='report'?['report.html']:[]),'cpue.svg','biomass.svg','summary.csv','biomass.csv','cpue.csv',...common];
 return [];
}
export function outputStage(source:string){const match=source.match(/^(\d+)-(\d+)-([a-z_]+)$/);return match&&changeable.has(match[3] as any)?match:null;}
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
 const physical=jobs[0], steps=physical?.steps||[], states:Record<string,string>={};
 const stages=definitions.map(([key,label,parents])=>{
  const step=steps.find((s:any)=>s.name.replace(/ · reused$/,'').replace(/ \(0\.\d+\)/,'')===label);
  const reused=!!step&&step.name.endsWith(' · reused')&&step.conclusion==='skipped'&&steps.some((s:any)=>s.name==='Restore and verify reusable outputs'&&s.conclusion==='success');
  let state=reused?'completed':step?.status==='in_progress'?'running':step?.status==='completed'?({success:'completed',failure:'failed',cancelled:'cancelled',skipped:'blocked',timed_out:'failed'} as any)[step.conclusion]||'blocked':run.status==='completed'?'blocked':parents.every(p=>states[p]==='completed')?'idle':'waiting';
  states[key]=state;
  return {key,label:label.slice(3),parents,status:state,reused,source_id:`${run.id}-${run.run_attempt}-${key}`,started_at:step?.started_at,completed_at:step?.completed_at,html_url:physical?.html_url,_step_number:step?.number};
 });
 return {ready:true,has_run:true,stages,run_id:run.id,number:run.run_number,attempt:run.run_attempt,run_url:run.html_url,commit:run.head_sha,status:run.status,conclusion:run.conclusion,branch:run.head_branch,
 trigger_message:run.display_title.startsWith('Database version ')?run.display_title:(run.head_commit?.message||run.display_title).split('\n')[0].slice(0,160),database_version:/^Database version 20\d{2}$/.test(run.display_title)?Number(run.display_title.slice(-4)):null,
 execution:{mode:'steps',job_count:jobs.length,jobs},source:{stale:false,last_success:new Date().toISOString()},created_at:run.created_at,completed_at:run.status==='completed'?run.updated_at:null};
}
export function emptyRun(){return {ready:true,has_run:false,baseline_available:true,stages:definitions.map(([key,label,parents])=>({key,label:label.slice(3),parents,status:'waiting',reused:false,source_id:'',_step_number:null})),run_id:null,number:null,attempt:null,run_url:'',commit:'',status:'completed',conclusion:'success',database_version:2023,execution:{mode:'steps',job_count:0,jobs:[]},source:{stale:false,last_success:new Date().toISOString()},created_at:null,completed_at:null};}
export async function current(){const runs=(await json('actions/workflows/update.yml/runs?per_page=1')).workflow_runs;
 if(!runs.length)return emptyRun();const r=runs[0];const jobs=(await json(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`)).jobs;
 return mapRun(r,jobs);
}
export async function ensureBranch(){
 const existing=await github('git/ref/heads/'+DEMO_BRANCH,'GET',undefined,true);
 if(existing.ok)return;
 const base=await json('git/ref/heads/main');
 await github('git/refs','POST',{ref:'refs/heads/'+DEMO_BRANCH,sha:base.object.sha});
}
export async function dispatch(version?:number){
 await ensureBranch();
 await github('actions/workflows/update.yml/dispatches','POST',{ref:DEMO_BRANCH,inputs:version?{data_version:String(version)}:{}});
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
 const run=await json('actions/runs/'+id[1]);if(run.path!=='.github/workflows/update.yml'||run.conclusion!=='success'||run.run_attempt!==Number(id[2]))throw Error('Unknown successful workshop run.');
 const a=(await json(`actions/runs/${id[1]}/artifacts?per_page=100`)).artifacts.find((x:any)=>x.name==='workflow-'+id[2]&&!x.expired);
 if(!a||a.size_in_bytes>16*1024*1024)throw Error('Report artifact unavailable.');
 const bytes=await download(await github(`actions/artifacts/${a.id}/zip`),16*1024*1024);
 if(a.digest?.startsWith('sha256:')){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');if(a.digest!=='sha256:'+hash)throw Error('Artifact checksum mismatch.');}
 const wanted=new Map(outputNames(id[3]).map(name=>[id[3]+(name==='record.json'?'/':'/outputs/')+name,name]));
 const entries=unzipSync(bytes,{filter:f=>wanted.has(f.name)&&f.originalSize<=2*1024*1024});
 return Object.fromEntries([...wanted].filter(([path])=>entries[path]).map(([path,name])=>[name,new TextDecoder().decode(entries[path])]));
}
export async function output(source:string,file:string){
 const id=outputStage(source);if(!id||!outputNames(id[3]).includes(file))throw Error('Unknown output.');
 const files=await stageOutputs(source);if(!(file in files))throw Error('Output not found.');return files[file];
}
export async function consoleLines(status:any){
 if(status.status!=='completed'||!status.execution?.jobs?.[0])return {ready:false,lines:[]};
 const text=new TextDecoder().decode(await download(await github(`actions/jobs/${status.execution.jobs[0].id}/logs`),8*1024*1024));
 const keep=/DATA QUALITY:|DATABASE SNAPSHOT:|Pulling from|Pull complete|Already exists|Digest: sha256:|Status: Downloaded|Status: Image is up to date|WORKFLOW PLAN:|PRESENTATION PACE:|(?:EXTRACT|CPUE|INPUT PREPARATION|ASSESSMENT|SYNTHESIS|REPORT) complete:/;
 return {ready:true,run_id:status.run_id,attempt:status.attempt,source:'GitHub Actions console log',lines:text.split('\n').filter(x=>keep.test(x)).slice(-40)};
}
export async function change(stage:string){
 if(!changeable.has(stage as any))throw Error('Unknown stage.');
 await ensureBranch();
 const record=await json('contents/config/stages.json?ref='+DEMO_BRANCH),config=JSON.parse(atob(record.content.replaceAll('\n','')));
 let setting,description;
 if(stage.startsWith('cpue_')){const value=config[stage]?.min_hooks===2000?0:2000;setting={min_hooks:value};description=`${stage}: minimum hooks = ${value}`;}
 else if(stage.startsWith('assessment_')){const base=stage.endsWith('high_m')?.30:.20;const value=config[stage]?.M===undefined||config[stage].M===base?Math.round((base+.05)*100)/100:base;setting={M:value};description=`${stage}: natural mortality M = ${value.toFixed(2)}`;}
 else{const value=config[stage]?.revision===1?0:1;setting={revision:value};description=`${stage}: rerun revision ${value}`;}
 config[stage]=setting;
 const body={message:'Update synthetic '+description,sha:record.sha,branch:DEMO_BRANCH,content:btoa(JSON.stringify(config,null,2)+'\n'),author:{name:'kyuhank',email:'kh2064@gmail.com'},committer:{name:'kyuhank',email:'kh2064@gmail.com'}};
 const committed=await (await github('contents/config/stages.json','PUT',body)).json();
 await dispatch();
 return {stage,setting,description,commit:committed.commit.sha,url:committed.commit.html_url};
}
