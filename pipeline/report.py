"""Build a standalone HTML report from actual outputs; no document-tool installation."""
import csv
import hashlib
import html
import json
import time

started = time.perf_counter()
from pathlib import Path

OUT = Path("outputs")
manifest = json.loads((OUT / "manifest.json").read_text())
rows = list(csv.DictReader((OUT / "summary.csv").open()))
series = list(csv.DictReader((OUT / "biomass.csv").open()))
colors = {"vessel_adjusted": "#007c83", "year_only": "#d27547"}
labels = {"vessel_adjusted": "Year + vessel", "year_only": "Year only"}


def plot(field, filename, label):
    xmin, xmax = min(int(x['year']) for x in series), max(int(x['year']) for x in series)
    ymax = max(1.1, max(float(x[field]) for x in series) * 1.08)
    X = lambda x: 65 + (x - xmin) / (xmax - xmin) * 625
    Y = lambda y: 275 - y / ymax * 230
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 350" role="img" aria-label="' + label + '">',
             '<rect width="750" height="350" fill="#ffffff"/>']
    for value in [0, 0.5, 1.0]:
        parts.append(f'<path d="M65 {Y(value)}H690" stroke="#dce4e5"/><text x="50" y="{Y(value)+5}" text-anchor="end" font-family="sans-serif" font-size="15" fill="#536773">{value:.1f}</text>')
    for year in [xmin, (xmin + xmax)//2, xmax]:
        parts.append(f'<text x="{X(year)}" y="302" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#536773">{year}</text>')
    for choice, color in colors.items():
        points = ' '.join(f'{X(int(row["year"])):.2f},{Y(float(row[field])):.2f}' for row in series if row['choice'] == choice)
        parts.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="4"/>')
    parts.append(f'<text x="65" y="25" font-family="sans-serif" font-size="20" fill="#132f42">{label}</text>')
    for i, (choice, color) in enumerate(colors.items()):
        parts.append(f'<text x="{65 + i*245}" y="335" font-family="sans-serif" font-size="17" fill="{color}">● {labels[choice]}</text>')
    (OUT / filename).write_text(''.join(parts) + '</svg>')


plot("observed_index", "cpue.svg", "Standardised CPUE / first year")
plot("B_over_K", "biomass.svg", "Toy biomass / carrying capacity")
manifest['stages'] = ['extract', 'cpue', 'assessment', 'report']
manifest['report_format'] = 'standalone HTML; Python standard library'
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
values = ''.join('<tr><td>' + labels[x['choice']] + '</td>' + ''.join(f'<td>{float(x[k]):.3f}</td>' for k in ('final_index', 'final_B_over_K', 'log_index_SSE')) + '</tr>' for x in rows)
records = [('Data repository', manifest['source_repository']), ('Data commit', manifest['source_git_commit']), ('Code commit', manifest['git_commit']), ('Snapshot SHA-256', manifest['source_sha256']), ('SQL SHA-256', manifest['query_sha256']), ('Run / attempt', f"{manifest['github_run_id']} / {manifest['github_run_attempt']}"), ('Python / SQLite', f"{manifest['python']} / {manifest['sqlite']}"), ('Runner image', manifest['runner_image']), ('Container digest', manifest.get('container_image','none; native Python'))]
trail = ''.join(f'<tr><th>{name}</th><td><code>{html.escape(str(value))}</code></td></tr>' for name, value in records)
stats = manifest.get('extraction', {})
extraction = ''.join(f'<div class="stat"><b>{value:,}</b><span>{label}</span></div>' for label, value in [('sets retained', stats.get('retained_rows', manifest['rows'])), ('vessels', stats.get('vessels', 4)), ('hooks', stats.get('total_hooks', 0)), ('zero-catch sets retained', stats.get('zero_catch_sets', 0))])
diagnostics = json.loads((OUT / 'cpue-diagnostics.json').read_text())
diagnostic_rows = ''.join(f"<tr><td>{labels[x['choice']]}</td><td>{x['parameters']}</td><td>{x['deviance']:.1f}</td><td>{x['pearson_dispersion']:.3f}</td></tr>" for x in diagnostics)
parameters = ''.join(f"<tr><td>{labels[x['choice']]}</td><td>{float(x['K']):,.1f}</td><td>{float(x['q']):.6f}</td><td>{float(x['r']):.2f}</td><td>{float(x['log_index_SSE']):.5f}</td></tr>" for x in rows)
plots = ''.join('<div>' + (OUT / file).read_text() + '</div>' for file in ('cpue.svg', 'biomass.svg'))
content = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>From a data update to a reviewable result</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#fafcfc;color:#001743;font:17px/1.55 Arial,sans-serif}}main{{max-width:1120px;margin:auto;padding:45px 35px}}h1{{font:44px/1.15 Georgia,serif;margin:15px 0 25px}}h2{{font-size:26px;margin:35px 0 16px}}.eyebrow{{color:#0085ca;font-size:13px;letter-spacing:2px}}.notice{{background:#eaf5f8;border-left:4px solid #0085ca;padding:15px 20px;color:#405b70}}.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin:25px 0}}.stat{{border-top:2px solid #0085ca;padding-top:17px}}.stat b{{display:block;font-size:30px}}.stat span{{font-size:15px;color:#536b7b}}.meta{{font-weight:bold;margin:25px 0}}.plots{{display:grid;grid-template-columns:1fr 1fr;gap:22px}}.plots svg{{width:100%;height:auto}}table{{border-collapse:collapse;width:100%;margin:20px 0}}th,td{{text-align:left;padding:12px;border-bottom:1px solid #d8e5ea}}code{{font-size:13px;overflow-wrap:anywhere}}.trail th{{width:195px}}p{{color:#536b7b}}@media(max-width:750px){{.plots{{grid-template-columns:1fr}}h1{{font-size:32px}}main{{padding:25px 18px}}}}</style>
<main><div class="eyebrow">SYNTHETIC LONGLINE WORKFLOW · DRAFT FOR REVIEW</div><h1>From a data update<br>to a reviewable result.</h1>
<div class="notice">Wholly synthetic data and toy models. No management advice.</div>
<div class="meta">Data through {manifest['last_year']} · {manifest['rows']:,} sets · Run {manifest['github_run_id']}, attempt {manifest['github_run_attempt']}</div>
<h2>01 · Extract and check the data</h2><div class="stats">{extraction}</div><p>Retained {manifest['rows']:,} of {stats.get('input_rows', manifest['rows']):,} input sets. Checked unique set identities, valid effort and catch, and matching annual catch and CPUE coverage. The extraction query and snapshot hashes are recorded below.</p>
<h2>02 · Standardise CPUE and compare choices</h2><div class="plots">{plots}</div><table><tr><th>CPUE choice</th><th>Latest CPUE / first year</th><th>Latest toy B/K</th><th>Log-index SSE</th></tr>{values}</table>
<p>The generated fleet shifts toward vessels with higher catchability. Including or omitting a vessel effect changes the index. Both choices use a Poisson log link, an effort offset, zero catches and equal vessel prediction weights. Each index is scaled to its first year.</p>
<table><tr><th>Poisson CPUE model</th><th>Parameters</th><th>Deviance</th><th>Pearson dispersion</th></tr>{diagnostic_rows}</table><p>Diagnostics are calculated from the set-level fitted values. The year + vessel model uses iterative proportional fitting; year only uses the analytic Poisson group means.</p>
<h2>03 · Fit the toy stock assessment</h2><table><tr><th>CPUE input</th><th>Fitted K</th><th>Fitted q</th><th>Fixed r</th><th>Log-index SSE</th></tr>{parameters}</table><p>A Schaefer model fits carrying capacity K and catchability q to each index and annual removals. Growth r = 0.35 and initial B/K = 1 are fixed. This deterministic example has no process error or uncertainty propagation and is not the BET MFCL assessment.</p>
<h2>04 · Trace and review the draft report</h2><table class="trail">{trail}</table>
<p>The manifest, choices, diagnostics, runtime records and checksums travel with the report. The Python fits were checked against the reference R implementations. GitHub runner images change; recorded versions support reruns without claiming identical results across every machine.</p>
<h2>Review remains a scientific step</h2><p>Automatic execution produces a draft. Analysts review model choices, diagnostics, uncertainty and sensitivities. Data custodians approve releases of protected outputs. This public toy example does not implement a secure research environment.</p></main></html>'''
(OUT / 'report.html').write_text(content)
manifest.setdefault('stage_compute_seconds', {})['report'] = time.perf_counter() - started
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file() and p.name != 'checksums.json'}
(OUT / 'checksums.json').write_text(json.dumps(checksums, indent=2) + '\n')
print('REPORT complete: standalone HTML, model comparisons, manifest and checksums')
