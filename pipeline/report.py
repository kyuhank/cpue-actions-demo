"""Build Quarto report source from real outputs of the preceding jobs (stdlib only)."""
import csv
import hashlib
import html
import json
from pathlib import Path
import subprocess

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
table = "\n".join(f"| {labels[x['choice']]} | {float(x['final_index']):.3f} | {float(x['final_B_over_K']):.3f} | {float(x['log_index_SSE']):.3f} |" for x in rows)
commit = manifest['git_commit']
content = f'''---
title: "From a data update to a reviewable result"
subtitle: "Synthetic longline workflow · draft for review"
format:
  html:
    embed-resources: true
    toc: false
    theme: cosmo
    max-width: 1100px
---

::: {{.callout-note}}
**Wholly synthetic data · toy models · no management advice.** Both CPUE choices and both biomass models were fitted in this run. The estimates illustrate the consequences of analysis choices.
:::

**Data through {manifest['last_year']} · {manifest['rows']:,} sets · Run {manifest['github_run_id']}, attempt {manifest['github_run_attempt']}**

## Same data, two recorded choices

::: {{.columns}}
::: {{.column width="50%"}}
![](cpue.svg)
:::
::: {{.column width="50%"}}
![](biomass.svg)
:::
:::

| CPUE choice | Latest CPUE / first year | Latest toy B/K | Log-index SSE |
|:--|--:|--:|--:|
{table}

The toy fleet shifts toward vessels with higher catchability. The two specifications consequently give different trends; this is a designed illustration, not evidence for a preferred specification in a real fishery. Both CPUE fits use a Poisson log link, an effort offset, all zero catches and a common first-year scaling. Predictions average equally across the four toy vessels.

## What the toy assessment assumes

A Schaefer biomass model uses total annual removals and each CPUE series. Growth r = 0.35 and initial B/K = 1 are fixed; carrying capacity K and catchability q are fitted by minimising squared log-index residuals. This is a deterministic teaching example, with no process error or uncertainty propagation, and is not the BET MFCL assessment. Poor fit in the alternative is visible in its SSE. A production analysis would review diagnostics, model assumptions, uncertainty and sensitivities before use.

## Trace this result

| Recorded item | Value |
|:--|:--|
| Source snapshot SHA-256 | `{manifest['source_sha256']}` |
| SQL query SHA-256 | `{manifest['query_sha256']}` |
| Code commit | `{commit}` |
| Workflow run / attempt | `{manifest['github_run_id']} / {manifest['github_run_attempt']}` |
| Python / SQLite | `{manifest['python']} / {manifest['sqlite']}` |
| Runner image | `{manifest['runner_image']}` |

`manifest.json`, the SQL, `choices.json`, model diagnostics, R session records and `checksums.json` travel with this report. GitHub-hosted runner images change; fixed tool versions and recorded sessions improve repeatability but are not a claim of bitwise reproducibility across machines.

## Review remains a scientific step

Automatic execution produces a draft. Analysts evaluate the choices and diagnostics; data custodians approve any release of protected outputs. This demonstration contains only synthetic data and does not implement a secure research environment.
'''
(OUT / "report.qmd").write_text(content)
subprocess.run(["quarto", "render", "report.qmd", "--output", "report.html"], cwd=OUT, check=True)
(OUT / "quarto-version.txt").write_text(subprocess.check_output(["quarto", "--version"], text=True))
manifest["stages"] = ["extract", "cpue", "assessment", "report"]
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file() and p.name != "checksums.json"}
(OUT / "checksums.json").write_text(json.dumps(checksums, indent=2) + "\n")
print("REPORT complete: rendered HTML, model comparisons, manifest and checksums.")

