"""Render a compact, standalone results page from one job's calculated outputs."""
import base64
import csv
import html
import io
import json
import os
from pathlib import Path

STYLE = '''*{box-sizing:border-box}body{margin:0;background:#fafcfc;color:#082447;font:16px/1.55 Arial,sans-serif}main{max-width:1020px;margin:auto;padding:32px}h1{font:700 30px/1.2 Arial,sans-serif;margin:0 0 8px}h2{font-size:21px;margin-top:26px}p,small{color:#587181}svg{width:100%;max-height:300px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;text-align:left;border-bottom:1px solid #dbe6ed}th{color:#537183}a{color:#0085ca}code,pre{font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}summary{cursor:pointer;color:#0085ca}details{margin-top:22px}.brief{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:24px 0}.brief>div{padding:16px;background:#eef5f8;border-radius:9px}.brief span{display:block;color:#637c89;font-size:12px;margin-bottom:6px}.brief b{font-size:16px}.result{font-size:20px;color:#123b55;background:#eaf5ef;border-left:4px solid #268665;padding:15px 18px}.sample{color:#5a7281;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.meta{border-bottom:1px solid #bcd9e4;padding-bottom:16px}.table{overflow:auto}.downloads{display:flex;gap:16px;flex-wrap:wrap;margin:22px 0}@media(max-width:700px){.grid,.brief{grid-template-columns:1fr}main{padding:20px}}@media print{body{background:white}main{padding:0}details{break-inside:avoid}}'''


def brief(received, action, produced):
    return '<div class="brief">'+''.join('<div><span>'+label+'</span><b>'+html.escape(value)+'</b></div>' for label,value in [('INPUT',received),('THIS STEP',action),('OUTPUT',produced)])+'</div>'


