"""Verify that incorrect effort returns the submission and stops loading."""
import copy,importlib.util,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('intake',root/'scripts/data_intake.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
batch=json.loads((root/'supabase/functions/workshop-api/batches.json').read_text())['2024']
assert m.check(batch)['accepted']
invalid=copy.deepcopy(batch);invalid['sets'][0][3]=0
qc=m.check(invalid)
assert not qc['accepted'] and qc['errors'][0]['field']=='hooks'
assert qc['errors'][0]['examples'][0]['set_id']==invalid['sets'][0][0]
invalid['sets'][0][3]=batch['sets'][0][3]
assert m.check(invalid)['accepted']
print('QC: failed effort has a record-level correction; corrected submission passes.')

# Exercise the real one-time correction, preserving the original rejected receipt.
import os,sys,tempfile,shutil
from unittest.mock import patch
with tempfile.TemporaryDirectory() as folder:
    work=Path(folder);shutil.copytree(root/'pipeline',work/'pipeline');(work/'supabase/functions/workshop-api').mkdir(parents=True)
    (work/'supabase/functions/workshop-api/batches.json').write_text(json.dumps({'2024':batch}))
    with patch.object(m,'ROOT',work),patch.dict(os.environ,{'WORKSHOP_INTAKE_MODE':'invalid'}),patch.object(m.time,'sleep'):
        def run(key):
            with patch.object(sys,'argv',['data_intake.py',key]):m.main()
        run('submission')
        try:run('qc')
        except SystemExit as e:assert e.code==1
        else:raise AssertionError('Invalid submission did not fail')
        original=(work/'stages/submission/record.json').read_bytes()
        run('resubmit');run('qc')
        out=work/'stages/qc/outputs'
        assert json.loads((out/'quality.json').read_text())['accepted']
        assert not json.loads((out/'first-quality.json').read_text())['accepted']
        assert json.loads((out/'accepted-submission.json').read_text())==batch
        assert json.loads((out/'correction.json').read_text())['attempt']==2
        assert (work/'stages/submission/record.json').read_bytes()==original
        # It is not a retry loop: a second correction must be rejected.
        try:run('resubmit')
        except SystemExit:pass
        else:raise AssertionError('A second correction was permitted')
print('One automatic correction passes QC; rejected input, reason and corrected checksum remain traceable.')
