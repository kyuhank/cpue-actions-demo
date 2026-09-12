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
