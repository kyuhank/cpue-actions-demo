"""Verify separate CPUE jobs preserve results and reject incompatible parents."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def run(script, folder, extra=None, success=True):
    env = {**os.environ, **(extra or {})}
    result = subprocess.run([sys.executable, str(script)], cwd=folder, env=env,
                            capture_output=True, text=True, check=False)
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    return result

with tempfile.TemporaryDirectory(prefix='cpue-branches-') as temporary:
    work = Path(temporary)
    baseline = work / 'baseline'
    baseline.mkdir()
    for name in ('pipeline', 'data'):
        shutil.copytree(ROOT / name, baseline / name)
    shutil.copyfile(ROOT / 'run.py', baseline / 'run.py')
    run(baseline / 'run.py', baseline, {'TOY_CPUE_CHOICE': ''})
    extract = work / 'extract'
    extract.mkdir()
    for name in ('pipeline', 'data'):
        shutil.copytree(ROOT / name, extract / name)
    run(extract / 'pipeline/extract.py', extract)
    parents = [('cpue_vessel', 'vessel_adjusted'), ('cpue_year', 'year_only')]
    def fit(parent):
        job, choice = parent
        folder = work / job
        shutil.copytree(extract / 'outputs', folder / 'outputs')
        run(ROOT / 'pipeline/cpue.py', folder, {'TOY_CPUE_CHOICE': choice, 'GITHUB_JOB': job})
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(fit, parents))
    for job, choice in parents:
        folder = work / ('prepare_' + ('vessel' if choice == 'vessel_adjusted' else 'year'))
        shutil.copytree(work / job / 'outputs', folder / 'outputs')
        run(ROOT / 'pipeline/prepare_inputs.py', folder, {'TOY_CPUE_CHOICE': choice, 'GITHUB_JOB': folder.name})
    cases = json.loads((ROOT / 'pipeline/assessment_cases.json').read_text())
    def assess(case):
        prep = 'prepare_vessel' if case['choice'] == 'vessel_adjusted' else 'prepare_year'
        folder = work / case['key']
        shutil.copytree(work / prep / 'outputs', folder / 'outputs')
        run(ROOT / 'pipeline/assessment.py', folder, {'TOY_ASSESSMENT_CASE': case['key'], 'GITHUB_JOB': case['key']})
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(assess, cases))
    receiver = work / 'receiver'
    for case in cases:
        shutil.copytree(work / case['key'] / 'outputs', receiver / 'inputs' / case['key'])
    run(ROOT / 'pipeline/report.py', receiver)
    for name in ('cpue.csv', 'assessment-input.csv', 'summary.csv', 'biomass.csv'):
        assert (receiver / 'outputs' / name).read_bytes() == (baseline / 'outputs' / name).read_bytes(), name
    manifest = json.loads((receiver / 'outputs/manifest.json').read_text())
    assert manifest['dependencies']['assessment_vessel_ref'] == ['prepare_vessel']
    assert len(manifest['assessment_runs']) == 4
    assert len(manifest['input_preparations']) == 2
    altered_parent = receiver / 'inputs' / cases[-1]['key']
    target = altered_parent / 'manifest.json'
    original = target.read_text()
    altered = json.loads(original)
    altered['source_sha256'] = 'different snapshot'
    target.write_text(json.dumps(altered))
    run(ROOT / 'pipeline/collect_results.py', receiver, success=False)
    target.write_text(original)
    prepared = altered_parent / 'assessment-input.csv'
    original_input = prepared.read_bytes()
    prepared.write_bytes(original_input + b'\n')
    run(ROOT / 'pipeline/collect_results.py', receiver, success=False)
    prepared.write_bytes(original_input)
    shutil.rmtree(altered_parent)
    run(ROOT / 'pipeline/collect_results.py', receiver, success=False)
    prep = work / 'prepare_year'
    index = prep / 'outputs/cpue.csv'
    index.write_bytes(index.read_bytes() + b'\n')
    run(ROOT / 'pipeline/prepare_inputs.py', prep, {'TOY_CPUE_CHOICE': 'year_only'}, success=False)
print('Ten-job results match local execution; altered CPUE/prepared inputs, mixed snapshots and missing assessment cases are rejected.')
