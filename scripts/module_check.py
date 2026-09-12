"""Check a module's output contract and repeatability with fixed synthetic inputs."""
import csv, hashlib, json, math, os
from pathlib import Path
import shutil, subprocess, sys, tempfile
import xml.etree.ElementTree as ET
from resolve_modules import FILES, REPOS
from workflow_plan import unpack
ROOT=Path(__file__).resolve().parents[1]
CANDIDATE=Path(sys.argv[1]).resolve()
repo=os.environ['MODULE_REPOSITORY'];commit=os.environ['MODULE_COMMIT']
assert repo in {'kyuhank/cpue-demo-'+x for x in REPOS.values()}
assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
kind=repo.removeprefix('kyuhank/cpue-demo-')
spec=json.loads((CANDIDATE/'model.json').read_text()) if (CANDIDATE/'model.json').exists() else {}
keys=[k for k in FILES if REPOS[k.split('_')[0]]==kind]
if kind=='cpue' and spec.get('choice'):keys=[k for k in keys if k==('cpue_vessel' if spec['choice']=='vessel_adjusted' else 'cpue_year')]
contracts={'extract':{'sets.csv':{'set_id','year','hooks','catch_n'},'catch.csv':{'year','catch_t'}},'cpue':{'cpue.csv':{'year','index'}},'inputs':{'assessment-input.csv':{'year'}},'assessment':{'biomass.csv':{'year'},'summary.csv':set()},'synthesis':{'cpue.csv':{'year'},'biomass.csv':{'year'},'summary.csv':set()},'report':{'cpue.csv':{'year'},'biomass.csv':{'year'},'summary.csv':set()}}
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
results={}
with tempfile.TemporaryDirectory(prefix='module-check-') as temporary:
 base=Path(temporary)
 for key in keys:
  repetitions=[]
  for attempt in (1,2):
   work=base/f'{key}-{attempt}';work.mkdir()
   for name in ('pipeline','scripts','data'):shutil.copytree(ROOT/name,work/name,ignore=shutil.ignore_patterns('__pycache__'))
   for name in ('modules.lock.json','module-branches.json','module-versions.json'):shutil.copyfile(ROOT/name,work/name)
   versions=json.loads((work/'module-versions.json').read_text())
   paths={}
   for source,target in FILES[key].items():
    shutil.copyfile(CANDIDATE/source,work/'pipeline'/target);paths['pipeline/'+target]=digest(work/'pipeline'/target)
   versions[key]={**versions[key],'repository':repo,'commit':commit,'files':paths,'specification':spec}
   (work/'module-versions.json').write_text(json.dumps(versions))
   (work/'config').mkdir();(work/'config/stages.json').write_text('{}')
   unpack((ROOT/'baseline/workflow.zip').read_bytes(),work/'stages')
   (work/'stages/_plan.json').unlink(missing_ok=True);shutil.rmtree(work/'stages'/key,ignore_errors=True)
   env={**os.environ,'TOY_DEMO_PACE_SECONDS':'0','TOY_CODE_COMMIT':commit,'GITHUB_ACTIONS':'false'}
   subprocess.run([sys.executable,'scripts/run_stage.py',key],cwd=work,env=env,check=True,stdout=subprocess.DEVNULL)
   output=work/'stages'/key/'outputs';hashes={}
   for name,required in contracts[kind].items():
    with (output/name).open() as f:
     reader=csv.DictReader(f);assert required<=set(reader.fieldnames or []),(key,name,'columns');rows=list(reader)
    assert rows,(key,name,'empty output')
    for row in rows:
     for field,value in row.items():
      if value is None:raise AssertionError('Missing CSV field')
      try:number=float(value)
      except ValueError:continue
      assert math.isfinite(number),(key,name,field,'non-finite value')
    hashes[name]=digest(output/name)
   for name in ('cpue.svg','biomass.svg') if kind in ('synthesis','report') else ():
    ET.parse(output/name);hashes[name]=digest(output/name)
   if kind=='report':
    html=(output/'report.html').read_text();assert 'reproduction.zip' in html and 'provenance.json' in html
   repetitions.append(hashes)
  assert repetitions[0]==repetitions[1],(key,'Results differ between clean runs')
  results[key]=repetitions[0];print('REPRODUCIBILITY:',key,'output contract passed; two clean runs match',flush=True)
record={'repository':repo,'commit':commit,'data_sha256':digest(ROOT/'data/toy-fishery.sqlite'),'container':os.environ['TOY_CONTAINER_IMAGE'],'checks':['output contract','finite numerical outputs','two clean runs agree'],'stages':results}
(ROOT/'module-check.json').write_text(json.dumps(record,indent=2)+'\n')
