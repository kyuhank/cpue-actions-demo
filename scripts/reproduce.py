"""Recalculate the saved report and verify its scientific outputs."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--native', action='store_true', help='Use native Python instead of the recorded container')
parser.add_argument('--in-container', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
os.chdir(ROOT)
for name, digest in json.loads((ROOT / 'SHA256SUMS.json').read_text()).items():
    path = ROOT / name
    if not path.resolve().is_relative_to(ROOT) or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit('File integrity check failed: ' + name)
manifest = json.loads((ROOT / 'provenance.json').read_text())
image = manifest.get('container_image', '')
has_image = bool(re.fullmatch(r'ghcr\.io/pacificcommunity/cpue-workshop@sha256:[0-9a-f]{64}', image))
if not args.native and not args.in_container and has_image:
    command = ['docker', 'run', '--rm', '--network', 'none', '-v', str(ROOT) + ':/work', '-w', '/work']
    if hasattr(os, 'getuid'):
        command += ['--user', f'{os.getuid()}:{os.getgid()}']
    command += [image, 'python', 'reproduce.py', '--in-container']
    raise SystemExit(subprocess.run(command).returncode)
if (ROOT / 'stages').exists() or (ROOT / 'outputs').exists():
    raise SystemExit('Extract the package to a fresh folder before replaying it.')
env = {k: v for k, v in os.environ.items() if not k.startswith(('TOY_', 'GITHUB_', 'GH_')) and k != 'DEBUG'}
env.update({'TOY_SOURCE_DATABASE': 'data/toy-fishery.sqlite', 'TOY_STAGE_CONFIG': 'config/stages.json',
            'TOY_CODE_COMMIT': manifest['git_commit'], 'TOY_DATA_COMMIT': manifest['configuration']['git_commit'],
            'TOY_DATA_REPOSITORY': manifest['configuration']['repository'],
            'TOY_SOURCE_PROVIDER': manifest.get('source_provider', 'github'),
            'TOY_SOURCE_VERSION': str(manifest.get('source_version', '')),
            'TOY_CONTAINER_IMAGE': image if args.in_container else 'none; native Python',
            'TOY_DEMO_PACE_SECONDS': '0', 'TOY_EXECUTION_MODE': 'parallel_steps',
            'GITHUB_ACTIONS': 'false', 'GITHUB_RUN_ID': 'local-replay', 'ImageVersion': 'local replay'})
if (ROOT / 'scripts/run_stage.py').exists():
    subprocess.run([sys.executable, 'scripts/workflow_plan.py'], env=env, check=True)
    pending = json.loads((ROOT / 'stages/_plan.json').read_text())['stages']
    complete = set()
    while len(complete) < len(pending):
        ready = [k for k, v in pending.items() if k not in complete and set(v['parents']) <= complete]
        if not ready:
            raise SystemExit('Unresolved dependencies in the saved workflow')
        def run(key):
            subprocess.run([sys.executable, 'scripts/run_stage.py', key], env=env, check=True)
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(run, ready))
        complete.update(ready)
    out = ROOT / 'stages/report/outputs'
else:
    subprocess.run([sys.executable, 'run.py'], env=env, check=True)
    out = ROOT / 'outputs'
for name, digest in manifest['reproduction']['reference_outputs'].items():
    if hashlib.sha256((out / name).read_bytes()).hexdigest() != digest:
        raise SystemExit('Recomputed output differs from the saved report: ' + name)
print(f'Verified {len(manifest["reproduction"]["reference_outputs"])} scientific output files against the saved report.')
print('Report:', out / 'report.html')
