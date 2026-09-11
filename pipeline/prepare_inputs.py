"""Turn a recorded CPUE output and catches into a checked assessment input."""
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import time

started = time.perf_counter()
out = Path('outputs')
manifest = json.loads((out / 'manifest.json').read_text())
if hashlib.sha256((out / 'catch.csv').read_bytes()).hexdigest() != manifest['extraction_outputs']['catch.csv']:
    raise SystemExit('Annual catches differ from the recorded extraction')
indices = list(csv.DictReader((out / 'cpue.csv').open()))
removals = list(csv.DictReader((out / 'catch.csv').open()))
catch = {row['year']: row['catch_t'] for row in removals}
choices = list(dict.fromkeys(row['choice'] for row in indices))
requested = os.getenv('TOY_CPUE_CHOICE', '')
if not choices or len(catch) != len(removals) or (requested and choices != [requested]):
    raise SystemExit('Unexpected CPUE choice or duplicated catch years')
digest = hashlib.sha256((out / 'cpue.csv').read_bytes()).hexdigest()
prepared = []
for choice in choices:
    rows = [row for row in indices if row['choice'] == choice]
    if (len(rows) != len(catch) or {r['year'] for r in rows} != set(catch)
            or len({r['year'] for r in rows}) != len(rows)
            or manifest['cpue_runs'][choice]['index_sha256'] != digest):
        raise SystemExit('CPUE checksum, coverage or unique-year check failed')
    for row in sorted(rows, key=lambda r: int(r['year'])):
        index, removal = float(row['index']), float(catch[row['year']])
        if not math.isfinite(index + removal) or index <= 0 or removal < 0:
            raise SystemExit('Invalid index or removal in assessment input')
        prepared.append({**row, 'catch_t': catch[row['year']]})
with (out / 'assessment-input.csv').open('w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['year', 'choice', 'index', 'catch_t'])
    writer.writeheader(); writer.writerows(prepared)
job = os.getenv('GITHUB_JOB', {'vessel_adjusted':'prepare_vessel','year_only':'prepare_year'}.get(requested,'prepare'))
manifest['input_preparation'] = {'job': job, 'parents': manifest['cpue_runs'],
    'output_sha256': hashlib.sha256((out / 'assessment-input.csv').read_bytes()).hexdigest(),
    'checks': 'CPUE checksum; unique and matching years; positive index; nonnegative removals',
    'mapping': 'annual CPUE joined to removals by year; one toy area; index relative to first year; removals in tonnes',
    'series': len(choices), 'rows': len(prepared)}
manifest.setdefault('stage_compute_seconds', {})[job] = time.perf_counter() - started
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'INPUT PREPARATION complete: {len(choices)} CPUE series joined to annual catches; checks and mapping recorded')
