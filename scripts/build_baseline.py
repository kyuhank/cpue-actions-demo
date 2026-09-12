"""Calculate the fixed synthetic starting point in the pinned runtime container."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'ghcr.io/pacificcommunity/cpue-workshop@sha256:17b03d6e06da229b17524997d8a3fc8eb5f8f25233894b5ab99f89109b3890c5'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('snapshot', type=Path)
args = parser.parse_args()
snapshot = json.loads(args.snapshot.read_text())
assert snapshot['version'] == 2023
subprocess.run(['git','diff','--exit-code','HEAD','--','pipeline','scripts'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
commit = subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip()
spec = importlib.util.spec_from_file_location('snapshot', ROOT / 'supabase/snapshot.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='cpue-baseline-') as folder:
    work = Path(folder)
    for name in ('pipeline','scripts'):
        shutil.copytree(ROOT/name, work/name, ignore=shutil.ignore_patterns('__pycache__'))
    (work/'config').mkdir(); (work/'config/stages.json').write_text('{}')
    snapshot_hash = module.materialise(snapshot, work/'data/toy-fishery.sqlite')
    command = ['docker','run','--rm','--network','none','--user',f'{os.getuid()}:{os.getgid()}',
               '-v',f'{work}:/work','-w','/work']
    for name,value in {'TOY_CODE_COMMIT':commit,'TOY_CONTAINER_IMAGE':IMAGE,
                       'TOY_SOURCE_PROVIDER':'supabase','TOY_SOURCE_VERSION':'2023',
                       'TOY_DATA_REPOSITORY':'kyuhank/cpue-toy-data','TOY_DATA_COMMIT':'baseline',
                       'GITHUB_RUN_ID':'baseline-2023','ImageVersion':'pinned container',
                       'TOY_DEMO_PACE_SECONDS':'0'}.items():
        command += ['-e',name+'='+value]
    code = "import subprocess,sys;sys.path.insert(0,'scripts');from workflow_plan import plan;[subprocess.run([sys.executable,'scripts/run_stage.py',key],check=True) for key in plan()['stages']]"
    subprocess.run(command+[IMAGE,'python','-c',code], check=True)
    target = ROOT/'baseline'; target.mkdir(exist_ok=True)
    with zipfile.ZipFile(target/'workflow.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for stage in sorted((work/'stages').iterdir()):
            if not stage.is_dir() or stage.name == 'report': continue
            for path in sorted(stage.rglob('*')):
                if path.is_file() and (path.name=='record.json' or path.is_relative_to(stage/'outputs')):
                    archive.write(path,path.relative_to(work/'stages'))
    metadata = {'description':'Fixed synthetic results; retained when visitor runs expire.',
                'version':2023,'code_commit':commit,'container':IMAGE,'snapshot_sha256':snapshot_hash,
                'sha256':hashlib.sha256((target/'workflow.zip').read_bytes()).hexdigest()}
    (target/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print('Baseline archive:', (target/'workflow.zip').stat().st_size, 'bytes')
