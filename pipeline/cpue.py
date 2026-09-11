"""Fit the two toy Poisson models using categorical iterative proportional fitting."""
import csv
import json
import math
import hashlib
import os
from pathlib import Path
import platform
import time
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from settings import stage_settings

started = time.perf_counter()

OUT = Path('outputs')
extraction_record = json.loads((OUT / 'manifest.json').read_text())
if hashlib.sha256((OUT / 'sets.csv').read_bytes()).hexdigest() != extraction_record['extraction_outputs']['sets.csv']:
    raise SystemExit('Extracted CPUE records differ from their recorded checksum')
choice_requested = os.getenv('TOY_CPUE_CHOICE', '')
if choice_requested not in ('', 'vessel_adjusted', 'year_only'):
    raise SystemExit('Unknown CPUE choice')
rows = list(csv.DictReader((OUT / 'sets.csv').open()))
minimum = stage_settings().get({'vessel_adjusted': 'cpue_vessel', 'year_only': 'cpue_year'}.get(choice_requested, ''), {}).get('min_hooks', 0)
input_count = len(rows)
rows = [row for row in rows if float(row['hooks']) >= minimum]
years = sorted({int(r['year']) for r in rows})
vessels = sorted({r['vessel'] for r in rows})
exposure = {(y, v): 0.0 for y in years for v in vessels}
catches = {(y, v): 0.0 for y in years for v in vessels}
for r in rows:
    key = (int(r['year']), r['vessel'])
    effort, count = float(r['hooks']) / 1000, float(r['catch_n'])
    if not math.isfinite(effort + count) or effort <= 0 or count < 0:
        raise SystemExit('Invalid CPUE observation')
    exposure[key] += effort
    catches[key] += count
cy = {y: sum(catches[y, v] for v in vessels) for y in years}
cv = {v: sum(catches[y, v] for y in years) for v in vessels}
if not years or any(x <= 0 for x in [*cy.values(), *cv.values()]):
    raise SystemExit('This toy fit requires positive catch in each year and vessel group')
nominal = {y: cy[y] / sum(exposure[y, v] for v in vessels) for y in years}
a, b = dict(nominal), {v: 1.0 for v in vessels}
# With log(mu_yv) = log(effort_yv) + log(a_y) + log(b_v), these
# alternating updates solve the Poisson likelihood score equations.
for iteration in range(10000 if choice_requested != 'year_only' else 1):
    if choice_requested == 'year_only':
        break
    previous = dict(a)
    a = {y: cy[y] / sum(exposure[y, v] * b[v] for v in vessels) for y in years}
    b = {v: cv[v] / sum(exposure[y, v] * a[y] for y in years) for v in vessels}
    scale = b[vessels[0]]
    a = {y: x * scale for y, x in a.items()}
    b = {v: x / scale for v, x in b.items()}
    if max(abs(math.log(a[y] / previous[y])) for y in years) < 1e-12:
        break
else:
    raise SystemExit('CPUE fit did not converge')
score_error = max(abs(sum(exposure[y, v] * a[y] * b[v] for v in vessels) / cy[y] - 1) for y in years)
if score_error > 1e-9:
    raise SystemExit('Poisson score check failed')
# Equal vessel prediction weights multiply every year by the same mean(b),
# which cancels when scaling both indices to their respective first year.
with (OUT / 'cpue.csv').open('w', newline='') as f:
    w = csv.writer(f); w.writerow(['year', 'index', 'choice'])
    for choice, index in [('vessel_adjusted', a), ('year_only', nominal)]:
        if choice_requested and choice != choice_requested:
            continue
        w.writerows((y, index[y] / index[years[0]], choice) for y in years)
(OUT / 'cpue-diagnostics.txt').write_text(
    (f'Poisson year + vessel: {iteration + 1} IPF iterations; maximum relative year score residual {score_error:.3g}\n'
     + 'Vessel multipliers: ' + json.dumps(b) + '\n' if choice_requested != 'year_only' else '')
    + ('Poisson year only: analytic group means.\n' if choice_requested != 'vessel_adjusted' else '')
    + 'Equal vessel weights; zero catches retained.\n')
(OUT / 'cpue-session.txt').write_text(f'Python {platform.python_version()}; standard library only\n')
print(f'CPUE complete: {choice_requested or "both recorded choices"}')

diagnostics = []
for choice, effects, weights, count in [('vessel_adjusted', a, b, len(years) + len(vessels) - 1), ('year_only', nominal, {v: 1 for v in vessels}, len(years))]:
    if choice_requested and choice != choice_requested:
        continue
    deviance, pearson = 0.0, 0.0
    for row in rows:
        observed = float(row['catch_n'])
        mu = float(row['hooks']) / 1000 * effects[int(row['year'])] * weights[row['vessel']]
        deviance += 2 * ((observed * math.log(observed / mu) if observed else 0) - observed + mu)
        pearson += (observed - mu) ** 2 / mu
    diagnostics.append({'choice': choice, 'parameters': count, 'deviance': deviance, 'pearson_dispersion': pearson / (len(rows) - count)})
(OUT / 'cpue-diagnostics.json').write_text(json.dumps(diagnostics, indent=2) + '\n')
manifest = json.loads((OUT / 'manifest.json').read_text())
job_key = {'vessel_adjusted': 'cpue_vessel', 'year_only': 'cpue_year'}.get(choice_requested, 'cpue')
manifest.setdefault('stage_compute_seconds', {})[job_key] = time.perf_counter() - started
manifest['cpue_runs'] = {x['choice']: {'job': os.getenv('GITHUB_JOB', job_key),
    'min_hooks': minimum, 'sets_used': len(rows), 'sets_excluded': input_count - len(rows),
    'index_sha256': hashlib.sha256((OUT / 'cpue.csv').read_bytes()).hexdigest()}
    for x in diagnostics}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
