"""Release each presentation stage group only after its verified inputs are ready."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time
import zipfile

GROUPS = (
    ('extract',),
    ('cpue_vessel', 'cpue_year'),
    ('prepare_vessel', 'prepare_year', 'cpue_summary'),
    ('assessment_vessel_ref', 'assessment_vessel_high_m',
     'assessment_year_ref', 'assessment_year_high_m', 'cpue_report'),
    ('synthesis',),
    ('report',),
)


def predecessors(key):
    for i, group in enumerate(GROUPS):
        if key in group:
            return tuple(stage for earlier in GROUPS[:i] for stage in earlier)
    raise ValueError('Unknown workflow stage')


def request(path, env):
    result = subprocess.run(['gh', 'api', path], env=env, check=True,
                            capture_output=True, timeout=25)
    if len(result.stdout) > 16 * 1024 * 1024:
        raise ValueError('Artifact response too large')
    return result.stdout


def restore(content, artifact, key, attempt, root):
    digest = artifact.get('digest')
    if not digest or digest != 'sha256:' + hashlib.sha256(content).hexdigest():
        raise ValueError('Artifact digest does not match')
    filename = f'stage-{attempt}-{key}.tar.gz'
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if archive.namelist() != [filename]:
            raise ValueError('Unexpected artifact contents')
        if archive.getinfo(filename).file_size > 16 * 1024 * 1024:
            raise ValueError('Stage archive too large')
        packed = archive.read(filename)
    with tarfile.open(fileobj=io.BytesIO(packed), mode='r:gz') as archive:
        members = archive.getmembers()
        for member in members:
            path = Path(member.name)
            if (not path.parts or path.parts[:2] != ('stages', key)
                    or '..' in path.parts or not (member.isfile() or member.isdir())):
                raise ValueError('Artifact escapes its stage directory')
        if sum(m.size for m in members) > 32 * 1024 * 1024:
            raise ValueError('Expanded stage archive too large')
        archive.extractall(root, members=members, filter='data')
    record = json.loads((root / 'stages' / key / 'record.json').read_text())
    from workflow_plan import hashes
    if record['outputs'] != hashes(root / 'stages' / key / 'outputs'):
        raise ValueError('Parent output checksum does not match')


def wait_for_group(key, root=Path('.'), timeout=180, interval=1):
    env = {k: v for k, v in os.environ.items() if k not in ('GH_DEBUG', 'DEBUG')}
    repo, run, attempt = (env.get(k, '') for k in
                          ('GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
    if repo not in ('kyuhank/cpue-toy-data', 'kyuhank/cpue-actions-demo') or not run.isdigit() or not attempt.isdigit():
        raise ValueError('Unknown workflow execution')
    required = predecessors(key)
    if not required:
        return
    deadline = time.monotonic() + timeout
    route = f'repos/{repo}/actions/runs/{run}'
    print('WAIT: previous stage groups must complete; unchanged outputs stay reusable', flush=True)
    while True:
        jobs = json.loads(request(route + f'/attempts/{attempt}/jobs?per_page=100', env))['jobs']
        pending, fresh = [], []
        for stage in required:
            job = next((j for j in jobs if '[' + stage + ']' in j.get('name', '')), None)
            if job and job.get('conclusion') in ('failure', 'cancelled', 'timed_out', 'action_required'):
                raise RuntimeError('Previous stage failed: ' + stage)
            if job and job.get('conclusion') == 'skipped':
                if '· reused' not in job['name'] or not (root / 'stages' / stage / 'record.json').is_file():
                    raise RuntimeError('Verified reusable input unavailable: ' + stage)
            elif job and job.get('conclusion') == 'success':
                fresh.append(stage)
            else:
                pending.append(stage)
        if not pending:
            break
        if time.monotonic() >= deadline:
            raise TimeoutError('Previous stage group did not finish: ' + ', '.join(pending))
        time.sleep(interval)
    # Wait for every sibling, but transfer only the files this job consumes.
    # The final report also archives the complete execution record.
    from workflow_plan import PARENTS
    needed = set(required if key == 'report' else PARENTS[key])
    fresh = [stage for stage in fresh if stage in needed]
    if fresh:
        artifacts = json.loads(request(route + '/artifacts?per_page=100', env))['artifacts']
        def download(stage):
            name = f'stage-{attempt}-{stage}'
            artifact = next((a for a in artifacts if a['name'] == name and not a['expired']), None)
            if not artifact:
                raise RuntimeError('Completed stage artifact unavailable: ' + stage)
            content = request(f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip', env)
            restore(content, artifact, stage, attempt, root)
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(download, fresh))
    print('READY: previous group complete; verified inputs available for ' + key, flush=True)
