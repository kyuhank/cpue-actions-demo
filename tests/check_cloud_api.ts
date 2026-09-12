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
 for(const [stage] of definitions)equal((await handle(req('/api/change/'+stage))).status,503);
 Deno.env.set('WORKSHOP_GITHUB_TOKEN','fake-dedicated-token');
 equal((await handle(req())).status,503); // A token alone cannot bypass the no-charge prerequisite.
 Deno.env.delete('WORKSHOP_GITHUB_TOKEN');
 equal((await handle(new Request(endpoint+'/api/output?job=1-1-extract&file=secret'))).status,400);
 for(const job of ['1-1-private','1-1-../report','baseline-extract'])equal((await handle(new Request(endpoint+'/api/outputs?job='+encodeURIComponent(job)))).status,400);
 equal((await handle(new Request(endpoint+'/api/output?job=1-1-cpue_vessel&file=report.html'))).status,400);
 const cors=await handle(new Request(endpoint+'/api/update',{method:'OPTIONS',headers:{Origin:'null'}}));equal(cors.status,204);equal(cors.headers.get('access-control-allow-origin'),'*');
});
Deno.test('Real skipped steps are reuse only after successful verified restore; dependencies wait',()=>{
 const run={id:123,run_attempt:1,run_number:4,head_sha:'a'.repeat(40),status:'in_progress',display_title:'Database version 2025',html_url:'https://github.com/kyuhank/cpue-toy-data/actions/runs/123'};
 const steps:any[]=[{name:'Restore and verify reusable outputs',status:'completed',conclusion:'success'},
 {name:'01 Extract · reused',status:'completed',conclusion:'skipped'},
 {name:'02 CPUE: year + vessel',status:'in_progress'},...definitions.slice(2).map(x=>({name:x[1],status:'pending'}))];
 const d=mapRun(run,[{id:8,steps}]);
 equal(d.stages.length,11);equal(d.stages[0].reused,true);equal(d.stages[0].status,'completed');
 equal(d.stages[1].status,'running');equal(d.stages[3].status,'waiting');equal(d.database_version,2025);
 equal(d.stages[3].parents,['extract','cpue_vessel']);equal(d.stages[9].parents.length,4);
 steps[3].status='in_progress';equal(mapRun(run,[{id:8,steps}]).stages.filter(s=>s.status==='running').length,2);
 steps[0].conclusion='failure';equal(mapRun(run,[{id:8,steps}]).stages[0].reused,false);
});
