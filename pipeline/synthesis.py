"""Collect verified assessment fits, then build comparison plots and tables."""
import csv
import json
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('collect_results.py')), run_name='__main__')
OUT = Path('outputs')
rows = list(csv.DictReader((OUT / 'summary.csv').open()))
series = list(csv.DictReader((OUT / 'biomass.csv').open()))
colors = {'vessel_adjusted': '#007c83', 'year_only': '#d27547'}
labels = {'vessel_adjusted': 'Year + vessel', 'year_only': 'Year only'}
def plot(field, filename, label):
    xmin, xmax = min(int(x['year']) for x in series), max(int(x['year']) for x in series)
    ymax = max(1.1, max(float(x[field]) for x in series) * 1.08)
    X = lambda x: 65 + (x - xmin) / (xmax - xmin) * 625
    Y = lambda y: 275 - y / ymax * 230
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 380" role="img" aria-label="' + label + '">',
             '<rect width="750" height="380" fill="#ffffff"/>']
    for value in [0, 0.5, 1.0]:
        parts.append(f'<path d="M65 {Y(value)}H690" stroke="#dce4e5"/><text x="50" y="{Y(value)+5}" text-anchor="end" font-family="sans-serif" font-size="15" fill="#536773">{value:.1f}</text>')
    for year in [xmin, (xmin + xmax)//2, xmax]:
        parts.append(f'<text x="{X(year)}" y="302" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#536773">{year}</text>')
    groups = []
    seen = set()
    for case in rows:
        choice = case['choice']
        key = choice if field == 'observed_index' else case['scenario']
        if key in seen:
            continue
        seen.add(key); groups.append(case)
        selected = [row for row in series if row['scenario'] == case['scenario']]
        points = ' '.join(f'{X(int(row["year"])):.2f},{Y(float(row[field])):.2f}' for row in selected)
        dash = ' stroke-dasharray="8 6"' if field != 'observed_index' and case['setting'] == 'higher_M' else ''
        parts.append(f'<polyline points="{points}" fill="none" stroke="{colors[choice]}" stroke-width="4"{dash}/>')
    parts.append(f'<text x="65" y="25" font-family="sans-serif" font-size="20" fill="#132f42">{label}</text>')
    for i, case in enumerate(groups):
        label_text = labels[case['choice']] + (f" · M={float(case['M']):.2f}" if field != 'observed_index' else '')
        x, y = 65 + (i % 2)*330, 333 + (i//2)*26
        dash = ' stroke-dasharray="6 4"' if field != 'observed_index' and case['setting'] == 'higher_M' else ''
        parts.append(f'<path d="M{x},{y-5}h26" stroke="{colors[case["choice"]]}" stroke-width="3"{dash}/><text x="{x+35}" y="{y}" font-family="sans-serif" font-size="15" fill="{colors[case["choice"]]}">{label_text}</text>')
    (OUT / filename).write_text(''.join(parts) + '</svg>')


plot("observed_index", "cpue.svg", "Standardised CPUE / first year")
plot("SB_over_SB0", "biomass.svg", "Toy spawning biomass / unfished level")
print('SYNTHESIS complete: four verified fits; comparison plots and tables; prepared-input records')
