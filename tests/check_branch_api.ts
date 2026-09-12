import {parseSelection,branchUpdates,runBranches,changeBranch,selectedModules,definitions} from '../supabase/functions/workshop-api/github.ts';
const assert=(value:unknown)=>{if(!value)throw Error('Assertion failed');};
Deno.test('Branch controls preserve stage identities and reject arbitrary sources',()=>{
 const lock=JSON.parse(Deno.readTextFileSync('modules.lock.json'));
 const catalog=JSON.parse(Deno.readTextFileSync('module-branches.json'));
 const selected=selectedModules(lock,catalog,{cpue_vessel:{branch:'model-a-dev'}});
 assert(selected.sources.cpue_vessel.commit===catalog.cpue_vessel['model-a-dev'].commit);
 assert(selected.sources.cpue_year.commit===lock.cpue_year.commit);
 let rejected=false;try{selectedModules(lock,catalog,{cpue_vessel:{branch:'private'}});}catch{rejected=true;}assert(rejected);
 const altered=structuredClone(catalog);altered.cpue_vessel.private={repository:'kyuhank/private-example',branch:'private',commit:'a'.repeat(40)};
 rejected=false;try{selectedModules(lock,altered,{cpue_vessel:{branch:'private'}});}catch{rejected=true;}assert(rejected);
});
Deno.test('A mixed branch run atomically commits two fixed configuration paths and dispatches only the demo',async()=>{
 const original=globalThis.fetch,calls:{path:string,method:string,body:any}[]=[];
 const lock=JSON.parse(Deno.readTextFileSync('modules.lock.json')),catalog=JSON.parse(Deno.readTextFileSync('module-branches.json'));
 const head='c'.repeat(40),core='d'.repeat(40),newCommit='e'.repeat(40);
 const content=(value:unknown)=>Response.json({content:btoa(JSON.stringify(value))});
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input)),path=url.pathname,method=options?.method||'GET',body=options?.body?JSON.parse(String(options.body)):null;
  calls.push({path,method,body});
  if(url.hostname==='raw.githubusercontent.com'){
   assert(!new Headers(options?.headers).has('Authorization'));
   assert(path.startsWith('/kyuhank/cpue-actions-demo/'+core+'/'));
   return Response.json(path.endsWith('modules.lock.json')?lock:catalog);
  }
  assert(path.startsWith('/repos/kyuhank/cpue-toy-data/'));
  if(path.endsWith('/git/ref/heads/demo-runtime'))return Response.json({object:{sha:head}});
  if(path.endsWith('/contents/.github/workflows/update.yml'))return Response.json({content:btoa('uses: kyuhank/cpue-actions-demo/.github/workflows/toy-pipeline.yml@'+core)});
  if(path.endsWith('/contents/config/modules.json'))return content({});
  if(path.endsWith('/contents/config/stages.json'))return content({cpue_vessel:{min_hooks:0},cpue_year:{min_hooks:2000}});
  if(path.endsWith('/git/commits/'+head))return Response.json({tree:{sha:'f'.repeat(40)}});
  if(path.endsWith('/git/trees'))return Response.json({sha:'1'.repeat(40)});
  if(path.endsWith('/git/commits'))return Response.json({sha:newCommit});
  if(path.endsWith('/git/refs/heads/demo-runtime'))return Response.json({});
  if(path.endsWith('/actions/workflows/update.yml/dispatches'))return new Response(null,{status:204});
  throw Error('Unexpected request: '+path);
 };
 try{
  const result=await runBranches('cpue_vessel',{cpue_vessel:'model-a-dev',assessment_year_ref:'structure-1-dev'},'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert(result.commit===newCommit&&result.branches.cpue_vessel.commit===catalog.cpue_vessel['model-a-dev'].commit);
  const tree=calls.find(c=>c.method==='POST'&&c.path.endsWith('/git/trees'))!.body.tree;
  assert(tree.length===2&&tree[0].path==='config/modules.json'&&tree[1].path==='config/stages.json');
  assert(JSON.parse(tree[0].content).cpue_vessel.branch==='model-a-dev');
  assert(JSON.parse(tree[0].content).assessment_year_ref.branch==='structure-1-dev');
  assert(!JSON.parse(tree[1].content).cpue_vessel&&JSON.parse(tree[1].content).cpue_year.min_hooks===2000);
  assert(calls.find(c=>c.method==='PATCH')!.body.force===false);
  assert(calls.at(-1)?.body.ref==='demo-runtime');
 }finally{globalThis.fetch=original;}
});

Deno.test('Every stage can choose independently; a combined request keeps other stage selections',()=>{
 const lock=JSON.parse(Deno.readTextFileSync('modules.lock.json')),catalog=JSON.parse(Deno.readTextFileSync('module-branches.json'));
 const available=selectedModules(lock,catalog,{}),chosen:Record<string,string>={};
 for(const [key] of definitions){chosen[key]=Object.keys(catalog[key]).at(-1)!;}
 const parsed=parseSelection(JSON.stringify({start:'cpue_vessel',branches:chosen}));
 const updates=branchUpdates(parsed.start,parsed.branches,available);
 assert(Object.keys(updates).length===11);
 for(const [key,branch] of Object.entries(chosen))assert(updates[key].commit===catalog[key][branch].commit);
 const mixed=branchUpdates('cpue_vessel',{cpue_vessel:'model-a-dev',assessment_year_ref:'structure-1-dev'},available);
 assert(Object.keys(mixed).length===2&&mixed.cpue_vessel.branch!==mixed.assessment_year_ref.branch);
 for(const value of [{start:'private',branches:{}},{start:'data',branches:{private:'main'}},{start:'extract',branches:{extract:{commit:'a'.repeat(40)}}},{start:'extract',branches:{extract:'main'},repo:'private'},null]){
  let rejected=false;try{parseSelection(JSON.stringify(value));}catch{rejected=true;}assert(rejected);
 }
});

Deno.test('Only the two bounded database releases can accompany a module selection',()=>{
 for(const version of [2023,2024])assert(parseSelection(JSON.stringify({start:'cpue_vessel',branches:{},data_version:version})).data_version===version);
 for(const version of [2025,'2023',null,{sql:'select *'},-1]){
  let rejected=false;try{parseSelection(JSON.stringify({start:'data',branches:{},data_version:version}));}catch{rejected=true;}assert(rejected);
 }
});
