import {handle} from '../supabase/functions/workshop-api/index.ts';
import {mapRun,definitions} from '../supabase/functions/workshop-api/github.ts';
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({a,b}));};
const endpoint='https://example.supabase.co/functions/v1/workshop-api';
Deno.test('Unconfigured cloud cannot publish; paths, fields and request identities are bounded',async()=>{
 Deno.env.delete('WORKSHOP_GITHUB_TOKEN');Deno.env.delete('WORKSHOP_ZERO_BUDGET_CONFIRMED');
 equal((await handle(new Request(endpoint+'/api/presentation-info'))).status,200);
 const req=(path='/api/update',body='{}',headers={})=>new Request(endpoint+path,{method:'POST',body,headers:{'Content-Type':'application/json','X-Workshop-Action':'publish-synthetic-data','X-Workshop-Request':crypto.randomUUID(),...headers}});
 for(const path of ['/api/change/private-stage','/api/change/../../private','/admin','/api/dispatch'])equal((await handle(req(path))).status,404);
 for(const body of ['{"repo":"private"}','{"command":"anything"}','[]','null','x'.repeat(65)])equal((await handle(req('/api/update',body))).status,400);
 equal((await handle(req('/api/update?repo=private'))).status,400);
 equal((await handle(req('/api/update','{}',{'X-Workshop-Request':'replay'}))).status,400);
 equal((await handle(req())).status,503);
 equal((await handle(req('/api/run',JSON.stringify({start:'cpue_vessel',branches:{cpue_vessel:'model-a-dev'}})))).status,503);
 for(const body of ['{}','null','{"start":"report","branches":{},"command":"x"}'])equal((await handle(req('/api/run',body))).status,400);
 for(const [stage] of definitions)equal((await handle(req('/api/change/'+stage))).status,503);
 Deno.env.set('WORKSHOP_GITHUB_TOKEN','fake-dedicated-token');
 equal((await handle(req())).status,503); // A token alone cannot bypass the no-charge prerequisite.
 Deno.env.delete('WORKSHOP_GITHUB_TOKEN');
 equal((await handle(new Request(endpoint+'/api/output?job=1-1-extract&file=secret'))).status,400);
 for(const job of ['1-1-private','1-1-../report','baseline-extract'])equal((await handle(new Request(endpoint+'/api/outputs?job='+encodeURIComponent(job)))).status,400);
 equal((await handle(new Request(endpoint+'/api/output?job=1-1-cpue_vessel&file=report.html'))).status,400);
 for(const query of ['version=2025','version=2024&version=2023','table=private','version=main'])equal((await handle(new Request(endpoint+'/api/database?'+query))).status,400);
 const cors=await handle(new Request(endpoint+'/api/update',{method:'OPTIONS',headers:{Origin:'null'}}));equal(cors.status,204);equal(cors.headers.get('access-control-allow-origin'),'*');
});
Deno.test('Real skipped steps are reuse only after successful verified restore; dependencies wait',()=>{
 const run={id:123,run_attempt:1,run_number:4,head_sha:'a'.repeat(40),status:'in_progress',display_title:'Database version 2025',html_url:'https://github.com/kyuhank/cpue-toy-data/actions/runs/123'};
 const steps:any[]=[{name:'Restore and verify reusable outputs',status:'completed',conclusion:'success'},
 {name:'01 Extract · reused',status:'completed',conclusion:'skipped'},
 {name:'02 CPUE: year + vessel',status:'in_progress'},...definitions.slice(2).map(x=>({name:x[1],status:'pending'}))];
 const d=mapRun(run,[{id:8,steps}]);
 equal(d.stages.length,13);equal(d.stages[0].reused,true);equal(d.stages[0].status,'completed');
 equal(d.stages[1].status,'running');equal(d.stages[3].status,'waiting');equal(d.database_version,2025);
 equal(d.stages.find(s=>s.key==='prepare_vessel')?.parents,['extract','cpue_vessel']);equal(d.stages.find(s=>s.key==='synthesis')?.parents.length,4);
 steps[3].status='in_progress';equal(mapRun(run,[{id:8,steps}]).stages.filter(s=>s.status==='running').length,2);
 steps[0].conclusion='failure';equal(mapRun(run,[{id:8,steps}]).stages[0].reused,false);
});

