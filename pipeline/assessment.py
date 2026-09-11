"""Fit the same small Schaefer model as the reference R implementation."""
import csv
import math
from pathlib import Path
import platform
import json
import time

started = time.perf_counter()

OUT = Path('outputs')
indices = list(csv.DictReader((OUT / 'cpue.csv').open()))
removals = list(csv.DictReader((OUT / 'catch.csv').open()))
r = .35

def trajectory(K):
    B = [K]
    for row in removals[:-1]:
        value = B[-1] + r * B[-1] * (1 - B[-1] / K) - float(row['catch_t'])
        if not math.isfinite(value) or value <= 0:
            return None
        B.append(value)
    return B

def minimum(function, lo, hi):
    ratio = (math.sqrt(5) - 1) / 2
    a, b = hi - ratio * (hi - lo), lo + ratio * (hi - lo)
    fa, fb = function(a), function(b)
    for _ in range(160):
        if hi - lo < 1e-10:
            break
        if fa < fb:
            hi, b, fb = b, a, fa
            a = hi - ratio * (hi - lo); fa = function(a)
        else:
            lo, a, fa = a, b, fb
            b = lo + ratio * (hi - lo); fb = function(b)
    return (lo + hi) / 2

summary, series = [], []
for choice in dict.fromkeys(x['choice'] for x in indices):
    data = sorted((x for x in indices if x['choice'] == choice), key=lambda x: int(x['year']))
    if [x['year'] for x in data] != [x['year'] for x in removals]:
        raise SystemExit('CPUE and removal years differ')
    logs = [math.log(float(x['index'])) for x in data]
    def objective(logK):
        B = trajectory(math.exp(logK))
        if B is None:
            return 1e12
        logq = sum(i - math.log(b) for i, b in zip(logs, B)) / len(B)
        return sum((i - logq - math.log(b)) ** 2 for i, b in zip(logs, B))
    logK = minimum(objective, math.log(6000), math.log(100000))
    K = math.exp(logK); B = trajectory(K)
    if B is None or objective(logK) >= 1e11:
        raise SystemExit('Toy biomass fit failed')
    q = math.exp(sum(i - math.log(b) for i, b in zip(logs, B)) / len(B))
    summary.append([choice, data[-1]['year'], K, q, r, float(data[-1]['index']), B[-1] / K, objective(logK), K < 6001 or K > 99990])
    series.extend([x['year'], choice, b, b / K, x['index'], q * b] for x, b in zip(data, B))
for name, header, data in [
    ('summary.csv', ['choice','year','K','q','r','final_index','final_B_over_K','log_index_SSE','boundary_fit'], summary),
    ('biomass.csv', ['year','choice','biomass','B_over_K','observed_index','fitted_index'], series),
]:
    with (OUT / name).open('w', newline='') as f:
        w = csv.writer(f); w.writerow(header); w.writerows(data)
(OUT / 'assessment-session.txt').write_text(f'Python {platform.python_version()}; standard library only; bounded golden-section optimisation\n')
print('ASSESSMENT complete: two Schaefer fits; fixed r and initial depletion; no uncertainty propagation')

manifest = json.loads((OUT / 'manifest.json').read_text())
manifest.setdefault('stage_compute_seconds', {})['assessment'] = time.perf_counter() - started
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