def intake_page(key, folder, success):
    def read(name):
        path=folder/name
        return json.loads(path.read_text()) if path.exists() else {}
    batch=read('submission.json');quality=read('quality.json');correction=read('correction.json');prepared=read('prepared.json')
    title={'submission':'Data submission','qc':'Data quality check','ingest':'Prepare & load'}[key]
    if key=='submission':
        rows=batch.get('sets',[])
        overview=brief('New longline records','Save the submitted batch','Submission receipt')
        result=f'{len(rows):,} records submitted for 2024.'
        body='<h2>Example records</h2><div class="table"><table><tr><th>Set</th><th>Year</th><th>Vessel</th><th>Hooks</th><th>Catch (fish)</th></tr>'+''.join('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in row)+'</tr>' for row in rows[:5])+'</table></div><p class="sample">First five submitted records. QC checks them before loading.</p>'
    elif key=='qc':
        overview=brief('Submitted batch','Check records; return errors','Accepted batch or correction request')
        accepted=quality.get('accepted',False)
        result=('QC passed. The batch is ready to load.' if accepted else 'QC failed. The batch must be corrected.')
        body=''
        if correction:
            body+='<h2>Correction history</h2><p><b>Failed → corrected → '+('passed' if accepted else 'awaiting recheck')+'</b></p><p>Set '+html.escape(str(correction['set_id']))+': hooks changed from <b>'+str(correction['before'])+'</b> to <b>'+str(correction['after'])+'</b>. The provider corrects the returned record before resubmitting. This demonstration uses a predefined correction.</p>'
        for error in quality.get('errors',[]):
            body+='<p>'+html.escape(error['message'])+'</p>'
        body+='<h2>Checks</h2><ul>'+''.join('<li>'+html.escape(check)+'</li>' for check in quality.get('checks',[]))+'</ul>'
    else:
        overview=brief('QC-approved records','Order fields and verify the batch','Database release v2024')
        result=f'{prepared.get("rows",0):,} checked records prepared for v2024.' if success else 'Loading stopped. The database release was not confirmed.'
        body='<p>The accepted records are sorted by identifier and checked against the approved batch checksum. The versioned release can then be selected for extraction.</p>' if success else '<p>Inspect the job log for the failed verification. Extraction remains blocked.</p>'
    files={path.name:json.loads(path.read_text()) for path in folder.glob('*.json')}
    details='<details><summary>Files and recorded checks</summary>'+''.join('<h3>'+html.escape(name)+'</h3><pre>'+html.escape(json.dumps(value,indent=2))+'</pre>' for name,value in files.items())+'</details>'
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>'+STYLE+'</style><main><h1>'+title+'</h1>'+overview+'<p class="result">'+result+'</p>'+body+details+'<p class="sample">Synthetic demonstration data.</p></main></html>'


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
    title = {'extract':'Data extraction','cpue':'CPUE analysis','inputs':'Assessment inputs','assessment':'Stock assessment results','synthesis':'Results summary'}[family]
    if family in ('cpue','inputs'): title += ' · ' + ('A' if key.endswith('vessel') else 'B')
    if family == 'assessment': title += ' · ' + ('A' if '_vessel_' in key else 'B') + (' / 2' if key.endswith('high_m') else ' / 1')
    if key=='cpue_summary': title='CPUE results summary'
    manifest = json.loads((out/'manifest.json').read_text())
    files, sections = [], []
    if family == 'extract':
        sections += ['<h2>Annual catch</h2>'+plot(out/'catch.csv','catch_t','Catch (t)'), '<details><summary>Sample extracted records</summary>'+table(out/'sets.csv',5)+'</details>']
        files = ['sets.csv','catch.csv','extract.sql','extract-catch.sql']
    elif key=='cpue_summary':
        sections += [(out/'cpue.svg').read_text(),'<details><summary>Index values by year</summary>'+table(out/'comparison.csv',6)+'</details>']
        files=['cpue.csv','comparison.csv','cpue.svg']
    elif family == 'cpue':
        sections += [plot(out/'cpue.csv','index','Relative CPUE'), '<details><summary>Index values by year</summary>'+table(out/'cpue.csv',6)+'</details>']
        if (out/'cpue-diagnostics.txt').exists(): sections += ['<details><summary>Model diagnostics</summary><pre>'+html.escape((out/'cpue-diagnostics.txt').read_text())+'</pre></details>']
        files = ['cpue.csv','cpue-diagnostics.json']
    elif family == 'inputs':
        sections += ['<p>Checked CPUE indices and annual catches, aligned by year for the assessment.</p>', '<h2>Prepared model input</h2>'+table(out/'assessment-input.csv')]
        files = ['assessment-input.csv','cpue.csv','catch.csv']
    elif family == 'assessment':
        sections += [plot(out/'biomass.csv','SB_over_SB0','Spawning biomass / unfished'), '<details><summary>Fitted parameters</summary>'+table(out/'summary.csv')+'</details>', '<details><summary>Annual estimates</summary>'+table(out/'biomass.csv')+'</details>']
        files = ['biomass.csv','summary.csv','assessment-input.csv']
    else:
        sections += ['<p>Two CPUE analyses and four assessment configurations, collected from verified job outputs.</p>', '<div class="grid">'+''.join((out/f).read_text() for f in ('cpue.svg','biomass.svg'))+'</div>', '<h2>Model comparison</h2>'+table(out/'summary.csv')]
        files = ['summary.csv','cpue.csv','biomass.csv','cpue.svg','biomass.svg']
    overview={
        'extract':('Saved database release','Run the recorded SQL','Longline sets + annual catch'),
        'cpue':('Extracted longline sets','Standardise catch per unit effort','Annual CPUE index'),
        'inputs':('CPUE index + extracted catch','Match years and check units','Assessment input table'),
        'assessment':('Prepared inputs','Fit an age-structured model','Estimated biomass by year'),
        'synthesis':('Four completed assessment fits','Compare models','Comparison plots + table'),
    }[family]
    if key=='cpue_summary':overview=('CPUE analyses A + B','Compare the two series','CPUE comparison plot + table')
    headline=''
    if family=='extract':headline=f'{manifest["rows"]:,} longline sets extracted for {manifest["first_year"]}–{manifest["last_year"]}.'
    elif key=='cpue_summary':headline='Two analyses of the same data, shown together.'
    elif family=='cpue':
        last=list(csv.DictReader((out/'cpue.csv').open()))[-1]
        headline=f'CPUE index in {last["year"]}: {float(last["index"]):.2f}, relative to the first year.'
    elif family=='inputs':headline=f'CPUE and catch aligned for {manifest["first_year"]}–{manifest["last_year"]}.'
    elif family=='assessment':
        last=list(csv.DictReader((out/'biomass.csv').open()))[-1]
        headline=f'Final spawning biomass: {float(last["SB_over_SB0"]):.2f} of the unfished level.'
    else:headline='Four model fits collected for the assessment report.'
    downloads = ''.join('<a download="'+f+'" href="data:application/octet-stream;base64,'+base64.b64encode((out/f).read_bytes()).decode()+'">'+f+'</a>' for f in files if (out/f).exists())
    repo, commit = source.get('repository',''), source.get('commit','')
    link = f'<a href="https://github.com/{repo}/commit/{commit}">{html.escape(repo)} @ {commit[:8]}</a>' if repo and commit else 'Local calculation'
    provenance = {'stage':key,'code_source':source,'workflow_commit':os.getenv('TOY_CODE_COMMIT','local'),'run_id':os.getenv('GITHUB_RUN_ID','local'),'data_version':manifest.get('source_version'), 'snapshot_sha256':manifest.get('source_sha256'), 'container':os.getenv('TOY_CONTAINER_IMAGE','native Python')}
    content = f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{STYLE}</style><main><h1>{html.escape(title)}</h1><p>Data through {manifest["last_year"]}</p>'+brief(*overview)+'<p class="result">'+headline+'</p>'+''.join(sections)+'<details><summary>Download data files</summary><div class="downloads">'+downloads+'</div></details><details><summary>Data and code versions</summary>'+link+'<p>Run '+html.escape(provenance['run_id'])+'</p><pre>'+html.escape(json.dumps(provenance,indent=2))+'</pre></details><p><small>Synthetic data · illustrative models · no management advice.</small></p></main></html>'
    (out/'results.html').write_text(content)
    print('HTML RESULTS: '+key+' · results.html',flush=True)


def finish_report(key, out):
    """Give both report types the same short introduction as the analysis outputs."""
    overview = ('Compared CPUE analyses', 'Describe methods and results', 'CPUE report') if key=='cpue_report' else ('Four assessed model cases', 'Summarise estimates and their sources', 'Assessment report')
    path=out/'report.html'
    content=path.read_text()
    content=content.replace('</style>', STYLE+'</style>',1)
    content=content.replace('</h1>', '</h1>'+brief(*overview),1)
    path.write_text(content)
    (out/'results.html').write_text(content)
    checks=out/'checksums.json'
    if checks.exists():
        import hashlib
        checks.write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.iterdir()) if p.is_file() and p.name!='checksums.json'},indent=2)+'\n')
