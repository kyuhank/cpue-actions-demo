"""Execute one named analysis stage and retain its exact inputs and outputs."""
import json
import os
from pathlib import Path
import runpy
import shutil
import sys
import time
from datetime import datetime, timezone
from workflow_plan import fingerprints, hashes, PARENTS

ROOT = Path(__file__).resolve().parents[1]
cases = json.loads((ROOT / 'pipeline/assessment_cases.json').read_text())
parents = PARENTS
key = sys.argv[1] if len(sys.argv) == 2 else ''
if key not in parents:
    raise SystemExit('Choose a declared analysis stage')
work = ROOT / 'stages' / key
plan_path = ROOT / 'stages/_plan.json'
plan = json.loads(plan_path.read_text()) if plan_path.exists() else None
if plan:
    expected = plan['stages'][key]
    if expected['action'] == 'reuse':
        raise SystemExit('This stage is already restored and must be skipped by the workflow')
    for parent in parents[key]:
        folder = ROOT / 'stages' / parent
        record = json.loads((folder / 'record.json').read_text())
        if record['fingerprint'] != plan['stages'][parent]['fingerprint'] or record['outputs'] != hashes(folder / 'outputs'):
            raise SystemExit('A parent output does not match the verified workflow plan')
work.mkdir(parents=True, exist_ok=False)
if key == 'synthesis':
    for parent in parents[key]:
        shutil.copytree(ROOT / 'stages' / parent / 'outputs', work / 'inputs' / parent)
elif parents[key]:
    shutil.copytree(ROOT / 'stages' / parents[key][-1] / 'outputs', work / 'outputs')
if key.startswith('prepare_'):
    shutil.copytree(ROOT / 'stages/extract/outputs', work / 'inputs/extract')
os.chdir(work)
os.environ['GITHUB_JOB'] = key
os.environ['TOY_CPUE_CHOICE'] = ('vessel_adjusted' if key.endswith('_vessel') else 'year_only') if key.startswith(('cpue_', 'prepare_')) else ''
os.environ['TOY_ASSESSMENT_CASE'] = key if key.startswith('assessment_') else ''
stage = ('cpue' if key.startswith('cpue_') else 'prepare_inputs' if key.startswith('prepare_') else 'assessment' if key.startswith('assessment_') else key)
started = time.perf_counter()
started_at = datetime.now(timezone.utc).isoformat()
runpy.run_path(str(ROOT / 'pipeline' / (stage + '.py')), run_name='__main__')
compute_seconds = time.perf_counter() - started
record = {'stage': key, 'fingerprint': plan['stages'][key]['fingerprint'] if plan else fingerprints()[key],
          'run_id': os.getenv('GITHUB_RUN_ID', 'local'), 'attempt': os.getenv('GITHUB_RUN_ATTEMPT', '1'),
          'code_commit': os.getenv('TOY_CODE_COMMIT', 'local'), 'started_at': started_at,
          'compute_seconds': compute_seconds, 'outputs': hashes(work / 'outputs')}
(work / 'record.json').write_text(json.dumps(record, indent=2) + '\n')
pause = min(8, max(0, float(os.getenv('TOY_DEMO_PACE_SECONDS', '0'))))
if pause:
    print(f'PRESENTATION PACE: {key}; computation {compute_seconds:.3f} s; hold this GitHub step for {pause:g} s', flush=True)
    time.sleep(pause)
record['completed_at'] = datetime.now(timezone.utc).isoformat()
(work / 'record.json').write_text(json.dumps(record, indent=2) + '\n')
