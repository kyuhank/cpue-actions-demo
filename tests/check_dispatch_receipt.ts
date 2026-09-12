import {dispatch,mapRun,sourceCommit} from '../supabase/functions/workshop-api/github.ts';
import {pendingUpdate} from '../supabase/functions/workshop-api/lifecycle.ts';
import {validateIntakeRun} from '../supabase/functions/workshop-api/intake.ts';
import {handle} from '../supabase/functions/workshop-api/index.ts';
const assert=(condition:unknown,message='Unexpected execution identity')=>{if(!condition)throw Error(message);};
const commit='c'.repeat(40),launcher='a'.repeat(40);
Deno.test('Dispatch passes the saved selection explicitly and returns its execution receipt',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,options)=>{
  calls++;assert(String(input).endsWith('/actions/workflows/update.yml/dispatches'));
  const body=JSON.parse(String(options?.body));assert(body.inputs.source_commit===commit);
  assert(body.return_run_details===true&&body.ref==='demo-runtime');
  assert(body.inputs.request_id==='receipt-test'&&body.inputs.intake_mode==='invalid');
  return Response.json({workflow_run_id:107,html_url:'https://github.com/kyuhank/cpue-toy-data/actions/runs/107'});
 };
 try{const receipt=await dispatch(2024,'invalid','receipt-test',commit);assert(receipt.run_id===107&&calls===1);}finally{globalThis.fetch=original;}
});
Deno.test('A stale launcher head cannot replace the explicitly selected analysis commit',()=>{
 const run={id:107,run_attempt:1,head_sha:launcher,status:'in_progress',display_title:'Workshop · '+commit,path:'.github/workflows/update.yml'};
 const state=mapRun(run,[]);assert(state.commit===commit&&state.workflow_commit===launcher);
 const record={result:{commit,run_id:107,previous_run:106}};
 assert(pendingUpdate({last_request:record},{run_id:106}));
 assert(!pendingUpdate({last_request:record},state));
 validateIntakeRun(record,run,{sha:launcher,run_id:'107',run_attempt:'1'});
 for(const change of [{head_sha:commit},{display_title:'Workshop · '+launcher},{run_attempt:2},{status:'completed'}]){
  let rejected=false;try{validateIntakeRun(record,{...run,...change},{sha:launcher,run_id:'107',run_attempt:'1'});}catch{rejected=true;}assert(rejected);
 }
 assert(sourceCommit({...run,display_title:'Synthetic update'})===launcher);
});
Deno.test('Receipt recovery accepts only a single bounded request identifier',async()=>{
 for(const query of ['id=anything','id=../../private','id=550e8400-e29b-41d4-a716-446655440000&repository=private']){
  const result=await handle(new Request('https://example.test/workshop-api/api/request?'+query));assert(result.status===400);
 }
});
