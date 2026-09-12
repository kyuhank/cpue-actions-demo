"""Run a stage, or the same complete chain, in the recorded container."""
from concurrent.futures import ThreadPoolExecutor
import json, os
from pathlib import Path
import subprocess, sys, tarfile
ROOT=Path.cwd()
for path in sorted((ROOT/'transfers').glob('*.tar.gz')):
 with tarfile.open(path) as archive:
  archive.extractall(ROOT,filter='data')
key=sys.argv[1]
plan=json.loads((ROOT/'stages/_plan.json').read_text())['stages']
assert key=='all' or key in plan
image=os.environ['TOY_CONTAINER_IMAGE']
subprocess.run(['docker','pull',image],check=True)
command=['docker','run','--rm','--network','none','--user',f'{os.getuid()}:{os.getgid()}','--volume',str(ROOT)+':/work','--workdir','/work']
for name in ('TOY_CONTAINER_IMAGE','TOY_CODE_COMMIT','TOY_DATA_COMMIT','TOY_DEMO_PACE_SECONDS','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):
 command+=['--env',name]
command += [image,'python','-u','scripts/run_stage.py']
def run(stage):
 subprocess.run(command+[stage],check=True)
if key=='all':
 done=set()
 while len(done)<len(plan):
  ready=[k for k,v in plan.items() if k not in done and set(v['parents'])<=done]
  assert ready
  with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(run,ready))
  done.update(ready)
else:run(key)
output='benchmark-fast.tar.gz' if key=='all' else 'stage-'+key+'.tar.gz'
with tarfile.open(output,'w:gz') as archive:
 archive.add('stages' if key=='all' else 'stages/'+key)
