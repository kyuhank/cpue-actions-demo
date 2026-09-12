"""Run one repository module with verified inputs on an independent runner."""
import json, os
from pathlib import Path
import re, subprocess, sys, tarfile
from resolve_modules import FILES, REPOS
from workflow_plan import hashes
ROOT=Path.cwd();mode,key,part=sys.argv[1:]
if key not in FILES or REPOS[key.split('_')[0]]!=part:raise SystemExit('Unknown module stage')
if mode=='prepare':
 if os.getenv('WORKSHOP_GROUP_BARRIER') == '1':
  from stage_barrier import wait_for_group
  wait_for_group(key, ROOT)
 for path in sorted((ROOT/'transfers').glob('*.tar.gz')):
  if not re.fullmatch(r'stage-\d+-[a-z_]+\.tar\.gz',path.name):raise SystemExit('Unknown input artifact')
  with tarfile.open(path) as archive:archive.extractall(ROOT,filter='data')
 print('INPUTS: recorded dependency artifacts retrieved and ready for verification')
elif mode=='run':
 context=json.loads((ROOT/'execution-context.json').read_text())
 source=json.loads((ROOT/'module-versions.json').read_text())[key]
 if source['repository']!='kyuhank/cpue-demo-'+part:raise SystemExit('Module repository does not match its runner')
 print('SOURCE:',source['repository'],source['branch']+'@'+source['commit'][:8],flush=True)
 print('DATA: release',context.get('TOY_SOURCE_VERSION','2023'),flush=True)
 command=['docker','run','--rm','--network','none','--user',f'{os.getuid()}:{os.getgid()}','--volume',str(ROOT)+':/work','--workdir','/work']
 for name,value in context.items():
  if not name.startswith('TOY_'):raise SystemExit('Unknown execution setting')
  command+=['--env',name+'='+value]
 for name in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','ImageVersion'):command+=['--env',name]
 # The frozen workflow context controls presentation pacing across reusable jobs.
 if 'TOY_DEMO_PACE_SECONDS' not in context:command+=['--env','TOY_DEMO_PACE_SECONDS']
 command +=[context['TOY_CONTAINER_IMAGE'],'python','-u','scripts/run_stage.py',key]
 subprocess.run(command,check=True)
 record=json.loads((ROOT/'stages'/key/'record.json').read_text())
 if record['outputs']!=hashes(ROOT/'stages'/key/'outputs'):raise SystemExit('Output verification failed')
 print('OUTPUTS:',key,'saved and checksum verified',flush=True)
 output=f'stage-{os.environ.get("GITHUB_RUN_ATTEMPT","1")}-{key}.tar.gz'
 with tarfile.open(output,'w:gz') as archive:archive.add('stages/'+key)
else:raise SystemExit('Choose prepare or run')
