"""Verify all assessment cases and collect their outputs for comparison."""
import copy
import csv
import hashlib
import json
from pathlib import Path
import shutil
import sys
import os
sys.path.insert(0, str(Path(__file__).resolve().parent))
from settings import assessment_cases

cases = assessment_cases()
folders = [Path('inputs') / case['key'] for case in cases]
if any(folder.exists() for folder in folders):
    if not all(folder.is_dir() for folder in folders):
        raise SystemExit('Every expected assessment case must finish before reporting')
    manifests = [json.loads((folder / 'manifest.json').read_text()) for folder in folders]
    same = ('source_sha256', 'query_sha256', 'source_git_commit', 'git_commit',
            'github_run_id', 'github_run_attempt', 'container_image', 'choices')
    if any(any(m.get(key) != manifests[0].get(key) for key in same) for m in manifests[1:]):
        raise SystemExit('Assessment parents use different snapshots, code, environments or attempts')
    selected, summary, biomass = {}, [], []
    for case, folder, manifest in zip(cases, folders, manifests):
        choice, key = case['choice'], case['key']
        if (folder / 'catch.csv').read_bytes() != (folders[0] / 'catch.csv').read_bytes():
            raise SystemExit('Assessment parents have different catches')
        for filename, record_key in [('cpue.csv', 'index_sha256'), ('assessment-input.csv', 'output_sha256')]:
            record = manifest['cpue_runs'][choice] if filename == 'cpue.csv' else manifest['input_preparation']
            if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != record[record_key]:
                raise SystemExit('A parent CPUE or prepared input checksum has changed')
        record = manifest['assessment_runs'][key]
        for filename in ('summary.csv', 'biomass.csv'):
            if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != record[filename + '_sha256']:
                raise SystemExit('Assessment output checksum has changed')
        result = list(csv.DictReader((folder / 'summary.csv').open()))
        trajectory = list(csv.DictReader((folder / 'biomass.csv').open()))
        if (len(result) != 1 or result[0]['scenario'] != key or result[0]['choice'] != choice
                or float(result[0]['M']) != case['M'] or not trajectory
                or {row['scenario'] for row in trajectory} != {key}):
            raise SystemExit('Assessment output does not match its declared case')
        if choice in selected:
            for filename in ('sets.csv', 'cpue.csv', 'assessment-input.csv', 'cpue-diagnostics.json'):
                if (selected[choice] / filename).read_bytes() != (folder / filename).read_bytes():
                    raise SystemExit('Sensitivity cases did not use the same prepared input')
        else:
            selected[choice] = folder
        summary.extend(result); biomass.extend(trajectory)
    out = Path('outputs'); out.mkdir(exist_ok=True)
    for name in ('sets.csv', 'catch.csv', 'cpue-session.txt', 'assessment-session.txt'):
        shutil.copyfile(folders[0] / name, out / name)
    for name in ('extract.sql', 'extract-catch.sql', 'source.sqlite', 'source-release.json'):
        if (folders[0] / name).exists():
            shutil.copyfile(folders[0] / name, out / name)
    def write(name, rows):
        with (out / name).open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader(); writer.writerows(rows)
    write('summary.csv', summary); write('biomass.csv', biomass)
    for name in ('cpue.csv', 'assessment-input.csv'):
        write(name, [row for folder in selected.values() for row in csv.DictReader((folder / name).open())])
    diagnostics = [row for folder in selected.values() for row in json.loads((folder / 'cpue-diagnostics.json').read_text())]
    (out / 'cpue-diagnostics.json').write_text(json.dumps(diagnostics, indent=2) + '\n')
    (out / 'cpue-diagnostics.txt').write_text(''.join((folder / 'cpue-diagnostics.txt').read_text() for folder in selected.values()))
    merged = copy.deepcopy(manifests[0])
    plan_path = Path(__file__).resolve().parents[1] / 'stages/_plan.json'
    if plan_path.exists():
        merged['workflow_plan'] = json.loads(plan_path.read_text())
        merged['extraction_run_id'] = merged['github_run_id']
        merged['github_run_id'] = os.getenv('GITHUB_RUN_ID', 'local')
        merged['github_run_attempt'] = os.getenv('GITHUB_RUN_ATTEMPT', '1')
    for field in ('cpue_runs', 'assessment_runs', 'stage_compute_seconds'):
        merged[field] = {key: value for manifest in manifests for key, value in manifest[field].items()}
    merged['input_preparations'] = {case['choice']: manifest['input_preparation'] for case, manifest in zip(cases, manifests)}
    merged['collection'] = {'expected_cases': [case['key'] for case in cases],
        'checks': 'complete case set; consistent data/code/environment/attempt; input and output checksums; matching prepared inputs within each CPUE branch'}
    branch_out = out / 'parent-inputs'; branch_out.mkdir(exist_ok=True)
    for choice, folder in selected.items():
        for filename in ('cpue.csv', 'assessment-input.csv'):
            shutil.copyfile(folder / filename, branch_out / (choice + '-' + filename))
    (out / 'manifest.json').write_text(json.dumps(merged, indent=2) + '\n')
    print('COLLECTION complete: four verified assessment cases; two CPUE branches and prepared inputs')
