"""Verify the fast step layout preserves the separately prepared scientific results."""
import csv
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[1]
keys=['extract','cpue_vessel','cpue_year','prepare_vessel','prepare_year','assessment_vessel_ref','assessment_vessel_high_m','assessment_year_ref','assessment_year_high_m','synthesis','report']
with tempfile.TemporaryDirectory(prefix='cpue-fast-') as tmp:
    root=Path(tmp)
    for name in ['pipeline','scripts','data']:shutil.copytree(ROOT/name,root/name)
    shutil.copyfile(ROOT/'run.py',root/'run.py')
    env={**os.environ,'TOY_EXECUTION_MODE':'single_runner_steps','TOY_CPUE_CHOICE':'','TOY_ASSESSMENT_CASE':''}
    subprocess.run([sys.executable,'run.py'],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
    for key in keys:subprocess.run([sys.executable,'scripts/run_stage.py',key],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
    for name in ['cpue.csv','assessment-input.csv','summary.csv','biomass.csv']:
        assert (root/'outputs'/name).read_bytes()==(root/'stages/report/outputs'/name).read_bytes(),name
    assert len(list(csv.DictReader((root/'stages/report/outputs/summary.csv').open())))==4
print('One-runner steps preserve CPUE, prepared inputs and all four assessment results exactly.')
