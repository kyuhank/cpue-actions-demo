"""Run the locked modules locally with the same dependency order as the demo."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
if (ROOT / 'stages').exists():
    raise SystemExit('Use a fresh checkout or move the previous stages/ folder before running again.')
subprocess.run([sys.executable, 'scripts/resolve_modules.py'], check=True)
subprocess.run([sys.executable, 'scripts/workflow_plan.py'], check=True)
stages = json.loads((ROOT / 'stages/_plan.json').read_text())['stages']
complete = {key for key, record in stages.items() if record['action'] == 'reuse'}
while len(complete) < len(stages):
    ready = [key for key, record in stages.items() if key not in complete and set(record['parents']) <= complete]
    if not ready:
        raise SystemExit('No runnable stage; dependency inputs are missing')
    def run(key):
        subprocess.run([sys.executable, 'scripts/run_stage.py', key], check=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(run, ready))
    complete.update(ready)
print('Open stages/report/outputs/report.html')
