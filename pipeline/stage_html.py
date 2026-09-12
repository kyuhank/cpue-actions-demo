"""Render a compact, standalone results page from one job's calculated outputs."""
import base64
import csv
import html
import io
import json
import os
from pathlib import Path

STYLE = '''*{box-sizing:border-box}body{margin:0;background:#fafcfc;color:#082447;font:16px/1.55 Arial,sans-serif}main{max-width:1020px;margin:auto;padding:32px}h1{font:36px/1.2 Georgia,serif}h2{font-size:21px;margin-top:26px}p,small{color:#587181}svg{width:100%;max-height:300px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;text-align:left;border-bottom:1px solid #dbe6ed}th{color:#537183}a{color:#0085ca}code,pre{font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}summary{cursor:pointer;color:#0085ca}details{margin-top:22px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.meta{border-bottom:1px solid #bcd9e4;padding-bottom:16px}.table{overflow:auto}.downloads{display:flex;gap:16px;flex-wrap:wrap;margin:22px 0}@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:20px}}@media print{body{background:white}main{padding:0}details{break-inside:avoid}}'''


def table(path, limit=12):
    rows = list(csv.reader(path.open()))
    cells = ''.join('<tr>' + ''.join(f'<{"th" if i == 0 else "td"}>{html.escape(v)}</{"th" if i == 0 else "td"}>' for v in row) + '</tr>' for i, row in enumerate(rows[:limit+1]))
    return '<div class="table"><table>' + cells + '</table></div><small>' + str(len(rows)-1) + ' rows' + (' · first '+str(limit)+' shown' if len(rows)>limit+1 else '') + '</small>'


def plot(path, field, title):
    rows = list(csv.DictReader(path.open()))
    points = [(float(r['year']), float(r[field])) for r in rows]
    xmin, xmax = min(p[0] for p in points), max(p[0] for p in points)
    ymax = max(p[1] for p in points)*1.1 or 1
    xy = ' '.join(f'{55+800*(x-xmin)/(xmax-xmin or 1):.2f},{245-195*y/ymax:.2f}' for x,y in points)
    grid = ''.join(f'<path d="M55 {245-195*v/ymax}H855" stroke="#dfe9ee"/><text x="5" y="{250-195*v/ymax}">{v:.2g}</text>' for v in (0,ymax/2,ymax))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 290" role="img" aria-label="{html.escape(title)}"><g fill="#577181" font-family="Arial" font-size="14">{grid}<text x="55" y="22">{html.escape(title)}</text><text x="55" y="278">{int(xmin)}</text><text x="817" y="278">{int(xmax)}</text></g><polyline points="{xy}" fill="none" stroke="#0085ca" stroke-width="3"/></svg>'


def build(key, out, source):
    family = 'inputs' if key.startswith('prepare_') else key.split('_')[0]
    title = {'extract':'Data extraction','cpue':'CPUE analysis','inputs':'Assessment inputs','assessment':'Stock assessment results','synthesis':'Results synthesis'}[family]
    if family in ('cpue','inputs'): title += ' · ' + ('A' if key.endswith('vessel') else 'B')
    if family == 'assessment': title += ' · ' + ('A' if '_vessel_' in key else 'B') + (' / 2' if key.endswith('high_m') else ' / 1')
    manifest = json.loads((out/'manifest.json').read_text())
    files, sections = [], []
    if family == 'extract':
        sections += ['<h2>Annual catch</h2>'+plot(out/'catch.csv','catch_t','Catch (t)'), '<h2>Extracted records</h2>'+table(out/'sets.csv',8)]
        files = ['sets.csv','catch.csv','extract.sql','extract-catch.sql']
    elif family == 'cpue':
        sections += [plot(out/'cpue.csv','index','Relative CPUE'), '<h2>Standardised index</h2>'+table(out/'cpue.csv')]
        if (out/'cpue-diagnostics.txt').exists(): sections += ['<h2>Diagnostics</h2><pre>'+html.escape((out/'cpue-diagnostics.txt').read_text())+'</pre>']
        files = ['cpue.csv','cpue-diagnostics.json']
    elif family == 'inputs':
        sections += ['<p>Checked CPUE indices and annual catches, aligned by year for the assessment.</p>', '<h2>Prepared model input</h2>'+table(out/'assessment-input.csv')]
        files = ['assessment-input.csv','cpue.csv','catch.csv']
    elif family == 'assessment':
        sections += [plot(out/'biomass.csv','SB_over_SB0','Spawning biomass / unfished'), '<h2>Fit summary</h2>'+table(out/'summary.csv'), '<details><summary>Annual estimates</summary>'+table(out/'biomass.csv')+'</details>']
        files = ['biomass.csv','summary.csv','assessment-input.csv']
    else:
        sections += ['<p>Two CPUE analyses and four assessment configurations, collected from verified job outputs.</p>', '<div class="grid">'+''.join((out/f).read_text() for f in ('cpue.svg','biomass.svg'))+'</div>', '<h2>Model comparison</h2>'+table(out/'summary.csv')]
        files = ['summary.csv','cpue.csv','biomass.csv','cpue.svg','biomass.svg']
    downloads = ''.join('<a download="'+f+'" href="data:application/octet-stream;base64,'+base64.b64encode((out/f).read_bytes()).decode()+'">'+f+'</a>' for f in files if (out/f).exists())
    repo, commit = source.get('repository',''), source.get('commit','')
    link = f'<a href="https://github.com/{repo}/commit/{commit}">{html.escape(repo)} @ {commit[:8]}</a>' if repo and commit else 'Local calculation'
    provenance = {'stage':key,'code_source':source,'workflow_commit':os.getenv('TOY_CODE_COMMIT','local'),'run_id':os.getenv('GITHUB_RUN_ID','local'),'data_version':manifest.get('source_version'), 'snapshot_sha256':manifest.get('source_sha256'), 'container':os.getenv('TOY_CONTAINER_IMAGE','native Python')}
    content = f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{STYLE}</style><main><h1>{html.escape(title)}</h1><p class="meta">Data through {manifest["last_year"]} · Run {html.escape(provenance["run_id"])}<br>{link}</p>'+''.join(sections)+'<div class="downloads">'+downloads+'</div><details><summary>Recorded data, code and environment</summary><pre>'+html.escape(json.dumps(provenance,indent=2))+'</pre></details><p><small>Synthetic data · illustrative models · no management advice.</small></p></main></html>'
    (out/'results.html').write_text(content)
    print('HTML RESULTS: '+key+' · results.html',flush=True)
