"""Check group synchronisation, reused inputs and transfer validation."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
from unittest.mock import patch
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import stage_barrier as gate

assert {'cpue_vessel','cpue_year'} <= set(gate.predecessors('prepare_vessel'))
assert {'prepare_vessel','prepare_year','cpue_summary'} <= set(gate.predecessors('assessment_vessel_ref'))
assert 'cpue_report' in gate.predecessors('synthesis')
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)
 for key in gate.predecessors('prepare_vessel'):
  path=root/'stages'/key;path.mkdir(parents=True);(path/'record.json').write_text('{}')
 jobs=[{'name':'['+key+'] · reused','conclusion':'skipped'} for key in gate.predecessors('prepare_vessel')]
 pending=[dict(j) for j in jobs];pending[-1]['conclusion']=None
 env={'GITHUB_REPOSITORY':'kyuhank/cpue-toy-data','GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'2'}
 with patch.dict(os.environ,env),patch.object(gate,'request',side_effect=[json.dumps({'jobs':pending}).encode(),json.dumps({'jobs':jobs}).encode()]) as api,patch.object(gate.time,'sleep') as sleep:
  gate.wait_for_group('prepare_vessel',root);assert api.call_count==2 and sleep.call_count==1
 failed=[dict(j) for j in jobs];failed[-1]['conclusion']='failure'
 with patch.dict(os.environ,env),patch.object(gate,'request',return_value=json.dumps({'jobs':failed}).encode()):
  try:gate.wait_for_group('prepare_vessel',root)
  except RuntimeError:pass
  else:raise AssertionError('A failed sibling must block the next group')
 (root/'stages/cpue_year/record.json').unlink()
 with patch.dict(os.environ,env),patch.object(gate,'request',return_value=json.dumps({'jobs':jobs}).encode()):
  try:gate.wait_for_group('prepare_vessel',root)
  except RuntimeError:pass
  else:raise AssertionError('Reuse requires retained outputs')
 def bundle(entries):
  tar=io.BytesIO()
  with tarfile.open(fileobj=tar,mode='w:gz') as out:
   for name,content in entries.items():
    info=tarfile.TarInfo(name);info.size=len(content);out.addfile(info,io.BytesIO(content))
  zipped=io.BytesIO()
  with zipfile.ZipFile(zipped,'w') as out:out.writestr('stage-2-extract.tar.gz',tar.getvalue())
  content=zipped.getvalue();return content,{'digest':'sha256:'+hashlib.sha256(content).hexdigest()}
 data=b'checked records\n'
 entries={'stages/extract/outputs/data.csv':data,'stages/extract/record.json':json.dumps({'outputs':{'data.csv':hashlib.sha256(data).hexdigest()}}).encode()}
 content,artifact=bundle(entries);gate.restore(content,artifact,'extract','2',root)
 assert (root/'stages/extract/outputs/data.csv').read_bytes()==data
 for broken,meta in [(content,{'digest':'sha256:'+'0'*64}),bundle({'scripts/run_stage.py':b'bad'})]:
  try:gate.restore(broken,meta,'extract','2',root)
  except ValueError:pass
  else:raise AssertionError('Reject changed or misdirected artifacts')
print('Stage groups wait for siblings, fail closed and preserve verified reuse and transfers.')