Deno.test('Independent runners expose setup, reused inputs and failure states per module',()=>{
 const assert=(value:unknown)=>{if(!value)throw Error('Unexpected module runner state');};
 const run={id:1,run_attempt:1,run_number:1,html_url:'',head_sha:'a'.repeat(40),status:'in_progress',head_branch:'main',display_title:'test',created_at:'2026-09-12T00:00:00Z'};
 const jobs=[{id:1,name:'[plan]',status:'completed',conclusion:'success',steps:[]},{id:2,name:'[extract] · reused / run / Execute',status:'completed',conclusion:'skipped',steps:[]},{id:3,name:'[cpue_vessel] / run / Execute',status:'in_progress',steps:[{name:'Pull container image',status:'in_progress',number:5}]},{id:4,name:'[cpue_year] / run / Execute',status:'completed',conclusion:'failure',steps:[]}];
 const result=mapRun(run,jobs);
 assert(result.execution.mode==='module_jobs');
 assert(result.stages.find(s=>s.key==='extract')?.reused);
 assert(result.stages.find(s=>s.key==='cpue_vessel')?.status==='waiting');
 assert(result.stages.find(s=>s.key==='cpue_vessel')?._job_id===3);
 assert(result.stages.find(s=>s.key==='cpue_year')?.status==='failed');
 assert(result.stages.find(s=>s.key==='report')?.status==='waiting');
});

Deno.test('A warm runner waiting for its group is not an analysis in progress',()=>{
 const run={id:1,run_attempt:1,run_number:1,html_url:'',head_sha:'a'.repeat(40),status:'in_progress',display_title:'test'};
 const barrier={name:'Wait for previous stage group and verify inputs',status:'in_progress'};
 const module:any={name:'Run module',status:'pending'};
 const jobs=[{name:'[plan]',status:'completed',conclusion:'success',steps:[]},{name:'[cpue_vessel] / run / Execute',status:'in_progress',steps:[barrier,module]}];
 equal(mapRun(run,jobs).stages.find(s=>s.key==='cpue_vessel')?.status,'waiting');
 module.status='in_progress';equal(mapRun(run,jobs).stages.find(s=>s.key==='cpue_vessel')?.status,'running');
});

Deno.test('Runner allocation without step metadata never marks downstream computation running',()=>{
 const r=mapRun({id:123,run_attempt:1,status:'in_progress',display_title:'Demo'},[{name:'[plan]',status:'completed',conclusion:'success'},{name:'[report]',status:'in_progress',steps:[]}]);
 if(r.stages.some(s=>s.status==='running'))throw Error('Setup must remain waiting');
});

Deno.test('Compact groups preserve per-stage reuse and synchronise parallel statuses',()=>{
 const run={id:1,run_attempt:1,status:'in_progress',display_title:'Demo'};
 const steps=[{name:'Restore and verify reusable outputs',status:'completed',conclusion:'success'},
 {name:'Extract [extract=reuse]',status:'completed',conclusion:'success'},
 {name:'CPUE analyses [cpue_vessel=run cpue_year=reuse]',status:'in_progress'},
 {name:'QC submitted records',status:'completed',conclusion:'success'},
 {name:'Return failed submission',status:'completed',conclusion:'success'},
 {name:'Correct and resubmit example',status:'in_progress'},
 {name:'Recheck corrected submission',status:'pending'}];
 const jobs=[{name:'Pipeline / Workshop demonstration · compact',status:'in_progress',steps}];
 const r=mapRun(run,jobs);
 equal(r.execution.mode,'grouped_steps');
 equal(r.stages.find(s=>s.key==='extract')?.reused,true);
 equal(r.stages.find(s=>s.key==='cpue_vessel')?.status,'running');
 equal(r.stages.find(s=>s.key==='cpue_year')?.reused,true);
 equal(r.stages.find(s=>s.key==='prepare_vessel')?.status,'waiting');
 equal(r.intake_stages.find(s=>s.key==='qc')?.correction_phase,'resubmitting');
});

Deno.test('Database activity follows the real fetch step; live queries cannot select another repository',async()=>{
 const run={id:1,run_attempt:1,run_number:1,status:'in_progress',display_title:'test',head_sha:'a'.repeat(40)};
 const step:any={name:'Fetch versioned database snapshot',status:'in_progress',number:12};
 const jobs=[{name:'Workshop demonstration · compact',steps:[step]}];
 equal(mapRun(run,jobs).database_stage.status,'running');
 step.status='completed';step.conclusion='success';equal(mapRun(run,jobs).database_stage.status,'completed');
 for(const q of ['run=1&repo=private','run=../private','run=1&run=2','run=','run=abc'])equal((await handle(new Request(endpoint+'/api/live?'+q))).status,400);
});
