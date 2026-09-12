"""Only compose exact module commits with successful repository CI checks."""
from concurrent.futures import ThreadPoolExecutor
import json, os
from pathlib import Path
import subprocess
from resolve_modules import selected_sources
ROOT=Path(__file__).resolve().parents[1]
def check(pair):
 repo,commit=pair
 env={k:v for k,v in os.environ.items() if k not in ('GH_DEBUG','DEBUG')}
 result=subprocess.run(['gh','api',f'repos/{repo}/commits/{commit}/check-runs'],env=env,check=True,capture_output=True,text=True,timeout=30)
 runs=json.loads(result.stdout)['check_runs']
 accepted=[r for r in runs if r['name'].endswith('Module reproducibility') and r['head_sha']==commit and r['app']['slug']=='github-actions' and r['status']=='completed' and r['conclusion']=='success']
 if not accepted:raise ValueError(f'Module CI has not passed: {repo}@{commit}')
 run=max(accepted,key=lambda r:r['id'])
 print(f'CI PASSED: {repo}@{commit[:8]} · two-run reproducibility and output contract')
 return {'repository':repo,'commit':commit,'check_id':run['id'],'url':run['html_url'],'conclusion':'success','completed_at':run['completed_at']}
pairs=sorted({(s['repository'],s['commit']) for s in selected_sources().values()})
with ThreadPoolExecutor(max_workers=4) as pool:checks=list(pool.map(check,pairs))
(ROOT/'module-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
