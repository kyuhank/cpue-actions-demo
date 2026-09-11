"""Exercise real partial rebuilds, unchanged outputs and scientific input checks."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cpue-incremental-') as folder:
    root = Path(folder)
    for name in ('pipeline', 'scripts', 'data'):
        shutil.copytree(ROOT / name, root / name)
    (root / 'config').mkdir()
    config = root / 'config/stages.json'
    config.write_text('{}')
    release = {'version': 2023, 'quality_check': {'accepted': True, 'errors': [], 'rule_version': 1,
        'rows_received': 198, 'rules_sha256': 'd'*64, 'checks': ['positive effort; zero catches retained']}}
    (root / 'data/toy-fishery.release.json').write_text(json.dumps(release))
    env = {**os.environ, 'TOY_CODE_COMMIT': 'a'*40, 'TOY_DATA_COMMIT': 'b'*40,
           'TOY_DATA_REPOSITORY': 'kyuhank/cpue-toy-data', 'TOY_SOURCE_PROVIDER': 'supabase',
           'TOY_SOURCE_VERSION': '2023', 'TOY_DEMO_PACE_SECONDS': '0', 'GITHUB_RUN_ID': '1'}
    def execute(previous=None):
        subprocess.run([sys.executable, 'scripts/workflow_plan.py', *([str(previous)] if previous else [])], cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
        plan = json.loads((root / 'stages/_plan.json').read_text())
        for key, record in plan['stages'].items():
            if record['action'] == 'run':
                subprocess.run([sys.executable, 'scripts/run_stage.py', key], cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
        return {k for k, v in plan['stages'].items() if v['action'] == 'run'}
    assert len(execute()) == 11
    baseline_plan=json.loads((root/'stages/_plan.json').read_text())
    assert baseline_plan['stages']['prepare_vessel']['parents']==['extract','cpue_vessel']
    assert baseline_plan['stages']['report']['parents']==['synthesis']
    first = root / 'first'; (root / 'stages').rename(first)
    config.write_text(json.dumps({'cpue_vessel': {'min_hooks': 2000}}))
    env['GITHUB_RUN_ID'] = '2'
    env['TOY_DATA_COMMIT'] = 'c'*40
    assert execute(first) == {'cpue_vessel', 'prepare_vessel', 'assessment_vessel_ref', 'assessment_vessel_high_m', 'synthesis', 'report'}
    for key in ('extract', 'cpue_year', 'prepare_year', 'assessment_year_ref', 'assessment_year_high_m'):
        for path in (first / key).rglob('*'):
            if path.is_file():
                assert path.read_bytes() == (root / 'stages' / path.relative_to(first)).read_bytes()
    assert (root / 'stages/cpue_vessel/outputs/cpue.csv').read_bytes() != (first / 'cpue_vessel/outputs/cpue.csv').read_bytes()
    out = root / 'stages/report/outputs'
    manifest = json.loads((out / 'manifest.json').read_text())
    assert manifest['source_version'] == '2023' and manifest['source_git_commit'] is None
    assert manifest['git_commit'] == 'a'*40 and manifest['configuration']['git_commit'] == 'c'*40
    assert manifest['configuration']['repository'] == 'kyuhank/cpue-toy-data'
    assert manifest['configuration']['stage_settings']['cpue_vessel'] == {'min_hooks': 2000}
    assert manifest['extraction_run_id'] == '1' and manifest['github_run_id'] == '2'
    assert hashlib.sha256((out / 'source.sqlite').read_bytes()).hexdigest() == manifest['source_sha256']
    assert manifest['data_release'] == release
    assert json.loads((out / 'source-release.json').read_text()) == release
    assert release['quality_check']['rules_sha256'] in (out / 'report.html').read_text()
    for name, checksum in manifest['extraction_queries'].items():
        assert (out / name).read_bytes() == (root / 'pipeline' / name).read_bytes()
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == checksum
    second = root / 'second'; (root / 'stages').rename(second)
    config.write_text(json.dumps({'cpue_vessel': {'min_hooks': 2000}, 'assessment_vessel_high_m': {'M': .35}}))
    env['GITHUB_RUN_ID'] = '3'
    assert execute(second) == {'assessment_vessel_high_m', 'synthesis', 'report'}
    assert '3 stages executed · 8 reused' in (root / 'stages/report/outputs/report.html').read_text()
    # Rerunning preparation retains extraction, both CPUE fits and the other branch.
    third = root / 'third'; (root / 'stages').rename(third)
    settings = json.loads(config.read_text()); settings['prepare_vessel'] = {'revision': 1}
    config.write_text(json.dumps(settings)); env['GITHUB_RUN_ID'] = '4'
    assert execute(third) == {'prepare_vessel', 'assessment_vessel_ref', 'assessment_vessel_high_m', 'synthesis', 'report'}
    for key in ('extract', 'cpue_vessel', 'cpue_year', 'prepare_year'):
        assert (root / 'stages' / key / 'record.json').read_bytes() == (third / key / 'record.json').read_bytes()
    fourth = root / 'fourth'; (root / 'stages').rename(fourth)
    settings['report'] = {'revision': 1}; config.write_text(json.dumps(settings)); env['GITHUB_RUN_ID'] = '5'
    assert execute(fourth) == {'report'}
    third = root / 'before-data-change'; (root / 'stages').rename(third)
    import sqlite3
    with sqlite3.connect(root / 'data/toy-fishery.sqlite') as db:
        db.execute('UPDATE sets SET catch_n=catch_n+1 WHERE rowid=1')
    assert len(execute(third)) == 11
print('Verified: CPUE 6 stages, assessment 3, data 11. Reused outputs are byte-identical; data release, code and current settings commits, original extraction run, SQL files and snapshot are preserved together.')
