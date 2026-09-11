"""Reuse verified stage outputs only when code, data, settings and parents match."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from settings import assessment_cases, stage_settings

PARENTS = {'extract': [], 'cpue_vessel': ['extract'], 'cpue_year': ['extract'],
           'prepare_vessel': ['cpue_vessel'], 'prepare_year': ['cpue_year'],
           **{c['key']: ['prepare_vessel' if c['choice'] == 'vessel_adjusted' else 'prepare_year'] for c in assessment_cases(False)},
           'report': [c['key'] for c in assessment_cases(False)]}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hashes(folder):
    return {str(p.relative_to(folder)): digest(p.read_bytes()) for p in sorted(folder.rglob('*')) if p.is_file()}


def fingerprints():
    config = stage_settings()
    source = ROOT / os.getenv('TOY_SOURCE_DATABASE', 'data/toy-fishery.sqlite')
    code = os.getenv('TOY_CODE_COMMIT') or digest(b''.join(p.read_bytes() for folder in ('scripts', 'pipeline') for p in sorted((ROOT / folder).glob('*.py'))))
    result = {}
    for key, parents in PARENTS.items():
        inputs = {'code': code, 'image': os.getenv('TOY_CONTAINER_IMAGE', 'local'),
                  'settings': config.get(key, {}), 'parents': {p: result[p] for p in parents}}
        if key == 'extract':
            inputs['source'] = digest(source.read_bytes())
        result[key] = digest(json.dumps(inputs, sort_keys=True).encode())
    return result


def gh(endpoint):
    result = subprocess.run(['gh', 'api', endpoint], capture_output=True, timeout=25,
                            env={k: v for k, v in os.environ.items() if k not in ('GH_DEBUG', 'DEBUG')})
    if result.returncode or len(result.stdout) > 16 * 1024 * 1024:
        raise RuntimeError('Previous workflow outputs unavailable')
    return result.stdout


def download_previous(target):
    repo = os.getenv('GITHUB_REPOSITORY', '')
    if repo not in ('kyuhank/cpue-toy-data', 'kyuhank/cpue-actions-demo'):
        return
    workflow = 'update.yml' if repo.endswith('cpue-toy-data') else 'toy-pipeline.yml'
    runs = json.loads(gh(f'repos/{repo}/actions/workflows/{workflow}/runs?status=success&branch=main&per_page=1'))['workflow_runs']
    if not runs:
        return
    run = runs[0]
    artifacts = json.loads(gh(f'repos/{repo}/actions/runs/{run["id"]}/artifacts'))['artifacts']
    artifact = next((a for a in artifacts if a['name'] == f'workflow-{run["run_attempt"]}' and not a['expired']), None)
    if artifact is None:
        return
    content = gh(f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip')
    if artifact.get('digest') != 'sha256:' + digest(content):
        raise ValueError('Previous artifact digest does not match')
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        members = archive.infolist()
        if len(members) > 500 or sum(m.file_size for m in members) > 32 * 1024 * 1024:
            raise ValueError('Previous artifact exceeds workshop size limits')
        names = set()
        for member in members:
            path = PurePosixPath(member.filename)
            mode = member.external_attr >> 16
            if path.is_absolute() or '..' in path.parts or '\\' in member.filename or member.filename in names or stat.S_ISLNK(mode):
                raise ValueError('Unsafe previous artifact path')
            names.add(member.filename)
        archive.extractall(target)


def plan(previous=None):
    fingerprints_now = fingerprints()
    previous = Path(previous) if previous else ROOT / '.previous-workflow'
    if not previous.exists() and os.getenv('GITHUB_ACTIONS') == 'true':
        try:
            download_previous(previous)
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            print('No verified reusable artifact; rebuilding the complete chain.')
            shutil.rmtree(previous, ignore_errors=True)
    stages = ROOT / 'stages'
    stages.mkdir(exist_ok=True)
    records = {}
    for key in PARENTS:
        source = previous / key
        record_path = source / 'record.json'
        record = json.loads(record_path.read_text()) if record_path.exists() else {}
        reuse = (key != 'report' and record.get('fingerprint') == fingerprints_now[key]
                 and bool(record.get('outputs')) and record['outputs'] == hashes(source / 'outputs'))
        if reuse:
            shutil.copytree(source, stages / key)
        records[key] = {'action': 'reuse' if reuse else 'run', 'fingerprint': fingerprints_now[key],
                        'parents': PARENTS[key], 'settings': stage_settings().get(key, {}),
                        'origin_run': record.get('run_id') if reuse else os.getenv('GITHUB_RUN_ID', 'local')}
    value = {'run_id': os.getenv('GITHUB_RUN_ID', 'local'), 'trigger_commit': os.getenv('TOY_DATA_COMMIT', 'local'), 'stages': records}
    (stages / '_plan.json').write_text(json.dumps(value, indent=2) + '\n')
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            f.writelines(f'{k}={r["action"]}\n' for k, r in records.items())
    print('WORKFLOW PLAN: ' + ', '.join(f'{k}={r["action"]}' for k, r in records.items()))
    return value


if __name__ == '__main__':
    plan(sys.argv[1] if len(sys.argv) > 1 else None)
