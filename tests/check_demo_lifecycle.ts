import {change,definitions,REPO,DEMO_BRANCH,emptyRun} from '../supabase/functions/workshop-api/github.ts';
import {maintain} from '../supabase/functions/workshop-api/lifecycle.ts';
import {handle} from '../supabase/functions/workshop-api/index.ts';
const assert=(ok:unknown,message='Assertion failed')=>{if(!ok)throw Error(message);};

Deno.test('Stage updates write only the disposable branch and fixed config; no main or workflow changes',async()=>{
 const original=globalThis.fetch,calls:any[]=[];
 Deno.env.set('WORKSHOP_GITHUB_TOKEN','github_pat_test_only');
 globalThis.fetch=async(input,init)=>{
  const url=String(input),method=init?.method||'GET',body=init?.body?JSON.parse(String(init.body)):null;
  calls.push({url,method,body});
  assert(url.startsWith('https://api.github.com/repos/'+REPO+'/'));
  assert(init?.redirect==='manual');
  if(url.endsWith('git/ref/heads/'+DEMO_BRANCH))return Response.json({object:{sha:'a'.repeat(40)}});
  if(url.endsWith('contents/config/stages.json?ref='+DEMO_BRANCH))return Response.json({sha:'file-sha',content:btoa('{}')});
  if(url.endsWith('contents/config/stages.json')&&method==='PUT'){
   assert(body.branch===DEMO_BRANCH);assert(Object.keys(JSON.parse(atob(body.content))).length===1);
   return Response.json({commit:{sha:'b'.repeat(40),html_url:'https://github.com/'+REPO+'/commit/'+'b'.repeat(40)}});
  }
  if(url.endsWith('actions/workflows/update.yml/dispatches')&&method==='POST'){
   assert(body.ref===DEMO_BRANCH);return new Response(null,{status:204});
  }
  throw Error('Unexpected request: '+url);
 };
 try{
  for(const [stage] of definitions)await change(stage);
  assert(calls.filter(x=>x.method==='PUT').length===11);
  let rejected=false;try{await change('../private');}catch{rejected=true;}assert(rejected);
  assert(emptyRun().has_run===false&&emptyRun().stages.length===11);
 }finally{globalThis.fetch=original;Deno.env.delete('WORKSHOP_GITHUB_TOKEN');}
});

Deno.test('Server cleanup waits ten minutes and resumes after partial cleanup without deleting a missing branch',async()=>{
 const original=globalThis.fetch,clock=Date.now,initial=clock(),calls:any[]=[];
 let now=initial,deleted=false,finished=false,branchExists=true,failFinish=true;
 let demo:any={phase:'active',run_id:101,reset_at:null};
 const run={id:101,run_attempt:1,run_number:1,head_sha:'a'.repeat(40),head_branch:DEMO_BRANCH,
  status:'completed',conclusion:'success',display_title:'Database version 2024',path:'.github/workflows/update.yml',
  html_url:'https://github.com/'+REPO+'/actions/runs/101',created_at:new Date(initial-700000).toISOString(),updated_at:new Date(initial-599000).toISOString()};
 Deno.env.set('SUPABASE_URL','https://test.supabase.co');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-only');
 Date.now=()=>now;
 globalThis.fetch=async(input,init)=>{
  const url=String(input),method=init?.method||'GET',body=init?.body?JSON.parse(String(init.body)):null;
  calls.push({url,method});
  if(url.startsWith('https://test.supabase.co/rest/v1/rpc/')){
   const rpc=url.split('/').at(-1);
   if(rpc==='workshop_demo_state')return Response.json(demo);
   if(rpc==='workshop_state')return Response.json({last_request:null});
   if(rpc==='workshop_demo_observe'){demo={phase:'active',run_id:body.p_run,reset_at:new Date(Date.parse(body.p_completed)+600000).toISOString()};return Response.json(null);}
   if(rpc==='workshop_demo_claim_reset'){assert(now>=Date.parse(demo.reset_at));demo.phase='cleaning';return Response.json(true);}
   if(rpc==='workshop_demo_finish_reset'){assert(deleted);if(failFinish){failFinish=false;return Response.json({error:'Temporary database failure'},{status:500});}finished=true;demo.phase='idle';return Response.json(null);}
   throw Error('Unexpected RPC');
  }
  assert(url.startsWith('https://api.github.com/repos/'+REPO+'/'));
  if(url.includes('/actions/workflows/update.yml/runs?'))return Response.json({workflow_runs:deleted?[]:[run]});
  if(url.includes('/attempts/1/jobs?'))return Response.json({jobs:[]});
  if(url.endsWith('/actions/runs/101')&&method==='DELETE'){deleted=true;return new Response(null,{status:204});}
  if(url.endsWith('/git/ref/heads/'+DEMO_BRANCH))return branchExists?Response.json({object:{sha:'a'.repeat(40)}}):new Response(null,{status:404});
  if(url.endsWith('/git/refs/heads/'+DEMO_BRANCH)&&method==='DELETE'){assert(branchExists);branchExists=false;return new Response(null,{status:204});}
  throw Error('Unexpected GitHub request');
 };
 try{
  assert(!(await maintain()).reset);assert(!deleted&&!finished);
  now+=1000;
  let failed=false;try{await maintain();}catch{failed=true;}
  assert(failed&&deleted&&!branchExists&&!finished);
  assert((await maintain()).reset);assert(deleted&&finished);
  assert(calls.filter(x=>x.method==='DELETE').length===2);
 }finally{globalThis.fetch=original;Date.now=clock;Deno.env.delete('SUPABASE_URL');Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');}
});

Deno.test('Anonymous callers cannot invoke cleanup, even when normal guest execution is enabled',async()=>{
 Deno.env.set('WORKSHOP_GITHUB_TOKEN','github_pat_test_only');Deno.env.set('WORKSHOP_ZERO_BUDGET_CONFIRMED','true');Deno.env.set('WORKSHOP_WEBHOOK_SECRET','server-only-test');
 try{
  const url='https://example.supabase.co/functions/v1/workshop-api/api/maintenance';
  for(const method of ['GET','POST'])assert((await handle(new Request(url,{method}))).status===403);
  assert((await handle(new Request(url,{method:'POST',headers:{'X-Workshop-Webhook':'wrong'}}))).status===403);
 }finally{for(const key of ['WORKSHOP_GITHUB_TOKEN','WORKSHOP_ZERO_BUDGET_CONFIRMED','WORKSHOP_WEBHOOK_SECRET'])Deno.env.delete(key);}
});
