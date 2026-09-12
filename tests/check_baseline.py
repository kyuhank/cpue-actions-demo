"""Fresh intermediate starts use real baseline outputs and preserve their origins."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cpue-baseline-check-') as folder:
    root=Path(folder)
    for name in ('pipeline','scripts','baseline'):
        shutil.copytree(ROOT/name,root/name)
    for name in ('modules.lock.json','module-versions.json'):
        if (ROOT/name).exists():shutil.copyfile(ROOT/name,root/name)
    (root/'config').mkdir();(root/'data').mkdir()
    with zipfile.ZipFile(root/'baseline/workflow.zip') as archive:
        (root/'data/toy-fishery.sqlite').write_bytes(archive.read('extract/outputs/source.sqlite'))
    metadata=json.loads((root/'baseline/manifest.json').read_text())
    env={**os.environ,'TOY_CONTAINER_IMAGE':metadata['container'],'GITHUB_ACTIONS':'false',
         'TOY_CODE_COMMIT':'b'*40,'TOY_DEMO_PACE_SECONDS':'.3','GITHUB_RUN_ID':'new-run'}
    config=root/'config/stages.json'
    def plan(settings):
        shutil.rmtree(root/'stages',ignore_errors=True);config.write_text(json.dumps(settings))
        subprocess.run([sys.executable,'scripts/workflow_plan.py'],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
        return json.loads((root/'stages/_plan.json').read_text())
    p=plan({'prepare_vessel':{'revision':1}})
    changed={k for k,v in p['stages'].items() if v['action']=='run'}
    assert changed=={'prepare_vessel','assessment_vessel_ref','assessment_vessel_high_m','synthesis','report'}
    assert all(v['origin_run']=='baseline-2023' for v in p['stages'].values() if v['action']=='reuse')
    def run(key):subprocess.run([sys.executable,'scripts/run_stage.py',key],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
    run('prepare_vessel')
    with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(run,['assessment_vessel_ref','assessment_vessel_high_m']))
    records=[json.loads((root/'stages'/k/'record.json').read_text()) for k in ('assessment_vessel_ref','assessment_vessel_high_m')]
    assert max(datetime.fromisoformat(r['started_at']) for r in records)<min(datetime.fromisoformat(r['completed_at']) for r in records)
    run('synthesis');run('report')
    report=json.loads((root/'stages/report/outputs/manifest.json').read_text())
    assert report['github_run_id']=='new-run' and report['extraction_run_id']=='baseline-2023'
    assert report['git_commit']=='b'*40 and report['extraction_code_commit']==metadata['code_commit']
    p=plan({'cpue_vessel':{'min_hooks':2000}})
    assert sum(v['action']=='run' for v in p['stages'].values())==8
    p=plan({'cpue_summary':{'revision':1}})
    assert {k for k,v in p['stages'].items() if v['action']=='run'}=={'cpue_summary','cpue_report'}
    assert p['stages']['report']['origin_run']=='baseline-2023'
    p=plan({'cpue_report':{'revision':1}})
    assert {k for k,v in p['stages'].items() if v['action']=='run'}=={'cpue_report'}
    with (root/'pipeline/settings.py').open('a') as f:f.write('\n# Changed shared calculation code\n')
    p=plan({})
    assert all(v['action']=='run' for v in p['stages'].values())
print('Fresh starts: input preparation 5 run / 8 baseline; CPUE 8 / 5. Parallel assessments overlap; changed calculation code invalidates reuse.')
