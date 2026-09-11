"""Check and join the two CPUE job outputs before preparing assessment inputs."""
import csv
import hashlib
import json
from pathlib import Path
import shutil

parents = [('cpue_vessel', 'vessel_adjusted'), ('cpue_year', 'year_only')]
folders = [Path('inputs') / job for job, _ in parents]
if any(p.exists() for p in folders):
    if not all(p.is_dir() for p in folders):
        raise SystemExit('Both CPUE parents must be available before assessment')
    manifests = [json.loads((p / 'manifest.json').read_text()) for p in folders]
    same = ('source_sha256', 'query_sha256', 'source_git_commit', 'git_commit',
            'github_run_id', 'github_run_attempt', 'container_image', 'choices')
    if any(manifests[0].get(k) != manifests[1].get(k) for k in same):
        raise SystemExit('CPUE parents belong to different inputs, code, environment or run attempts')
    for filename in ('sets.csv', 'catch.csv'):
        if (folders[0] / filename).read_bytes() != (folders[1] / filename).read_bytes():
            raise SystemExit('CPUE parents do not share the same extraction')
    indices, diagnostics = [], []
    years = [r['year'] for r in csv.DictReader((folders[0] / 'catch.csv').open())]
    for (job, choice), folder, manifest in zip(parents, folders, manifests):
        rows = list(csv.DictReader((folder / 'cpue.csv').open()))
        digest = hashlib.sha256((folder / 'cpue.csv').read_bytes()).hexdigest()
        if (not rows or {r['choice'] for r in rows} != {choice}
                or [r['year'] for r in rows] != years
                or manifest['cpue_runs'][choice]['index_sha256'] != digest):
            raise SystemExit(f'Invalid CPUE input or checksum from {job}')
        indices.extend(rows)
        diagnostic = json.loads((folder / 'cpue-diagnostics.json').read_text())
        if [x['choice'] for x in diagnostic] != [choice]:
            raise SystemExit('Diagnostic does not match its CPUE parent')
        diagnostics.extend(diagnostic)
    out = Path('outputs')
    out.mkdir(exist_ok=True)
    for name in ('sets.csv', 'catch.csv', 'cpue-session.txt'):
        shutil.copyfile(folders[0] / name, out / name)
    with (out / 'cpue.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['year', 'index', 'choice'])
        writer.writeheader(); writer.writerows(indices)
    (out / 'cpue-diagnostics.json').write_text(json.dumps(diagnostics, indent=2) + '\n')
    (out / 'cpue-diagnostics.txt').write_text(''.join((p / 'cpue-diagnostics.txt').read_text() for p in folders))
    merged = manifests[0]
    merged['cpue_runs'] = {k: v for m in manifests for k, v in m['cpue_runs'].items()}
    merged['stage_compute_seconds'] = {k: v for m in manifests for k, v in m['stage_compute_seconds'].items()}
    merged['input_preparation'] = {'parents': [x[0] for x in parents],
        'checks': 'same extraction, code, environment and run attempt; matching years and CPUE checksums',
        'series': len(parents), 'rows': len(indices)}
    branch_out = out / 'cpue-branches'
    branch_out.mkdir(exist_ok=True)
    for (_, choice), folder in zip(parents, folders):
        shutil.copyfile(folder / 'cpue.csv', branch_out / (choice + '.csv'))
    (out / 'manifest.json').write_text(json.dumps(merged, indent=2) + '\n')
    print('INPUT PREPARATION complete: two verified CPUE parents; shared years and extraction')
