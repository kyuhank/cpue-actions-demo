
const $=id=>document.getElementById(id);let latest='',loaded='';
if(parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');
async function refresh(){try{
 const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error('Local status unavailable');const d=await r.json();if(!d.ready)throw Error('No verified run available');
 const id=d.stages.find(s=>s.key==='report').source_id,complete=d.status==='completed'&&d.conclusion==='success'&&d.stages.every(s=>s.status==='completed');latest=id;
 $('stages').textContent=d.stages.filter(s=>s.status==='completed').length+' / '+d.stages.length+' jobs complete';$('run').href=d.run_url;
 $('report').classList.toggle('disabled',!complete||loaded!==id);
 $('message').textContent=d.source.stale?'Refresh unavailable: these are the last verified states.':'Run '+d.number+' · attempt '+d.attempt+' · verified '+new Date(d.source.last_success).toLocaleTimeString();
 if(loaded!==id){$('years').textContent=complete?'Loading…':'In progress';$('rows').textContent='This run’s report will appear when all jobs complete.';for(const key of ['data','code','settings']){$(key).textContent='—';$(key).removeAttribute('href');}}
 if(complete&&loaded!==id){const response=await fetch('/api/output?job='+encodeURIComponent(id)+'&file=manifest.json');if(!response.ok)throw Error('Report artifact unavailable; use the completed example below the panel.');const m=await response.json();if(latest!==id)return;const settingsCommit=m.configuration?.git_commit||m.workflow_plan?.trigger_commit||m.source_git_commit;if(String(m.github_run_id)!==String(d.run_id)||settingsCommit!==d.commit)throw Error('Run identity differs from the selected result.');if(d.database_version&&String(m.source_version)!==String(d.database_version))throw Error('Data release differs from the selected run.');
  $('years').textContent=m.first_year+'–'+m.last_year;$('rows').textContent=m.rows.toLocaleString()+' synthetic longline sets';$('data').textContent=m.source_provider==='supabase'?'Release '+m.source_version:m.source_git_commit.slice(0,12);$('data').href=m.source_provider==='supabase'?'/api/output?job='+encodeURIComponent(id)+'&file=manifest.json':'https://github.com/'+m.source_repository+'/commit/'+m.source_git_commit;$('settings').textContent=settingsCommit.slice(0,12);$('settings').href='https://github.com/kyuhank/cpue-toy-data/commit/'+settingsCommit;$('code').textContent=m.git_commit.slice(0,12);$('code').href='https://github.com/kyuhank/cpue-actions-demo/commit/'+m.git_commit;$('report').href='/api/output?job='+encodeURIComponent(id)+'&file=report.html';loaded=id;$('report').classList.remove('disabled');
 }
}catch(e){$('message').textContent=e.message;}}
refresh();setInterval(refresh,4000);
async function heartbeat(){try{const r=await fetch('/api/presentation-info',{cache:'no-store'});if(r.ok&&(await r.json()).presentation==='cpue-workshop'&&parent!==window)parent.postMessage({type:'cpue-panel-ready'},'*');}catch(e){}}
heartbeat();setInterval(heartbeat,4000);
