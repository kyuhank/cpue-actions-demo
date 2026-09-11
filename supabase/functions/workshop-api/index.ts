import {change,changeable,current,consoleLines,output,ensureBranch} from './github.ts';
import {rpc,cached,invalidate} from './database.ts';
import {maintain,observe,pendingUpdate} from './lifecycle.ts';
import batches from './batches.json' with {type:'json'};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Workshop-Action, X-Workshop-Request','Access-Control-Max-Age':'86400','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:cors});
const enabled=()=>/^github_pat_[A-Za-z0-9_]+$/.test(Deno.env.get('WORKSHOP_GITHUB_TOKEN')||'')&&Deno.env.get('WORKSHOP_ZERO_BUDGET_CONFIRMED')==='true';
async function status(){
 const s:any=await cached('status',Deno.env.get('WORKSHOP_GITHUB_TOKEN')?2:300,current),limits=await rpc('workshop_state');
 const pending=pendingUpdate(limits,s),demo=enabled()?await observe(s,limits):await rpc('workshop_demo_state');
 const can=enabled()&&demo.phase!=='cleaning'&&!pending&&limits.remaining>0&&(!limits.next_update||Date.parse(limits.next_update)<=Date.now())&&s.status==='completed';
 const record=limits.last_request;let intake=record?.result?.quality_check?{quality_check:record.result.quality_check,published:record.result.published,checked_at:Date.parse(record.created_at)/1000}:null;
 if(intake&&!intake.published&&Date.parse(s.created_at)>intake.checked_at*1000)intake=null;
 if(s.has_run&&s.status==='completed'&&s.conclusion==='success'){
  try{const raw=await cached('output:'+s.run_id+'-'+s.attempt+'-report:manifest.json',3600,()=>output(s.run_id+'-'+s.attempt+'-report','manifest.json'));const m=JSON.parse(raw);
   if(m.github_run_id==s.run_id&&(m.configuration?.git_commit||m.workflow_plan?.trigger_commit)===s.commit){s.database_version=Number(m.source_version);if(!intake&&m.data_release?.quality_check)intake={quality_check:m.data_release.quality_check,published:true,checked_at:Date.parse(m.data_release.published_at||s.created_at)/1000};}
  }catch{/* The run state remains available while the report is being published. */}
 }
 if(!s.has_run)intake=null;
 return {...s,demo,database_connected:true,data_intake:intake,session:{can_update:can,remaining:limits.remaining,next_update:limits.next_update,message:!enabled()?'Cloud execution is awaiting the owner’s restricted GitHub connection.':demo.phase==='cleaning'?'Resetting the demonstration. The next run will start from the baseline.':pending?'The update is stored; waiting for GitHub to acknowledge the next run.':limits.remaining===0?'Daily limit reached. You can still inspect the current run.':!can?'Wait for the current run and the short update interval.':`${limits.remaining} shared updates available today.`}};
}
export async function handle(request:Request){
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const u=new URL(request.url),path=u.pathname.split('/workshop-api')[1]||'/';
 try{
  if(path==='/api/maintenance'){
   const key=Deno.env.get('WORKSHOP_WEBHOOK_SECRET');
   if(request.method!=='POST'||!key||request.headers.get('X-Workshop-Webhook')!==key)return reply({detail:'Forbidden'},403);
   if(!enabled())return reply({reset:false,enabled:false});
   return reply(await maintain());
  }
  if(request.method==='GET'){
   if(path==='/api/presentation-info')return reply({presentation:'cpue-workshop',hosted:true,enabled:enabled()});
   if(path==='/api/status')return reply(await status());
   if(path==='/api/console'){const s=await status();if(!s.ready)return reply({ready:false,lines:[]});return reply(await cached('console:'+s.run_id+':'+s.attempt,3600,()=>consoleLines(s)));}
   if(path==='/api/output'){
    const source=u.searchParams.get('job')||'',file=u.searchParams.get('file')||'';
    if(!/^\d+-\d+-report$/.test(source)||!['report.html','manifest.json','summary.csv','cpue.svg','biomass.svg'].includes(file))return reply({detail:'Unknown output.'},400);
    const value=await cached('output:'+source+':'+file,3600,()=>output(source,file));
    // HTML/SVG are delivered as data. The slide renders them in a sandboxed frame.
    return new Response(value,{headers:{...cors,'Content-Type':file.endsWith('.json')?'application/json':'text/plain; charset=utf-8'}});
   }
   return reply({detail:'Unknown workshop route.'},404);
  }
  if(request.method!=='POST')return reply({detail:'Method not allowed.'},405);
  const kind=path==='/api/update'?'data':path==='/api/check-invalid-data'?'invalid':path.startsWith('/api/change/')?path.slice('/api/change/'.length):'';
  if(!['data','invalid'].includes(kind)&&!changeable.has(kind as any))return reply({detail:'Unknown workshop action.'},404);
  if(u.search||request.headers.get('X-Workshop-Action')!=='publish-synthetic-data'||!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({detail:'Use the workshop controls.'},400);
  const text=await request.text();if(text.length>64||text.trim()!=='{}')return reply({detail:'Only fixed demonstration actions are accepted.'},400);
  const id=request.headers.get('X-Workshop-Request')||'';if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))return reply({detail:'A request identifier is required.'},400);
  if(!enabled())return reply({detail:'The owner must connect the restricted demo credential and confirm a zero-dollar Actions spending limit.'},503);
  // Check GitHub directly before any data or settings mutation.
  const s:any=await current();if(!s.ready||s.status!=='completed'||s.conclusion!=='success')return reply({detail:'Wait for a successful workflow before updating.'},409);
  const control=await rpc('workshop_state');if(pendingUpdate(control,s))return reply({detail:'An earlier update is waiting for GitHub. Inspect its request before submitting another.'},409);
  let claim;try{claim=await rpc('workshop_reserve',{p_id:id,p_kind:kind});}catch{return reply({detail:'Another update is pending, the 30-second interval has not passed, or today’s 60 updates are used.'},429);}
  if(claim.duplicate)return reply(claim.result||{detail:'This request is already being processed.'},claim.result?200:409);
  let result:any;
  try{
   if(kind==='data'||kind==='invalid'){
    const snapshot=await rpc('cpue_snapshot',{p_version:null}),year=snapshot.version+1;
    const batch=structuredClone((batches as any)[year]);if(!batch)throw Error('All synthetic years have been published. You can still change CPUE or assessment configurations.');
    if(kind==='invalid')batch.sets[0][3]=0;
    const quality=await rpc('cpue_check_year',{p_year:year,p_sets:batch.sets,p_catch:batch.catch});
    if(!quality.accepted)result={quality_check:quality,published:false};
    else{
     await rpc('workshop_demo_start',{p_request:id});await ensureBranch();
     const released=await rpc('cpue_append_year',{p_year:year,p_sets:batch.sets,p_catch:batch.catch});
     result={...released,quality_check:released.quality_check,published:true,year,database_version:released.version};
    }
   }else{await rpc('workshop_demo_start',{p_request:id});result=await change(kind);}
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
