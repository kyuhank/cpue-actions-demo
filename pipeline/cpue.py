"""Fit the two toy Poisson models using categorical iterative proportional fitting."""
import csv
import json
import math
from pathlib import Path
import platform

OUT = Path('outputs')
rows = list(csv.DictReader((OUT / 'sets.csv').open()))
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
for iteration in range(10000):
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
        w.writerows((y, index[y] / index[years[0]], choice) for y in years)
(OUT / 'cpue-diagnostics.txt').write_text(
    f'Poisson year + vessel: {iteration + 1} IPF iterations; maximum relative year score residual {score_error:.3g}\n'
    'Poisson year only: analytic group means. Equal vessel weights; zero catches retained.\n'
    + 'Vessel multipliers: ' + json.dumps(b) + '\n')
(OUT / 'cpue-session.txt').write_text(f'Python {platform.python_version()}; standard library only\n')
print(f'CPUE complete: two Poisson fits; {iteration + 1} iterations')
