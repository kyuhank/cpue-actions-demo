"""Module commits identify each job, invalidate only dependants and survive replay."""
import base64
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile
from check_reproduction import Downloads

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cpue-modules-') as folder:
    root = Path(folder) / 'original'
    for name in ('pipeline', 'scripts', 'data'):
        shutil.copytree(ROOT/name, root/name)
    for name in ('modules.lock.json', 'module-versions.json'):
        shutil.copyfile(ROOT/name, root/name)
    (root/'config').mkdir();(root/'config/stages.json').write_text('{}')
    env={**os.environ,'GITHUB_ACTIONS':'false','GITHUB_RUN_ID':'modules','TOY_DEMO_PACE_SECONDS':'0','TOY_CODE_COMMIT':'a'*40}
    subprocess.run([sys.executable,'scripts/workflow_plan.py'],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
    plan=json.loads((root/'stages/_plan.json').read_text())
    for key in plan['stages']:
        subprocess.run([sys.executable,'scripts/run_stage.py',key],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
    out=root/'stages/report/outputs'
    manifest=json.loads((out/'manifest.json').read_text())
    assert len({s['repository'] for s in manifest['workflow_plan']['module_sources'].values()})==6
    for key, record in manifest['stage_records'].items():
        assert record['code_source']['commit']==manifest['workflow_plan']['module_sources'][key]['commit']
    download=Downloads();download.feed((out/'report.html').read_text())
    replay=Path(folder)/'replay'
    with zipfile.ZipFile(io.BytesIO(download.files['reproduction.zip'])) as archive:archive.extractall(replay)
    result=subprocess.run([sys.executable,'reproduce.py','--native'],cwd=replay,env=env,capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
    previous=root/'previous';(root/'stages').rename(previous)
    sources=json.loads((root/'module-versions.json').read_text())
    sources['cpue_vessel']['commit']='c'*40
    (root/'module-versions.json').write_text(json.dumps(sources))
    subprocess.run([sys.executable,'scripts/workflow_plan.py',str(previous)],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
    plan=json.loads((root/'stages/_plan.json').read_text())
    assert {key for key,r in plan['stages'].items() if r['action']=='run'}=={'cpue_vessel','prepare_vessel','assessment_vessel_ref','assessment_vessel_high_m','synthesis','report'}
    with (root/'pipeline/cpue_vessel.py').open('a') as f:f.write('\n# unrecorded edit\n')
    result=subprocess.run([sys.executable,'scripts/workflow_plan.py'],cwd=root,env=env,capture_output=True,text=True)
    assert result.returncode!=0 and 'does not match its locked commit' in result.stderr
print('Six repositories: exact module commits preserved; a CPUE commit changes only its downstream path; unrecorded code is rejected; saved report replays all modules.')
