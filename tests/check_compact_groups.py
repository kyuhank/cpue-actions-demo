"""Exercise the compact runner with actual calculations and shared group barriers."""
import json,os,shutil,subprocess,tempfile
from pathlib import Path
from datetime import datetime
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cpue-compact-') as tmp:
    work=Path(tmp)
    for name in ('pipeline','scripts','data'):
        shutil.copytree(root/name,work/name,ignore=shutil.ignore_patterns('__pycache__'))
    env={**os.environ,'TOY_DEMO_PACE_SECONDS':'0','WORKSHOP_GROUP_SECONDS':'0','GITHUB_ACTIONS':'false'}
    subprocess.run(['python3','scripts/workflow_plan.py'],cwd=work,env=env,check=True,stdout=subprocess.DEVNULL)
    for i in range(6):subprocess.run(['python3','scripts/run_group.py',str(i)],cwd=work,env=env,check=True,stdout=subprocess.DEVNULL)
    records={p.parent.name:json.loads(p.read_text()) for p in (work/'stages').glob('*/record.json')}
    assert len(records)==13
    for key,record in records.items():
        if key.startswith('prepare_'):
            assert record['started_at']>=max(records[k]['completed_at'] for k in ('cpue_vessel','cpue_year'))
        if key.startswith('assessment_'):
            assert record['started_at']>=max(records[k]['completed_at'] for k in ('prepare_vessel','prepare_year','cpue_summary'))
    for key in records:
        name='report.html' if key in ('report','cpue_report') else 'results.html'
        html=(work/'stages'/key/'outputs'/name).read_text()
        assert all(x in html for x in ('INPUT','THIS STEP','OUTPUT'))
print('13 actual analyses, group dependencies and readable output pages passed.')
