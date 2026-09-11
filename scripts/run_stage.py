"""Execute one named analysis stage and retain its exact inputs and outputs."""
import json
import os
from pathlib import Path
import runpy
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
cases = json.loads((ROOT / 'pipeline/assessment_cases.json').read_text())
parents = {'extract': [], 'cpue_vessel': ['extract'], 'cpue_year': ['extract'],
           'prepare_vessel': ['cpue_vessel'], 'prepare_year': ['cpue_year'],
           **{case['key']: ['prepare_vessel' if case['choice'] == 'vessel_adjusted' else 'prepare_year'] for case in cases},
           'report': [case['key'] for case in cases]}
key = sys.argv[1] if len(sys.argv) == 2 else ''
if key not in parents:
    raise SystemExit('Choose a declared analysis stage')
work = ROOT / 'stages' / key
work.mkdir(parents=True, exist_ok=False)
if key == 'report':
    for parent in parents[key]:
        shutil.copytree(ROOT / 'stages' / parent / 'outputs', work / 'inputs' / parent)
elif parents[key]:
    shutil.copytree(ROOT / 'stages' / parents[key][0] / 'outputs', work / 'outputs')
os.chdir(work)
os.environ['GITHUB_JOB'] = key
os.environ['TOY_CPUE_CHOICE'] = ('vessel_adjusted' if key.endswith('_vessel') else 'year_only') if key.startswith(('cpue_', 'prepare_')) else ''
os.environ['TOY_ASSESSMENT_CASE'] = key if key.startswith('assessment_') else ''
stage = ('cpue' if key.startswith('cpue_') else 'prepare_inputs' if key.startswith('prepare_') else 'assessment' if key.startswith('assessment_') else key)
runpy.run_path(str(ROOT / 'pipeline' / (stage + '.py')), run_name='__main__')
