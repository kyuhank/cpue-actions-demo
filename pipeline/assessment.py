"""Fit the same small Schaefer model as the reference R implementation."""
import csv
import math
from pathlib import Path
import platform
import json
import time
import hashlib
import os

started = time.perf_counter()

OUT = Path('outputs')
manifest = json.loads((OUT / 'manifest.json').read_text())
input_bytes = (OUT / 'assessment-input.csv').read_bytes()
if hashlib.sha256(input_bytes).hexdigest() != manifest['input_preparation']['output_sha256']:
    raise SystemExit('Prepared assessment input checksum differs from its record')
indices = list(csv.DictReader((OUT / 'assessment-input.csv').open()))
cases = json.loads(Path(__file__).with_name('assessment_cases.json').read_text())
requested = os.getenv('TOY_ASSESSMENT_CASE', '')
if requested:
    cases = [case for case in cases if case['key'] == requested]
    if not cases:
        raise SystemExit('Unknown assessment case')
if not {case['choice'] for case in cases} <= {row['choice'] for row in indices}:
    raise SystemExit('The prepared input does not supply the requested CPUE choice')

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
for case in cases:
    choice, setting, scenario, r = case['choice'], case['setting'], case['key'], case['r']
    data = sorted((x for x in indices if x['choice'] == choice), key=lambda x: int(x['year']))
    removals = data
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
    summary.append([choice, setting, scenario, data[-1]['year'], K, q, r, float(data[-1]['index']), B[-1] / K, objective(logK), K < 6001 or K > 99990])
    series.extend([x['year'], choice, setting, scenario, b, b / K, x['index'], q * b] for x, b in zip(data, B))
for name, header, data in [
    ('summary.csv', ['choice','setting','scenario','year','K','q','r','final_index','final_B_over_K','log_index_SSE','boundary_fit'], summary),
    ('biomass.csv', ['year','choice','setting','scenario','biomass','B_over_K','observed_index','fitted_index'], series),
]:
    with (OUT / name).open('w', newline='') as f:
        w = csv.writer(f); w.writerow(header); w.writerows(data)
(OUT / 'assessment-session.txt').write_text(f'Python {platform.python_version()}; standard library only; bounded golden-section optimisation\n')
print(f'ASSESSMENT complete: {len(cases)} Schaefer fit(s); recorded growth settings; no uncertainty propagation')

job = os.getenv('GITHUB_JOB', requested or 'assessment')
manifest.setdefault('stage_compute_seconds', {})[job] = time.perf_counter() - started
manifest['assessment_runs'] = {case['key']: {**case, 'job': os.getenv('GITHUB_JOB', case['key']),
    'prepared_by': manifest['input_preparation']['job'],
    'input_sha256': manifest['input_preparation']['output_sha256'],
    **{name + '_sha256': hashlib.sha256((OUT / name).read_bytes()).hexdigest()
       for name in ('summary.csv', 'biomass.csv')}} for case in cases}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
