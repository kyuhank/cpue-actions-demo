"""Registered branch selections are frozen, bounded and invalidate only downstream jobs."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cpue-selected-branch-') as directory:
    root = Path(directory)
    for name in ('pipeline', 'scripts', 'data'):
        shutil.copytree(ROOT / name, root / name)
    for name in ('modules.lock.json', 'module-versions.json', 'module-branches.json'):
        shutil.copyfile(ROOT / name, root / name)
    (root / 'config').mkdir()
    (root / 'config/stages.json').write_text('{}')
    env = {k: v for k, v in os.environ.items() if not k.startswith(('TOY_', 'GITHUB_'))}
    env.update(GITHUB_ACTIONS='false', TOY_DEMO_PACE_SECONDS='0')
    def call(*args):
        return subprocess.run([sys.executable, *args], cwd=root, env=env, check=True, capture_output=True, text=True)
    call('scripts/workflow_plan.py')
    before = json.loads((root / 'stages/_plan.json').read_text())
    for key in before['stages']:
        call('scripts/run_stage.py', key)
    shutil.move(root / 'stages', root / 'previous')
    selection = {'cpue_vessel': {'branch': 'model-a-dev', 'request': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}
    (root / 'config/modules.json').write_text(json.dumps(selection))
    call('scripts/resolve_modules.py')
    sources = json.loads((root / 'module-versions.json').read_text())
    expected_source = json.loads((root / 'module-branches.json').read_text())['cpue_vessel']['model-a-dev']
    assert sources['cpue_vessel']['commit'] == expected_source['commit']
    assert sources['cpue_vessel']['specification']['min_hooks'] == 2000
    call('scripts/workflow_plan.py', 'previous')
    changed = json.loads((root / 'stages/_plan.json').read_text())
    expected = {'cpue_summary', 'cpue_report', 'cpue_vessel', 'prepare_vessel', 'assessment_vessel_ref', 'assessment_vessel_high_m', 'synthesis', 'report'}
    assert {key for key, stage in changed['stages'].items() if stage['action'] == 'run'} == expected
    for key in changed['stages']:
        if key in expected: call('scripts/run_stage.py', key)
    assert (root/'stages/cpue_vessel/outputs/cpue.csv').read_bytes() != (root/'previous/cpue_vessel/outputs/cpue.csv').read_bytes()
    manifest = json.loads((root/'stages/report/outputs/manifest.json').read_text())
    assert manifest['stage_records']['cpue_vessel']['code_source']['commit'] == expected_source['commit']
    assert manifest['module_selection'] == selection
    # Same branch, new Run request: recalculate the selected stage without changing code identity.
    first_code = sources['cpue_vessel']['files']
    shutil.move(root/'stages', root/'previous-development')
    selection['cpue_vessel']['request'] = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    (root/'config/modules.json').write_text(json.dumps(selection))
    call('scripts/resolve_modules.py')
    assert json.loads((root/'module-versions.json').read_text())['cpue_vessel']['files'] == first_code
    call('scripts/workflow_plan.py', 'previous-development')
    repeated = json.loads((root/'stages/_plan.json').read_text())
    assert {k for k, v in repeated['stages'].items() if v['action'] == 'run'} == expected
    # Independently select a CPUE branch and an assessment branch on the other path.
    shutil.rmtree(root/'stages')
    multi={'cpue_vessel': {'branch':'model-a-dev','request':'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},
           'assessment_year_ref': {'branch':'structure-1-dev','request':'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}
    (root/'config/modules.json').write_text(json.dumps(multi))
    call('scripts/resolve_modules.py')
    call('scripts/workflow_plan.py','previous')
    combined=json.loads((root/'stages/_plan.json').read_text())
    assert {k for k,v in combined['stages'].items() if v['action']=='run'}==expected|{'assessment_year_ref'}
    assert combined['module_sources']['prepare_year']['branch']=='main'
    assert combined['module_sources']['assessment_year_ref']['branch']=='structure-1-dev'
    for key,stage in combined['stages'].items():
        if stage['action']=='run':call('scripts/run_stage.py',key)
    report=json.loads((root/'stages/report/outputs/manifest.json').read_text())
    assert report['module_selection']==multi
    # Caller-controlled commit/repository fields cannot replace registered sources.
    for invalid in [{'cpue_vessel': {'branch': 'arbitrary', 'request': selection['cpue_vessel']['request']}},
                    {'cpue_vessel': {**selection['cpue_vessel'], 'commit': 'a'*40}},
                    {'unknown': selection['cpue_vessel']}]:
        (root/'config/modules.json').write_text(json.dumps(invalid))
        r = subprocess.run([sys.executable, 'scripts/resolve_modules.py'], cwd=root, env=env, capture_output=True)
        assert r.returncode != 0
print('Selected development code changes CPUE results; only the affected analysis and reporting stages run. Repeated requests rerun the same fixed code. Unknown branches and source overrides are rejected.')
