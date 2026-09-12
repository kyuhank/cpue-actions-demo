"""Freeze one synthetic workload for comparing shared and separate runners."""
import json, os
from pathlib import Path
import subprocess, tarfile
ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
(ROOT/'config').mkdir(exist_ok=True)
(ROOT/'config/stages.json').write_text(json.dumps({'extract':{'revision':'runner-comparison'}}))
(ROOT/'config/modules.json').write_text('{}')
subprocess.run(['python3','scripts/resolve_modules.py'],check=True)
subprocess.run(['python3','scripts/workflow_plan.py'],check=True)
assert all(x['action']=='run' for x in json.loads((ROOT/'stages/_plan.json').read_text())['stages'].values())
with tarfile.open('context.tar.gz','w:gz') as archive:
 for name in ('pipeline','scripts','data','config','modules.lock.json','module-branches.json','module-versions.json','stages/_plan.json'):
  archive.add(name,filter=lambda info: None if '__pycache__' in info.name else info)
