"""Time actual calculations, including the input-preparation to assessment handover."""
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
            for key in ('WORKSHOP_GROUP_SECONDS', 'WORKSHOP_TRANSITION_SECONDS',
                        'WORKSHOP_INPUT_PREP_SECONDS', 'WORKSHOP_ASSESSMENT_SECONDS')}
assert settings['WORKSHOP_TRANSITION_SECONDS'] == '1'
assert settings['WORKSHOP_INPUT_PREP_SECONDS'] == '5'
assert settings['WORKSHOP_ASSESSMENT_SECONDS'] == '5'
for key in settings:
    assert '--env ' + key in workflow, key
with tempfile.TemporaryDirectory(prefix='cpue-stage-pacing-') as folder:
    work = Path(folder)
    for name in ('pipeline', 'scripts', 'data'):
        shutil.copytree(ROOT / name, work / name, ignore=shutil.ignore_patterns('__pycache__'))
    env = {**os.environ, **settings, 'TOY_DEMO_PACE_SECONDS': '0', 'GITHUB_ACTIONS': 'false'}
    subprocess.run([sys.executable, 'scripts/workflow_plan.py'], cwd=work, env=env,
                   check=True, stdout=subprocess.DEVNULL)
    def group(number, pacing=settings):
        started = time.monotonic()
        result = subprocess.run([sys.executable, 'scripts/run_group.py', str(number)],
                                cwd=work, env={**env, **pacing}, check=True,
                                capture_output=True, text=True)
        return time.monotonic() - started, result.stdout
    observed = {}
    for number, minimum in ((0, 3.5), (1, 0), (2, 6), (3, 6)):
        # The CPUE calculation supplies real inputs; its timing is unchanged.
        elapsed, output = group(number, settings if number != 1 else dict.fromkeys(settings, '0'))
        if number != 1:
            assert elapsed >= minimum, (number, elapsed)
            assert 'PRESENTATION PACE: pause 1 s' in output
            observed[number] = round(elapsed, 2)
    records = {path.parent.name: json.loads(path.read_text())
               for path in (work / 'stages').glob('*/record.json')}
    for record in records.values():
        assert record['completed_at'] >= record['started_at'] and record['outputs']
    for key, record in records.items():
        if key.startswith('assessment_'):
            assert record['started_at'] >= max(records[parent]['completed_at']
                for parent in ('prepare_vessel', 'prepare_year', 'cpue_summary'))
    plan_path = work / 'stages/_plan.json'
    plan = json.loads(plan_path.read_text())
    for stage in plan['stages'].values():
        stage['action'] = 'reuse'
    plan_path.write_text(json.dumps(plan))
    for number in (0, 2, 3):
        reused, output = group(number)
        assert 'PRESENTATION PACE' not in output and 'START:' not in output
        assert 'verified outputs reused' in output
    # A CPUE-report-only run must not inherit the longer assessment pause.
    plan['stages']['cpue_report']['action'] = 'run'
    plan_path.write_text(json.dumps(plan))
    shutil.rmtree(work / 'stages/cpue_report')
    _, output = group(3)
    assert 'visible for at least 2.5 s' in output
    assert 'START: assessment_' not in output
    print(f'Actual group durations: {observed} s. Input preparation and assessment each remain visible for 6 s; reused groups do not pause.')
