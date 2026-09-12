import {validateClaims,acceptIntake} from '../supabase/functions/workshop-api/intake.ts';
const assert=(value:unknown)=>{if(!value)throw Error('Expected identity rejection');};
Deno.test('Intake identity is limited to the immutable demo repository and active runtime branch',()=>{
 const now=1800000000,base={iss:'https://token.actions.githubusercontent.com',aud:'cpue-workshop-intake',repository:'kyuhank/cpue-toy-data',repository_id:'1365242756',repository_owner_id:'51262923',ref:'refs/heads/demo-runtime',event_name:'workflow_dispatch',workflow_ref:'kyuhank/cpue-toy-data/.github/workflows/update.yml@refs/heads/demo-runtime',runner_environment:'github-hosted',run_id:'123',run_attempt:'1',iat:now-10,nbf:now-10,exp:now+300,sub:'repo:kyuhank@51262923/cpue-toy-data@1365242756:ref:refs/heads/demo-runtime'};
 validateClaims(base,now);
 for(const delta of [{repository_id:'1'},{repository_owner_id:'1'},{repository:'attacker/fork'},{ref:'refs/heads/main'},{event_name:'pull_request'},{aud:'other'},{iss:'https://attacker.example'},{workflow_ref:'kyuhank/cpue-toy-data/.github/workflows/other.yml@refs/heads/demo-runtime'},{exp:now-1},{iat:now-700},{nbf:now+100},{sub:'repo:attacker/fork:ref:refs/heads/demo-runtime'}]){
  let failed=false;try{validateClaims({...base,...delta},now);}catch{failed=true;}assert(failed);
 }
});
Deno.test('An anonymous caller or unsigned JWT cannot publish a batch',async()=>{
 for(const auth of ['', 'Bearer a.b.c','Bearer '+btoa(JSON.stringify({alg:'none'}))+'.'+btoa('{}')+'.fake']){
  let failed=false;try{await acceptIntake(new Request('https://example.test',{method:'POST',headers:{Authorization:auth},body:'{}'}));}catch{failed=true;}assert(failed);
 }
});

import {mapRun} from '../supabase/functions/workshop-api/github.ts';
Deno.test('QC return and recheck reflect actual GitHub steps in one workflow',()=>{
 const run={id:123,run_attempt:1,status:'in_progress',display_title:'Demo'};
 const steps=[{name:'QC submitted records',status:'completed',conclusion:'failure'},
 {name:'Correct and resubmit example',status:'in_progress'},
 {name:'Recheck corrected submission',status:'queued'}];
 const jobs=[{name:'[qc] Data quality check',status:'in_progress',steps}];
 const phase=()=>mapRun(run,jobs).intake_stages.find(s=>s.key==='qc')!.correction_phase;
 assert(phase()==='resubmitting');
 Object.assign(steps[1],{status:'completed',conclusion:'success'});steps[2].status='in_progress';
 assert(phase()==='rechecking');
 Object.assign(steps[2],{status:'completed',conclusion:'success'});assert(phase()==='corrected');
});
