"""Exercise actual extraction with the presentation timing used by the workflow."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
workflow = (ROOT / '.github/workflows/toy-pipeline.yml').read_text()
settings = {key: re.search(r'^\s+' + key + r': ([0-9.]+)$', workflow, re.M).group(1)
            for key in ('WORKSHOP_GROUP_SECONDS', 'WORKSHOP_TRANSITION_SECONDS')}
assert settings['WORKSHOP_TRANSITION_SECONDS'] == '1'
with tempfile.TemporaryDirectory(prefix='cpue-stage-pacing-') as folder:
    work = Path(folder)
    for name in ('pipeline', 'scripts', 'data'):
        shutil.copytree(ROOT / name, work / name, ignore=shutil.ignore_patterns('__pycache__'))
    env = {**os.environ, **settings, 'TOY_DEMO_PACE_SECONDS': '0', 'GITHUB_ACTIONS': 'false'}
    subprocess.run([sys.executable, 'scripts/workflow_plan.py'], cwd=work, env=env,
                   check=True, stdout=subprocess.DEVNULL)
    def group():
        started = time.monotonic()
        result = subprocess.run([sys.executable, 'scripts/run_group.py', '0'],
                                cwd=work, env=env, check=True, capture_output=True, text=True)
        return time.monotonic() - started, result.stdout
    elapsed, output = group()
    assert elapsed >= sum(float(value) for value in settings.values())
    assert 'PRESENTATION PACE: pause 1 s' in output
    record = json.loads((work / 'stages/extract/record.json').read_text())
    assert record['completed_at'] >= record['started_at'] and record['outputs']
    plan_path = work / 'stages/_plan.json'
    plan = json.loads(plan_path.read_text())
    plan['stages']['extract']['action'] = 'reuse'
    plan_path.write_text(json.dumps(plan))
    reused, output = group()
    assert 'PRESENTATION PACE' not in output and 'START:' not in output
    assert 'verified outputs reused' in output
    print(f'Actual extraction: {elapsed:.2f} s; reused group: {reused:.2f} s. One extra second per executed group.')
