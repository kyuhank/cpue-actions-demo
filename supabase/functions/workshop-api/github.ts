import { unzipSync } from 'npm:fflate@0.8.2';
export const REPO = 'kyuhank/cpue-toy-data';
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
export const changeable = new Set(definitions.map(x=>x[0]).filter(x=>x.startsWith('cpue_')||x.startsWith('assessment_')));
export async function github(path:string, method='GET', body?:unknown):Promise<Response> {
 const token=Deno.env.get('WORKSHOP_GITHUB_TOKEN');
 const headers:Record<string,string>={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'cpue-workshop','Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const r=await fetch('https://api.github.com/repos/'+REPO+'/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!r.ok&&r.status!==302)throw Error('GitHub request could not be confirmed ('+r.status+').');
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
 return {ready:true,stages,run_id:run.id,number:run.run_number,attempt:run.run_attempt,run_url:run.html_url,commit:run.head_sha,status:run.status,conclusion:run.conclusion,
 trigger_message:run.display_title.startsWith('Database version ')?run.display_title:(run.head_commit?.message||run.display_title).split('\n')[0].slice(0,160),database_version:/^Database version 20\d{2}$/.test(run.display_title)?Number(run.display_title.slice(-4)):null,
 execution:{mode:'steps',job_count:jobs.length,jobs},source:{stale:false,last_success:new Date().toISOString()},created_at:run.created_at};
}
export async function current(){const runs=(await json('actions/workflows/update.yml/runs?per_page=1')).workflow_runs;
 if(!runs.length)return {ready:false};const r=runs[0];const jobs=(await json(`actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`)).jobs;
 return mapRun(r,jobs);
}
async function download(response:Response,limit:number):Promise<Uint8Array>{
 let r=response;if(r.status===302){const url=new URL(r.headers.get('location')||'');if(url.protocol!=='https:'||!(/(^|\.)(githubusercontent\.com|blob\.core\.windows\.net)$/.test(url.hostname)))throw Error('Unknown GitHub download host.');r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});}
 if(!r.ok||Number(r.headers.get('content-length')||0)>limit)throw Error('Output unavailable or too large.');
 const reader=r.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Output exceeds demonstration limit.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
export async function output(source:string,file:string){
 const id=source.match(/^(\d+)-(\d+)-report$/);if(!id||!['report.html','manifest.json','summary.csv','cpue.svg','biomass.svg'].includes(file))throw Error('Unknown output.');
 const run=await json('actions/runs/'+id[1]);if(run.path!=='.github/workflows/update.yml'||run.conclusion!=='success'||run.run_attempt!==Number(id[2]))throw Error('Unknown successful workshop run.');
 const a=(await json(`actions/runs/${id[1]}/artifacts?per_page=100`)).artifacts.find((x:any)=>x.name==='workflow-'+id[2]&&!x.expired);
 if(!a||a.size_in_bytes>16*1024*1024)throw Error('Report artifact unavailable.');
 const bytes=await download(await github(`actions/artifacts/${a.id}/zip`),16*1024*1024);
 if(a.digest?.startsWith('sha256:')){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');if(a.digest!=='sha256:'+hash)throw Error('Artifact checksum mismatch.');}
 const wanted='report/outputs/'+file;
 const entries=unzipSync(bytes,{filter:f=>f.name===wanted&&f.originalSize<=2*1024*1024});
 if(!entries[wanted])throw Error('Output not found.');return new TextDecoder().decode(entries[wanted]);
}
export async function consoleLines(status:any){
 if(status.status!=='completed'||!status.execution?.jobs?.[0])return {ready:false,lines:[]};
 const text=new TextDecoder().decode(await download(await github(`actions/jobs/${status.execution.jobs[0].id}/logs`),8*1024*1024));
 const keep=/DATA QUALITY:|DATABASE SNAPSHOT:|Pulling from|Pull complete|Already exists|Digest: sha256:|Status: Downloaded|Status: Image is up to date|WORKFLOW PLAN:|PRESENTATION PACE:|(?:EXTRACT|CPUE|INPUT PREPARATION|ASSESSMENT|SYNTHESIS|REPORT) complete:/;
 return {ready:true,run_id:status.run_id,attempt:status.attempt,source:'GitHub Actions console log',lines:text.split('\n').filter(x=>keep.test(x)).slice(-40)};
}
export async function change(stage:string){
 if(!changeable.has(stage as any))throw Error('Unknown stage.');
 const record=await json('contents/config/stages.json?ref=main'),config=JSON.parse(atob(record.content.replaceAll('\n','')));
 let setting,description;
 if(stage.startsWith('cpue_')){const value=config[stage]?.min_hooks===2000?0:2000;setting={min_hooks:value};description=`${stage}: minimum hooks = ${value}`;}
 else{const base=stage.endsWith('high_m')?.30:.20;const value=config[stage]?.M===undefined||config[stage].M===base?Math.round((base+.05)*100)/100:base;setting={M:value};description=`${stage}: natural mortality M = ${value.toFixed(2)}`;}
 config[stage]=setting;
 const body={message:'Update synthetic '+description,sha:record.sha,branch:'main',content:btoa(JSON.stringify(config,null,2)+'\n'),author:{name:'kyuhank',email:'kh2064@gmail.com'},committer:{name:'kyuhank',email:'kh2064@gmail.com'}};
 const committed=await (await github('contents/config/stages.json','PUT',body)).json();
 return {stage,setting,description,commit:committed.commit.sha,url:committed.commit.html_url};
}
