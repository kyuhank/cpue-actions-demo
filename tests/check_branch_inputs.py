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
    receiver = work / 'receiver'
    for job, _ in parents:
        shutil.copytree(work / job / 'outputs', receiver / 'inputs' / job)
    run(ROOT / 'pipeline/assessment.py', receiver)
    run(ROOT / 'pipeline/report.py', receiver)
    for name in ('cpue.csv', 'summary.csv', 'biomass.csv'):
        assert (receiver / 'outputs' / name).read_bytes() == (baseline / 'outputs' / name).read_bytes(), name
    manifest = json.loads((receiver / 'outputs/manifest.json').read_text())
    assert manifest['dependencies']['assessment'] == ['cpue_vessel', 'cpue_year']
    assert manifest['input_preparation']['series'] == 2
    target = receiver / 'inputs/cpue_year/manifest.json'
    original = target.read_text()
    altered = json.loads(original)
    altered['source_sha256'] = 'different snapshot'
    target.write_text(json.dumps(altered))
    run(ROOT / 'pipeline/prepare_inputs.py', receiver, success=False)
    target.write_text(original)
    series = receiver / 'inputs/cpue_year/cpue.csv'
    original_series = series.read_bytes()
    series.write_bytes(original_series + b'\n')
    run(ROOT / 'pipeline/prepare_inputs.py', receiver, success=False)
    series.write_bytes(original_series)
    shutil.rmtree(receiver / 'inputs/cpue_year')
    run(ROOT / 'pipeline/prepare_inputs.py', receiver, success=False)
print('Separate CPUE jobs match baseline fits; mixed snapshots, modified indices and missing parents are rejected.')
