"""Exercise real partial rebuilds, unchanged outputs and scientific input checks."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cpue-incremental-') as folder:
    root = Path(folder)
    for name in ('pipeline', 'scripts', 'data'):
        shutil.copytree(ROOT / name, root / name)
    (root / 'config').mkdir()
    config = root / 'config/stages.json'
    config.write_text('{}')
    env = {**os.environ, 'TOY_CODE_COMMIT': 'a'*40, 'TOY_DEMO_PACE_SECONDS': '0', 'GITHUB_RUN_ID': '1'}
    def execute(previous=None):
        subprocess.run([sys.executable, 'scripts/workflow_plan.py', *([str(previous)] if previous else [])], cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
        plan = json.loads((root / 'stages/_plan.json').read_text())
        for key, record in plan['stages'].items():
            if record['action'] == 'run':
                subprocess.run([sys.executable, 'scripts/run_stage.py', key], cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
        return {k for k, v in plan['stages'].items() if v['action'] == 'run'}
    assert len(execute()) == 11
    baseline_plan=json.loads((root/'stages/_plan.json').read_text())
    assert baseline_plan['stages']['prepare_vessel']['parents']==['extract','cpue_vessel']
    assert baseline_plan['stages']['report']['parents']==['synthesis']
    first = root / 'first'; (root / 'stages').rename(first)
    config.write_text(json.dumps({'cpue_vessel': {'min_hooks': 2000}}))
    env['GITHUB_RUN_ID'] = '2'
    assert execute(first) == {'cpue_vessel', 'prepare_vessel', 'assessment_vessel_ref', 'assessment_vessel_high_m', 'synthesis', 'report'}
    for key in ('extract', 'cpue_year', 'prepare_year', 'assessment_year_ref', 'assessment_year_high_m'):
        for path in (first / key).rglob('*'):
            if path.is_file():
                assert path.read_bytes() == (root / 'stages' / path.relative_to(first)).read_bytes()
    assert (root / 'stages/cpue_vessel/outputs/cpue.csv').read_bytes() != (first / 'cpue_vessel/outputs/cpue.csv').read_bytes()
    second = root / 'second'; (root / 'stages').rename(second)
    config.write_text(json.dumps({'cpue_vessel': {'min_hooks': 2000}, 'assessment_vessel_high_m': {'M': .35}}))
    env['GITHUB_RUN_ID'] = '3'
    assert execute(second) == {'assessment_vessel_high_m', 'synthesis', 'report'}
    assert '3 stages executed · 8 reused' in (root / 'stages/report/outputs/report.html').read_text()
    third = root / 'third'; (root / 'stages').rename(third)
    import sqlite3
    with sqlite3.connect(root / 'data/toy-fishery.sqlite') as db:
        db.execute('UPDATE sets SET catch_n=catch_n+1 WHERE rowid=1')
    assert len(execute(third)) == 11
print('Verified: CPUE change runs 6 stages; assessment change runs 3; data change runs all 11. Reused outputs are byte-identical.')
