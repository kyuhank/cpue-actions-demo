'use strict';
const $=id=>document.getElementById(id), encoder=new TextEncoder();
const BASE=JSON.parse($('dataset').textContent), STAGES=['Extract','CPUE','Assessment','Report'];
let working, localHead='', remoteHead='', dirty=false, busy=false, runNumber=0, selected=0, selectedTab='dependencies', nextStage=0, started=0, finished=0;
let objects=new Map(), commits=new Map(), remoteObjects=new Map(), states=[], logs=[], files={}, context=null;
const bytes=s=>encoder.encode(s), concat=(...arrays)=>{const r=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let i=0;for(const a of arrays){r.set(a,i);i+=a.length;}return r;};
const digest=async(data,algorithm='SHA-256')=>Array.from(new Uint8Array(await crypto.subtle.digest(algorithm,data)),v=>v.toString(16).padStart(2,'0')).join('');
const fromHex=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));
async function gitObject(type,payload){const raw=concat(bytes(type+' '+payload.length+'\0'),payload),sha=await digest(raw,'SHA-1');objects.set(sha,raw);return sha;}
async function commitSnapshot(data,parent,message){
 const snapshot=JSON.stringify(data),blob=await gitObject('blob',bytes(snapshot+'\n'));
 const tree=await gitObject('tree',concat(bytes('100644 data.json\0'),fromHex(blob)));
 const identity='Workshop participant <participant@local.invalid> '+Math.floor(Date.now()/1000)+' +0000';
 const raw='tree '+tree+'\n'+(parent?'parent '+parent+'\n':'')+'author '+identity+'\ncommitter '+identity+'\n\n'+message+'\n';
 const sha=await gitObject('commit',bytes(raw));commits.set(sha,{parent,snapshot,message});return sha;
}
function csv(header,rows){return [header,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n';}
function extract(data){
 const sets=data.sets.filter(r=>r[3]>0&&r[4]>=0).sort((a,b)=>a[1]-b[1]||String(a[0]).localeCompare(String(b[0])));
 const years=[...new Set(sets.map(x=>x[1]))].sort((a,b)=>a-b);
 if(!sets.length||new Set(sets.map(x=>x[0])).size!==sets.length||JSON.stringify(years)!==JSON.stringify(data.removals.map(x=>x[0])))throw Error('Extraction failed: invalid record identities or unmatched years.');
 return {sets,years,removals:data.removals,choice:data.choice};
}
function fitCPUE(data){
 const {sets,years}=data,vs=[...new Set(sets.map(x=>x[2]))].sort(),ny=years.length,nv=vs.length;
 const E=Array.from({length:ny},()=>Array(nv).fill(0)),C=E.map(r=>r.slice());
 for(const row of sets){const i=years.indexOf(row[1]),j=vs.indexOf(row[2]);E[i][j]+=row[3]/1000;C[i][j]+=row[4];}
 const cy=C.map(r=>r.reduce((a,b)=>a+b,0)),cv=vs.map((v,j)=>C.reduce((n,r)=>n+r[j],0));
 if(cy.some(x=>x<=0)||cv.some(x=>x<=0))throw Error('A toy year or vessel group has no catch.');
 const nominal=cy.map((c,i)=>c/E[i].reduce((a,b)=>a+b,0));let a=nominal.slice(),b=vs.map(()=>1),iteration;
 for(iteration=0;iteration<10000;iteration++){
  const prev=a.slice();a=cy.map((c,i)=>c/E[i].reduce((n,e,j)=>n+e*b[j],0));b=cv.map((c,j)=>c/E.reduce((n,row,i)=>n+row[j]*a[i],0));
  const scale=b[0];a=a.map(x=>x*scale);b=b.map(x=>x/scale);
  if(Math.max(...a.map((x,i)=>Math.abs(Math.log(x/prev[i]))))<1e-12)break;
 }
 if(iteration===10000)throw Error('Poisson fit did not converge.');
 const residual=Math.max(...cy.map((c,i)=>Math.abs(E[i].reduce((n,e,j)=>n+e*a[i]*b[j],0)/c-1)));
 if(residual>1e-9)throw Error('Poisson score check failed.');
 const models=[['vessel_adjusted',a],['year_only',nominal]].filter(([name])=>data.choice==='both'||data.choice===name);
 return {rows:models.flatMap(([choice,x])=>years.map((year,i)=>({year,index:x[i]/x[0],choice}))),diagnostic:`Year + vessel: ${iteration+1} IPF iterations; relative score residual ${residual}. Year only: analytic Poisson group means.`};
}
function fitAssessment(data,indices){
 const trajectory=K=>{const B=[K];for(const row of data.removals.slice(0,-1)){const b=B.at(-1),v=b+.35*b*(1-b/K)-row[1];if(!Number.isFinite(v)||v<=0)return null;B.push(v);}return B;};
 const golden=f=>{let lo=Math.log(6000),hi=Math.log(100000);const t=(Math.sqrt(5)-1)/2;let a=hi-t*(hi-lo),b=lo+t*(hi-lo),fa=f(a),fb=f(b);for(let i=0;i<160&&hi-lo>1e-10;i++){if(fa<fb){hi=b;b=a;fb=fa;a=hi-t*(hi-lo);fa=f(a);}else{lo=a;a=b;fa=fb;b=lo+t*(hi-lo);fb=f(b);}}return (lo+hi)/2;};
 const summary=[],series=[];
 for(const choice of [...new Set(indices.map(x=>x.choice))]){
  const x=indices.filter(x=>x.choice===choice),L=x.map(x=>Math.log(x.index));
  const objective=logK=>{const B=trajectory(Math.exp(logK));if(!B)return 1e12;const logq=L.reduce((n,v,i)=>n+v-Math.log(B[i]),0)/B.length;return L.reduce((n,v,i)=>n+(v-logq-Math.log(B[i]))**2,0);};
  const logK=golden(objective),K=Math.exp(logK),B=trajectory(K);if(!B||objective(logK)>=1e11)throw Error('Biomass fit failed.');
  const q=Math.exp(L.reduce((n,v,i)=>n+v-Math.log(B[i]),0)/B.length);
  summary.push({choice,year:x.at(-1).year,K,q,r:.35,final_index:x.at(-1).index,final_B_over_K:B.at(-1)/K,log_index_SSE:objective(logK)});
  series.push(...x.map((v,i)=>({year:v.year,choice,biomass:B[i],B_over_K:B[i]/K,observed_index:v.index,fitted_index:q*B[i]})));
 }return {summary,series};
}
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function plot(rows,key,title){
 const ys=rows.map(x=>x.year),lo=Math.min(...ys),hi=Math.max(...ys),X=x=>45+(x-lo)/(hi-lo)*470,Y=v=>240-v/1.15*200;
 let svg=`<svg viewBox="0 0 560 300" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="300" fill="white"/><text x="45" y="22" font-size="18" font-family="Arial" fill="#001743">${title}</text>`;
 for(const v of [0,.5,1])svg+=`<path d="M45 ${Y(v)}H515" stroke="#d8e5ea"/><text x="34" y="${Y(v)+5}" text-anchor="end" font-size="14" font-family="Arial" fill="#536b7b">${v.toFixed(1)}</text>`;
 for(const y of [lo,hi])svg+=`<text x="${X(y)}" y="265" text-anchor="middle" font-size="14" font-family="Arial" fill="#536b7b">${y}</text>`;
 for(const [name,color,label,x] of [['vessel_adjusted','#0085ca','Year + vessel',45],['year_only','#c85a2d','Year only',300]]){
  const d=rows.filter(r=>r.choice===name);if(!d.length)continue;
  svg+=`<polyline points="${d.map(r=>X(r.year)+','+Y(r[key])).join(' ')}" fill="none" stroke="${color}" stroke-width="3"/><text x="${x}" y="291" font-size="14" font-family="Arial" fill="${color}">${label}</text>`;
 }return svg+'</svg>';
}
function reportHTML(result,manifest){return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Browser workflow report</title><style>body{font:17px/1.5 Arial;color:#001743;background:#fafcfc;max-width:1100px;margin:35px auto;padding:0 25px}h1{font:40px Georgia}.plots{display:grid;grid-template-columns:1fr 1fr;gap:20px}svg{width:100%}td,th{padding:12px;border-bottom:1px solid #d8e5ea;text-align:left}pre{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:20px}.note{color:#536b7b}</style><h1>A result with a record.</h1><p class="note">Synthetic data · real calculations in your browser · draft, no management advice.</p><p>Data through ${manifest.last_year} · ${manifest.rows.toLocaleString()} sets · browser run ${manifest.run}</p><div class="plots">${plot(result.series,'observed_index','Standardised CPUE / first year')}${plot(result.series,'B_over_K','Toy biomass / carrying capacity')}</div><table><tr><th>Choice</th><th>Latest index</th><th>Latest B/K</th></tr>${result.summary.map(x=>`<tr><td>${x.choice==='vessel_adjusted'?'Year + vessel':'Year only'}</td><td>${x.final_index.toFixed(3)}</td><td>${x.final_B_over_K.toFixed(3)}</td></tr>`).join('')}</table><p class="note">Poisson year + vessel / year only, effort offset, zero catches retained, equal vessel prediction weights. A Schaefer model fits K and q with r = 0.35 and initial B/K = 1 fixed. No uncertainty propagation. Both data and fishing-composition change are synthetic.</p><h2>Trace the result</h2><pre>${escapeHTML(JSON.stringify(manifest,null,2))}</pre></html>`;}
function newYear(){
 const year=working.removals.at(-1)[0]+1;if(year>2035)throw Error('Reset the workspace to start again.');
 let seed=(year*7919)>>>0;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)+.5)/4294967296;
 const poisson=mu=>{const l=Math.exp(-mu);let p=1,k=0;do{k++;p*=random();}while(p>l);return k-1;};
 let B=10000;for(const row of working.removals){B+=.35*B*(1-B/10000)-row[1];}
 const t=year-2000,catchT=t<16?600+t*20:920-(t-16)*15;
 working.removals.push([year,catchT]);const q=[.6,.9,1.3,1.8],names=[...new Set(working.sets.map(x=>x[2]))].sort(),mix=Math.min(.8,t/40);
 for(let i=0;i<240;i++){const u=random(),v=u<(1-mix)*.5?0:u<1-mix?1:u<1-mix/2?2:3,hooks=800+Math.floor(random()*2200);working.sets.push([`browser-${year}-${String(i+1).padStart(3,'0')}`,year,names[v],hooks,poisson(hooks/1000*8*(B/10000)*q[v])]);}
 dirty=true;$('notice').textContent=`Added ${year}: 240 new synthetic sets. Commit this update, then push it to the browser demo remote.`;render();
}
function render(){
 $('period').textContent=`${working.removals[0][0]}–${working.removals.at(-1)[0]} · ${working.sets.length.toLocaleString()} sets`;
 $('local-head').textContent=localHead.slice(0,10);$('remote-head').textContent=remoteHead.slice(0,10);
 $('add').disabled=busy;$('commit').disabled=busy||!dirty;$('push').disabled=busy||dirty||localHead===remoteHead;$('choice').disabled=busy;
 $('next').hidden=!(busy&&$('step').checked&&nextStage<4);$('next').textContent='Run '+(STAGES[nextStage]||'next job');$('reset').disabled=busy;
 $('chain').replaceChildren(...STAGES.map((name,i)=>{const b=document.createElement('button');b.className='stage '+states[i]+(i===selected?' selected':'');b.innerHTML=`<span>0${i+1}</span><b>${name}</b><small>${({ready:'Ready',waiting:'Waiting for parent',running:'Running',complete:'Complete',failed:'Failed',blocked:'Blocked'})[states[i]]||'Not run'}</small>`;b.onclick=()=>{selected=i;render();};return b;}));
 $('running').textContent=states.filter(x=>x==='running').length;$('waiting').textContent=states.filter(x=>x==='waiting').length;$('complete').textContent=states.filter(x=>x==='complete').length;
 $('job-title').textContent=STAGES[selected]+' · browser run '+runNumber;
 if(selectedTab==='dependencies'){$('detail').innerHTML=`<div class="dependencies"><span>${selected?STAGES[selected-1]:'New data commit'}</span><i>→</i><strong>${STAGES[selected]}</strong><i>→</i><span>${selected<3?STAGES[selected+1]:'Draft report'}</span></div><p>Each stage uses this run's parent output. A failure blocks the remaining stages.</p>`;}
 if(selectedTab==='logs'){$('detail').innerHTML='<pre>'+escapeHTML((logs[selected]||[]).join('\n')||'This stage has not run yet.')+'</pre>';}
 if(selectedTab==='files'){
  const names=[['sets.csv','catch.csv','manifest.json'],['cpue.csv','cpue-diagnostics.txt'],['biomass.csv','summary.csv'],['report.html','manifest.json']][selected].filter(x=>files[x]);
  $('detail').replaceChildren(...names.map(name=>{const b=document.createElement('button');b.className='file';b.textContent=name+' ↗';b.onclick=()=>name==='report.html'?openReport():download(name,files[name],'text/plain');return b;}));
  if(!names.length)$('detail').textContent='Outputs appear when this stage completes.';
 }
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===selectedTab));
 $('open-report').disabled=!files['report.html'];$('export').disabled=busy;$('run-time').textContent=busy?'Executing locally':started?'Completed in '+((finished-started)/1000).toFixed(2)+' s':'';
}
async function runStage(){
 const i=nextStage;if(i>=4||states[i]==='running')return;states[i]='running';logs[i]=['Started '+new Date().toISOString()];render();await new Promise(requestAnimationFrame);
 try{
  if(i===0){context.data=extract(context.snapshot);context.manifest={execution:'browser; no GitHub API calls',run:runNumber,data_commit:remoteHead,snapshot_sha256:await digest(bytes(commits.get(remoteHead).snapshot+'\n')),recipe_sha256:await digest(bytes(extract.toString()+fitCPUE.toString()+fitAssessment.toString())),reference_implementation:'kyuhank/cpue-actions-demo@b1821674b14222c26e1169b39f98cdd1a42f3700',choice:context.data.choice,rows:context.data.sets.length,first_year:context.data.years[0],last_year:context.data.years.at(-1),runtime:navigator.userAgent};files['sets.csv']=csv(['set_id','year','vessel','hooks','catch_n'],context.data.sets);files['catch.csv']=csv(['year','catch_t'],context.data.removals);logs[i].push('Checked '+context.data.sets.length+' rows; matching catch and index years.');}
  if(i===1){context.cpue=fitCPUE(context.data);files['cpue.csv']=csv(['year','index','choice'],context.cpue.rows.map(x=>[x.year,x.index,x.choice]));files['cpue-diagnostics.txt']=context.cpue.diagnostic;logs[i].push(context.cpue.diagnostic);}
  if(i===2){context.result=fitAssessment(context.data,context.cpue.rows);for(const [name,rows]of [['summary.csv',context.result.summary],['biomass.csv',context.result.series]]){const keys=Object.keys(rows[0]);files[name]=csv(keys,rows.map(x=>keys.map(k=>x[k])));}logs[i].push('Fitted '+context.result.summary.length+' toy Schaefer models.');}
  if(i===3){files['report.html']=reportHTML(context.result,context.manifest);logs[i].push('Standalone report and input/recipe identities recorded.');}
  files['manifest.json']=JSON.stringify(context.manifest,null,2);logs[i].push('Completed '+new Date().toISOString());states[i]='complete';nextStage++;
  if(nextStage<4)states[nextStage]='ready';else{busy=false;finished=performance.now();$('notice').textContent='The update is complete. Inspect dependencies, logs and outputs, or open the report.';}
 }catch(e){states[i]='failed';for(let j=i+1;j<4;j++)states[j]='blocked';logs[i].push(e.message);busy=false;$('notice').textContent=e.message;}
 render();if(busy&&!$('step').checked)await runStage();
}
async function push(){
 if(dirty||localHead===remoteHead||busy)return;let ancestor=localHead;while(ancestor&&ancestor!==remoteHead)ancestor=commits.get(ancestor)?.parent;if(ancestor!==remoteHead)throw Error('The browser remote requires a fast-forward update.');
 remoteObjects=new Map(objects);remoteHead=localHead;runNumber++;busy=true;states=['ready','waiting','waiting','waiting'];logs=STAGES.map(()=>[]);files={};nextStage=0;context={snapshot:JSON.parse(commits.get(remoteHead).snapshot)};started=performance.now();$('notice').textContent='Pushed to the isolated browser remote. Its new commit triggered the workflow.';render();
 if(!$('step').checked)await runStage();
}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function openReport(){const url=URL.createObjectURL(new Blob([files['report.html']],{type:'text/html'}));window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function zip(entries){let offset=0;const local=[],central=[];for(const [name,data]of entries){const n=bytes(name),crc=crc32(data),h=new Uint8Array(30),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);local.push(h,n,data);const ch=new Uint8Array(46),cv=new DataView(ch.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true);central.push(ch,n);offset+=h.length+n.length+data.length;}const c=concat(...central),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,c.length,true);v.setUint32(16,offset,true);return concat(...local,c,end);}
async function exportWorkspace(){const entries=[];for(const [name,map,head]of [['data.git',objects,localHead],['demo-remote.git',remoteObjects,remoteHead]]){entries.push([name+'/HEAD',bytes('ref: refs/heads/main\n')],[name+'/refs/heads/main',bytes(head+'\n')],[name+'/config',bytes('[core]\n repositoryformatversion = 0\n bare = true\n')]);for(const [sha,raw]of map){const compressed=await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();entries.push([name+'/objects/'+sha.slice(0,2)+'/'+sha.slice(2),new Uint8Array(compressed)]);}}for(const [name,data]of Object.entries(files))entries.push(['outputs/'+name,bytes(data)]);entries.push(['README.txt',bytes('Isolated browser demo. These are real bare Git repositories, not GitHub repositories.\nInspect with: git --git-dir=data.git log\nClone with: git clone demo-remote.git working-copy\nAll data are synthetic.\n')]);download('cpue-browser-workspace.zip',zip(entries),'application/zip');}
async function reset(){working=structuredClone(BASE);objects=new Map();commits=new Map();localHead=await commitSnapshot(working,'','Initial synthetic data');remoteHead=localHead;remoteObjects=new Map(objects);dirty=false;busy=false;runNumber=0;states=STAGES.map(()=> 'waiting');logs=STAGES.map(()=>[]);files={};started=0;$('choice').value='both';$('notice').textContent='Add one synthetic year, commit it, then push to your browser demo remote.';render();}
function action(f){return async()=>{try{await f();}catch(e){$('notice').textContent=e.message;}};}
$('add').onclick=action(newYear);$('commit').onclick=action(async()=>{localHead=await commitSnapshot(working,localHead,'Update synthetic data and analysis choice');dirty=false;$('notice').textContent='Committed '+localHead.slice(0,10)+'. Push this version to start the workflow.';render();});$('push').onclick=action(push);$('next').onclick=action(runStage);$('reset').onclick=action(reset);$('open-report').onclick=openReport;$('export').onclick=action(exportWorkspace);$('choice').onchange=()=>{working.choice=$('choice').value;dirty=true;render();};$('step').onchange=()=>{render();if(busy&&!$('step').checked)action(runStage)();};document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{selectedTab=b.dataset.tab;render();});reset().catch(e=>$('notice').textContent=e.message);
