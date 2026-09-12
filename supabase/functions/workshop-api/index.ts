import {acceptIntake,IntakePending} from './intake.ts';
import {parseSelection,branchUpdates,runBranches,changeBranch,branches,change,changeable,current,consoleLines,stageLog,output,outputStage,outputNames,stageOutputs,ensureBranch,dispatch,outputKeys} from './github.ts';
import {rpc,cached,invalidate} from './database.ts';
import {maintain,observe,pendingUpdate} from './lifecycle.ts';
import batches from './batches.json' with {type:'json'};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Workshop-Action, X-Workshop-Request','Access-Control-Max-Age':'86400','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:cors});
const enabled=()=>/^github_pat_[A-Za-z0-9_]+$/.test(Deno.env.get('WORKSHOP_GITHUB_TOKEN')||'')&&Deno.env.get('WORKSHOP_ZERO_BUDGET_CONFIRMED')==='true';
async function status(){
 const [s,limits,database]:any[]=await Promise.all([cached('status',Deno.env.get('WORKSHOP_GITHUB_TOKEN')?1:300,current),rpc('workshop_state'),cached('database:current',10,()=>rpc('cpue_snapshot',{p_version:null}))]);
 const pending=pendingUpdate(limits,s),demo=enabled()?await observe(s,limits):await rpc('workshop_demo_state');
 const can=enabled()&&demo.phase!=='cleaning'&&!pending&&limits.remaining>0&&(!limits.next_update||Date.parse(limits.next_update)<=Date.now())&&s.status==='completed';
 const record=limits.last_request;let intake:{quality_check:any,published:boolean,checked_at:number,first_quality_check?:any,correction?:any}|null=record?.result?.quality_check?{quality_check:record.result.quality_check,published:record.result.published,checked_at:Date.parse(record.created_at)/1000}:null;
 if(intake&&!intake.published&&Date.parse(s.created_at)>intake.checked_at*1000)intake=null;
 if(s.has_run&&s.status==='completed'&&s.conclusion==='success'&&s.execution.mode!=='grouped_steps'){
  try{const raw=await cached('output:'+s.run_id+'-'+s.attempt+'-report:manifest.json',3600,()=>output(s.run_id+'-'+s.attempt+'-report','manifest.json'));const m=JSON.parse(raw);
   if(m.github_run_id==s.run_id&&(m.configuration?.git_commit||m.workflow_plan?.trigger_commit)===s.commit){s.database_version=Number(m.source_version);if(!intake&&m.data_release?.quality_check)intake={quality_check:m.data_release.quality_check,published:true,checked_at:Date.parse(m.data_release.published_at||s.created_at)/1000};}
  }catch{/* The run state remains available while the report is being published. */}
 }
 const qcJob=s.intake_stages?.find((j:any)=>j.key==='qc');
 if(qcJob&&['completed','failed'].includes(qcJob.status)&&s.execution.mode!=='grouped_steps'){
  try{const files=await cached('intake:'+qcJob.source_id,600,()=>stageOutputs(qcJob.source_id));intake={quality_check:JSON.parse(files['quality.json']),first_quality_check:files['first-quality.json']?JSON.parse(files['first-quality.json']):null,correction:files['correction.json']?JSON.parse(files['correction.json']):null,published:s.intake_stages.some((j:any)=>j.key==='ingest'&&j.status==='completed'),checked_at:Date.parse(s.created_at)/1000};}catch{}
 }
 if(!s.has_run&&intake&&(intake.published||intake.checked_at*1000<=Date.parse(demo.last_reset_at||'1970-01-01')))intake=null;
 return {...s,demo,data_versions:database.version>=2024?[2021,2022,2023,2024]:[2021,2022,2023],latest_database_version:database.version,database_connected:true,data_intake:intake,session:{can_update:can,remaining:limits.remaining,next_update:limits.next_update,message:!enabled()?'Cloud execution is awaiting the owner’s restricted GitHub connection.':demo.phase==='cleaning'?'Resetting the demonstration. The next run will start from the baseline.':pending?'The update is stored; waiting for GitHub to acknowledge the next run.':limits.remaining===0?'Daily limit reached. You can still inspect the current run.':!can?'Wait for the current run and the short update interval.':`${limits.remaining} shared updates available today.`}};
}
export async function handle(request:Request){
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const u=new URL(request.url),path=u.pathname.split('/workshop-api')[1]||'/';
 try{
  if(path==='/api/accept-intake'){
   if(request.method!=='POST'||!enabled())return reply({detail:'Forbidden'},403);
   try{return reply(await acceptIntake(request));}catch(e){console.error('Intake verification failed:',e instanceof Error?e.message:'Unknown verification error');return reply({detail:'The active, checked intake run could not be verified.'},e instanceof IntakePending?503:403);}
  }
  if(path==='/api/maintenance'){
   const key=Deno.env.get('WORKSHOP_WEBHOOK_SECRET');
   if(request.method!=='POST'||!key||request.headers.get('X-Workshop-Webhook')!==key)return reply({detail:'Forbidden'},403);
   if(!enabled())return reply({reset:false,enabled:false});
   return reply(await maintain());
  }
  if(request.method==='GET'){
   if(path==='/api/presentation-info')return reply({presentation:'cpue-workshop',hosted:true,enabled:enabled()});
   if(path==='/api/status')return reply(await status());
   if(path==='/api/branches')return reply(await cached('branches',10,branches));
   if(path==='/api/database'){
    const raw=u.searchParams.get('version');
    if([...u.searchParams.keys()].some(k=>k!=='version')||u.searchParams.getAll('version').length>1||(raw!==null&&!['2021','2022','2023','2024'].includes(raw)))return reply({detail:'Choose a saved demonstration snapshot.'},400);
    const latest=await cached('database:current',10,()=>rpc('cpue_snapshot',{p_version:null}));
    const version=raw?Number(raw):latest.version;
    if(version>latest.version)return reply({detail:'This demonstration release has expired. Open the current database or use the snapshot saved in its report.'},404);
    const snapshot=version===latest.version?latest:await cached('database:'+version,3600,()=>rpc('cpue_snapshot',{p_version:version}));
    return reply({provider:'Supabase · PostgreSQL',current_version:latest.version,versions:latest.version>=2024?[2021,2022,2023,2024]:[2021,2022,2023],snapshot});
   }

   if(path==='/api/stage-log'){
    const key=u.searchParams.get('stage')||'';if([...u.searchParams.keys()].some(k=>k!=='stage')||!outputKeys.has(key as any))return reply({detail:'Unknown stage.'},400);
    const s=await status();return reply(await cached('stage-log:'+s.run_id+':'+s.attempt+':'+key,s.status==='completed'?600:2,()=>stageLog(s,key)));
   }
   if(path==='/api/console'){const s=await status();if(!s.ready)return reply({ready:false,lines:[]});return reply(await cached('console:'+s.run_id+':'+s.attempt,3600,()=>consoleLines(s)));}
   if(path==='/api/output'||path==='/api/outputs'){
    const source=u.searchParams.get('job')||'',file=u.searchParams.get('file')||'';
    const stage=outputStage(source);
    if(!stage||(path==='/api/output'&&!outputNames(stage[3]).includes(file)))return reply({detail:'Unknown output.'},400);
    const files=await cached('output:'+source+':bundle',3600,()=>stageOutputs(source));
    if(path==='/api/outputs')return reply({files:Object.keys(files)});
    const value=files[file];if(value===undefined)return reply({detail:'Output not found.'},404);
    // HTML/SVG are delivered as data. The slide renders them in a sandboxed frame.
    return new Response(value,{headers:{...cors,'Content-Type':file.endsWith('.json')?'application/json':'text/plain; charset=utf-8'}});
   }
   return reply({detail:'Unknown workshop route.'},404);
  }
  if(request.method!=='POST')return reply({detail:'Method not allowed.'},405);
  const combined=path==='/api/run',branchMatch=path.match(/^\/api\/branch\/([a-z_]+)\/([a-z0-9-]{1,60})$/);
  let kind=branchMatch?branchMatch[1]:path==='/api/update'?'data':path==='/api/check-invalid-data'?'invalid':path.startsWith('/api/change/')?path.slice('/api/change/'.length):'';
  if(!combined&&!['data','invalid'].includes(kind)&&!changeable.has(kind as any))return reply({detail:'Unknown workshop action.'},404);
  if(u.search||request.headers.get('X-Workshop-Action')!=='publish-synthetic-data'||!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({detail:'Use the workshop controls.'},400);
  const text=await request.text();let selection:{start:string,branches:Record<string,string>,data_version?:number}|null=null;
  if(combined){try{selection=parseSelection(text);kind=selection.start;}catch{return reply({detail:'Choose a stage and registered branches only.'},400);}}
  else if(text.length>64||text.trim()!=='{}')return reply({detail:'Only fixed demonstration actions are accepted.'},400);
  const id=request.headers.get('X-Workshop-Request')||'';if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))return reply({detail:'A request identifier is required.'},400);
  if(!enabled())return reply({detail:'The owner must connect the restricted demo credential and confirm a zero-dollar Actions spending limit.'},503);
  if(branchMatch||selection){try{branchUpdates(kind,selection?.branches||{[kind]:branchMatch![2]},await branches());}catch{return reply({detail:'Only registered workshop branches can run.'},400);}}
  // Check GitHub directly before any data or settings mutation.
  const s:any=await current();if(!s.ready||s.status!=='completed')return reply({detail:'Wait for the current workflow to finish before updating.'},409);
  const control=await rpc('workshop_state');if(pendingUpdate(control,s))return reply({detail:'An earlier update is waiting for GitHub. Inspect its request before submitting another.'},409);
  if(selection?.data_version!==undefined){const latest=await rpc('cpue_snapshot',{p_version:null});if(selection.data_version>latest.version)return reply({detail:'Publish the checked data batch before selecting this release.'},400);}
  let claim;try{claim=await rpc('workshop_reserve',{p_id:id,p_kind:kind});}catch{return reply({detail:'Another update is pending, the 30-second interval has not passed, or today’s 60 updates are used.'},429);}
  if(claim.duplicate)return reply(claim.result||{detail:'This request is already being processed.'},claim.result?200:409);
  let result:any;
  try{
   if(selection?.data_version!==undefined){
    await rpc('workshop_demo_start',{p_request:id});
    const start=kind==='data'||selection.data_version!==s.database_version?'extract':kind;
    result={...await runBranches(start,selection.branches,id,true,selection.data_version),database_version:selection.data_version,published:true};
   }else if(kind==='data'||kind==='invalid'){
    await rpc('workshop_demo_start',{p_request:id});
    const mode=kind==='invalid'?'invalid':'valid';
    result={...await runBranches('extract',selection?.branches||{},id,false,2024),request:id,intake_mode:mode,published:true,database_version:2024};
    await dispatch(2024,mode,id);
   }else{await rpc('workshop_demo_start',{p_request:id});result=selection?await runBranches(kind,selection.branches,id):branchMatch?await changeBranch(kind,branchMatch[2],id):await change(kind);}
   result.previous_run=s.run_id;
   await rpc('workshop_finish',{p_id:id,p_result:result});await invalidate();return reply(result,202);
  }catch(e){
   // Ambiguous external failures are recorded and never retried automatically.
   await rpc('workshop_finish',{p_id:id,p_result:{error:'Check the last release and GitHub run before retrying.'}});
   throw e;
  }
 }catch(e){return reply({detail:e instanceof Error?e.message:'Workshop service unavailable.'},502);}
}
if(import.meta.main)Deno.serve(handle);
