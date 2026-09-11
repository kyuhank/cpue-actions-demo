import {current,removeDemonstrationRuns} from './github.ts';
import {rpc} from './database.ts';

export function pendingUpdate(limits:any,run:any){
 const result=limits.last_request?.result;
 return !!result&&result.previous_run===run.run_id&&result.published!==false&&!result.error;
}

export async function observe(run:any,limits:any){
 if(run.has_run&&!pendingUpdate(limits,run))await rpc('workshop_demo_observe',{p_run:run.run_id,p_completed:run.status==='completed'?run.completed_at:null});
 return await rpc('workshop_demo_state');
}

export async function maintain(){
 let demo=await rpc('workshop_demo_state');
 if(demo.phase!=='cleaning'){
  const run:any=await current(),limits=await rpc('workshop_state');
  demo=await observe(run,limits);
  if(!run.has_run||run.status!=='completed'||pendingUpdate(limits,run)||!demo.reset_at||Date.parse(demo.reset_at)>Date.now())return {reset:false,reset_at:demo.reset_at};
 }
 if(!await rpc('workshop_demo_claim_reset',{p_run:demo.run_id}))return {reset:false};
 await removeDemonstrationRuns(demo.run_id);
 await rpc('workshop_demo_finish_reset',{p_run:demo.run_id});
 return {reset:true};
}
