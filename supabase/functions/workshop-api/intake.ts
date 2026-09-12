import {json,REPO,DEMO_BRANCH} from './github.ts';
import {rpc,cached,invalidate} from './database.ts';
import batches from './batches.json' with {type:'json'};
const issuer='https://token.actions.githubusercontent.com';
const bytes=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function validateClaims(c:any,now=Date.now()/1000){
 if(c.iss!==issuer||c.aud!=='cpue-workshop-intake'||c.repository!==REPO||c.repository_id!=='1365242756'||c.repository_owner_id!=='51262923'||c.ref!=='refs/heads/'+DEMO_BRANCH||c.event_name!=='workflow_dispatch'||c.workflow_ref!==REPO+'/.github/workflows/update.yml@refs/heads/'+DEMO_BRANCH||c.runner_environment!=='github-hosted'||!/^\d+$/.test(c.run_id)||!/^\d+$/.test(c.run_attempt)||!Number.isFinite(c.exp)||!Number.isFinite(c.iat)||!Number.isFinite(c.nbf)||c.exp<=now||c.nbf>now+30||c.iat<now-600||c.iat>now+30||!c.sub)throw Error('Untrusted intake identity.');
 const allowed=[`repo:kyuhank/cpue-toy-data:ref:refs/heads/${DEMO_BRANCH}`,`repo:kyuhank@51262923/cpue-toy-data@1365242756:ref:refs/heads/${DEMO_BRANCH}`];
 if(!allowed.includes(c.sub))throw Error('Untrusted intake subject.');
}
export async function acceptIntake(request:Request){
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
 if(token.length>14000)throw Error('Invalid intake identity.');
 const parts=token.split('.');if(parts.length!==3)throw Error('Missing intake identity.');
 const header=JSON.parse(new TextDecoder().decode(bytes(parts[0]))),claims=JSON.parse(new TextDecoder().decode(bytes(parts[1])));
 if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('Invalid intake signature.');
 const jwks=await cached('github:oidc-keys',300,async()=>{const r=await fetch(issuer+'/.well-known/jwks',{redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Identity keys unavailable.');return r.json();});
 const jwk=jwks.keys.find((k:any)=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)throw Error('Unknown intake signing key.');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('Invalid intake signature.');
 validateClaims(claims);
 const text=await request.text();if(text.length>256)throw Error('Invalid intake request.');const body=JSON.parse(text);
 if(Object.keys(body).sort().join(',')!=='batch_sha256,request')throw Error('Invalid intake fields.');
 const limits=await rpc('workshop_state'),record=limits.last_request;
 if(record?.result?.request!==body.request||record.result.intake_mode!=='valid'||record.result.commit!==claims.sha||Date.parse(record.created_at)<Date.now()-10*60000)throw Error('This intake request is no longer active.');
 const run=await json('actions/runs/'+claims.run_id);
 if(run.path!=='.github/workflows/update.yml'||run.head_sha!==claims.sha||String(run.run_attempt)!==claims.run_attempt||run.status==='completed')throw Error('This intake run is no longer active.');
 const workflow=await json('contents/.github/workflows/update.yml?ref='+claims.sha);
 const pin=atob(workflow.content.replace(/\s/g,'')).match(/toy-pipeline\.yml@([a-f0-9]{40})/)?.[1];
 if(!pin||claims.job_workflow_ref!==`kyuhank/cpue-actions-demo/.github/workflows/toy-pipeline.yml@${pin}`||claims.job_workflow_sha!==pin)throw Error('Unregistered intake workflow.');
 const jobs=(await json(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)).jobs;
 if(!['submission','qc'].every(k=>jobs.some((j:any)=>j.name.includes('['+k+']')&&j.conclusion==='success'))||!jobs.some((j:any)=>j.name.includes('[ingest]')&&j.status==='in_progress'))throw Error('Submission and QC must pass before loading.');
 const batch=(batches as any)['2024'];
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(batch))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(body.batch_sha256!==hash)throw Error('The prepared batch does not match the fixed demonstration data.');
 const release=await rpc('workshop_load_batch',{p_sets:batch.sets,p_catch:batch.catch});await invalidate();return {...release,run_id:run.id};
}
