"""Build a standalone HTML report from actual outputs; no document-tool installation."""
import csv
import hashlib
import html
import json
import os
import time
import runpy

started = time.perf_counter()
from pathlib import Path

if not Path("outputs/cpue.svg").exists():
    runpy.run_path(str(Path(__file__).with_name("synthesis.py")), run_name="__main__")
OUT = Path("outputs")
manifest = json.loads((OUT / "manifest.json").read_text())
rows = list(csv.DictReader((OUT / "summary.csv").open()))
series = list(csv.DictReader((OUT / "biomass.csv").open()))
colors = {"vessel_adjusted": "#007c83", "year_only": "#d27547"}
labels = {"vessel_adjusted": "Year + vessel", "year_only": "Year only"}


case_definitions = json.loads(Path(__file__).with_name('assessment_cases.json').read_text())
manifest['stages'] = ['extract', 'cpue_vessel', 'cpue_year', 'prepare_vessel', 'prepare_year', *[case['key'] for case in case_definitions], 'synthesis', 'report']
manifest['dependencies'] = {'extract': [], 'cpue_vessel': ['extract'], 'cpue_year': ['extract'],
    'prepare_vessel': ['extract', 'cpue_vessel'], 'prepare_year': ['extract', 'cpue_year'],
    **{case['key']: ['prepare_vessel' if case['choice'] == 'vessel_adjusted' else 'prepare_year'] for case in case_definitions},
    'synthesis': [case['key'] for case in case_definitions], 'report': ['synthesis']}
manifest['execution'] = ('11 dependency-linked stages; changed stages execute and matching outputs are reused in one GitHub job' if manifest.get('execution_mode') == 'single_runner_steps' else 'independent GitHub jobs') if 'collection' in manifest else 'local stages using the same case definitions'
manifest['report_format'] = 'standalone HTML; Python standard library'
manifest['configuration'] = {
    'repository': os.getenv('TOY_DATA_REPOSITORY', manifest.get('code_repository', 'kyuhank/cpue-actions-demo')),
    'git_commit': os.getenv('TOY_DATA_COMMIT', manifest.get('workflow_plan', {}).get('trigger_commit', 'unversioned-local-settings')),
    'stage_settings': {key: record['settings'] for key, record in manifest.get('workflow_plan', {}).get('stages', {}).items()},
}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
values = ''.join('<tr><td>' + labels[x['choice']] + f'</td><td>{float(x["M"]):.2f}</td>' + ''.join(f'<td>{float(x[k]):.3f}</td>' for k in ('final_index', 'final_SB_over_SB0', 'log_index_SSE')) + '</tr>' for x in rows)
records = [('Data source', manifest['source_repository']), ('Data release / commit', manifest.get('source_version') or manifest['source_git_commit']), ('Extraction + analysis code', manifest.get('code_repository', 'kyuhank/cpue-actions-demo') + ' @ ' + manifest['git_commit']), ('Settings code', manifest['configuration']['repository'] + ' @ ' + manifest['configuration']['git_commit']), ('Snapshot SHA-256', manifest['source_sha256']), *[(name + ' SHA-256', digest) for name, digest in manifest.get('extraction_queries', {'extract.sql': manifest['query_sha256']}).items()], ('Run / attempt', f"{manifest['github_run_id']} / {manifest['github_run_attempt']}"), ('Extraction origin run', manifest.get('extraction_run_id', manifest['github_run_id'])), ('Python / SQLite', f"{manifest['python']} / {manifest['sqlite']}"), ('Execution', manifest['execution']), ('Runner image', manifest['runner_image']), ('Container digest', manifest.get('container_image','none; native Python'))]
trail = ''.join(f'<tr><th>{name}</th><td><code>{html.escape(str(value))}</code></td></tr>' for name, value in records)
qc = manifest.get('data_release', {}).get('quality_check')
intake_record = ''
if qc:
    intake_record = ('<h2>00 · Check incoming data before publication</h2><p>The incoming batch of '
        + str(qc['rows_received']) + ' sets passed the recorded data checks before release '
        + str(manifest['source_version']) + ' was published. Failed checks return reasons without publishing data or triggering analysis. '
        'These checks validate the intake contract; scientific review of CPUE diagnostics remains a separate step.</p><p>'
        + html.escape('; '.join(qc['checks'])) + '.</p><p>Validation rule version '
        + str(qc['rule_version']) + ' · SQL function SHA-256: <code>' + html.escape(qc['rules_sha256']) + '</code>.</p>')
stats = manifest.get('extraction', {})
extraction = ''.join(f'<div class="stat"><b>{value:,}</b><span>{label}</span></div>' for label, value in [('sets retained', stats.get('retained_rows', manifest['rows'])), ('vessels', stats.get('vessels', 4)), ('hooks', stats.get('total_hooks', 0)), ('zero-catch sets retained', stats.get('zero_catch_sets', 0))])
diagnostics = json.loads((OUT / 'cpue-diagnostics.json').read_text())
diagnostic_rows = ''.join(f"<tr><td>{labels[x['choice']]}</td><td>{x['parameters']}</td><td>{x['deviance']:.1f}</td><td>{x['pearson_dispersion']:.3f}</td></tr>" for x in diagnostics)
parameters = ''.join(f"<tr><td>{labels[x['choice']]}</td><td>{float(x['R0']):,.1f}</td><td>{float(x['q']):.6f}</td><td>{float(x['M']):.2f}</td><td>{float(x['log_index_SSE']):.5f}</td></tr>" for x in rows)
plots = ''.join('<div>' + (OUT / file).read_text() + '</div>' for file in ('cpue.svg', 'biomass.svg'))
branch_record = ''
if manifest.get('cpue_runs'):
    branch_rows = ''.join(f'<tr><td>{labels[choice]}</td><td><code>{html.escape(record["job"])}</code></td><td><code>{record["index_sha256"]}</code></td></tr>'
        for choice, record in manifest['cpue_runs'].items())
    preparations = manifest.get('input_preparations', {choice: manifest['input_preparation'] for choice in manifest['cpue_runs']})
    prep_rows = ''.join(f'<tr><td>{labels[choice]}</td><td><code>{html.escape(record["job"])}</code></td><td><code>{record["output_sha256"]}</code></td></tr>' for choice, record in preparations.items())
    run_rows = ''.join(f'<tr><td>{labels[record["choice"]]}</td><td>{record["M"]:.2f}</td><td><code>{html.escape(record["job"])}</code></td><td><code>{html.escape(record["prepared_by"])}</code></td></tr>' for record in manifest['assessment_runs'].values())
    branch_record = ('<h2>03 · Prepare the assessment inputs</h2><p>CPUE and extracted catch enter input preparation as separate dependencies. Each CPUE series is checked against its recorded checksum, '
        'joined to annual catches by year, and written as a versioned assessment input. '
        'The checks require unique matching years, positive indices and nonnegative removals. '
        'CPUE remains relative to its first year; catches are in tonnes; the toy has one area. In a full assessment this step also assembles length compositions and other model inputs; those are outside this toy likelihood.</p>'
        '<table><tr><th>CPUE branch</th><th>Preparation run</th><th>Prepared input SHA-256</th></tr>' + prep_rows + '</table>'
        '<h2>Four assessment cases, one comparison</h2><p>Each prepared input supplies two illustrative natural mortality assumptions: the configured lower and higher M values shown below. M is held constant across ages and years in each case. '
        'The report collects all four cases after they succeed. These are sensitivity comparisons, without model averaging or uncertainty weights.</p>'
        '<table><tr><th>CPUE input</th><th>Natural mortality M</th><th>Assessment run</th><th>Prepared by</th></tr>' + run_rows + '</table>'
        '<details><summary>CPUE parent records</summary><table><tr><th>CPUE specification</th><th>CPUE run</th><th>Parent index SHA-256</th></tr>' + branch_rows + '</table></details>')
update_record = ''
if manifest.get('workflow_plan'):
    plan = manifest['workflow_plan']
    rerun = sum(r['action'] == 'run' for r in plan['stages'].values())
    update_rows = ''.join('<tr><td>' + html.escape(key) + '</td><td>' + ('Generated' if record['action'] == 'run' else 'Reused unchanged') + '</td><td><code>' + html.escape(str(record['origin_run'])) + '</code></td><td><code>' + html.escape(json.dumps(record['settings'])) + '</code></td></tr>' for key, record in plan['stages'].items())
    update_record = f'<h2>This update: {rerun} stages executed · {len(plan["stages"])-rerun} reused</h2><p>Changed settings invalidate their dependent stages. Reused files retain their checksums and original run records. Trigger commit: <code>{html.escape(plan["trigger_commit"])}</code>.</p><table><tr><th>Stage</th><th>Output</th><th>Origin run</th><th>Stage settings</th></tr>{update_rows}</table>'
content = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>From a data update to a reviewable result</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#fafcfc;color:#001743;font:17px/1.55 Arial,sans-serif}}main{{max-width:1120px;margin:auto;padding:45px 35px}}h1{{font:44px/1.15 Georgia,serif;margin:15px 0 25px}}h2{{font-size:26px;margin:35px 0 16px}}.eyebrow{{color:#0085ca;font-size:13px;letter-spacing:2px}}.notice{{background:#eaf5f8;border-left:4px solid #0085ca;padding:15px 20px;color:#405b70}}.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin:25px 0}}.stat{{border-top:2px solid #0085ca;padding-top:17px}}.stat b{{display:block;font-size:30px}}.stat span{{font-size:15px;color:#536b7b}}.meta{{font-weight:bold;margin:25px 0}}.plots{{display:grid;grid-template-columns:1fr 1fr;gap:22px}}.plots svg{{width:100%;height:auto}}table{{border-collapse:collapse;width:100%;margin:20px 0}}th,td{{text-align:left;padding:12px;border-bottom:1px solid #d8e5ea}}code{{font-size:13px;overflow-wrap:anywhere}}.trail th{{width:195px}}p{{color:#536b7b}}@media(max-width:750px){{.plots{{grid-template-columns:1fr}}h1{{font-size:32px}}main{{padding:25px 18px}}}}</style>
<main><div class="eyebrow">SYNTHETIC LONGLINE WORKFLOW · DRAFT FOR REVIEW</div><h1>From a data update<br>to a reviewable result.</h1>
<div class="notice">Wholly synthetic data and toy models. No management advice.</div>
<div class="meta">Data through {manifest['last_year']} · {manifest['rows']:,} sets · Run {manifest['github_run_id']}, attempt {manifest['github_run_attempt']}</div>
{intake_record}{update_record}<h2>01 · Extract and check the data</h2><div class="stats">{extraction}</div><p>Retained {manifest['rows']:,} of {stats.get('input_rows', manifest['rows']):,} input sets. Checked unique set identities, valid effort and catch, and matching annual catch and CPUE coverage. The extraction query and snapshot hashes are recorded below.</p>
<h2>02 · Standardise CPUE and compare choices</h2><div class="plots">{plots}</div><table><tr><th>CPUE choice</th><th>Natural mortality M</th><th>Latest CPUE / first year</th><th>Latest toy SB/SB₀</th><th>Log-index SSE</th></tr>{values}</table>
<p>The synthetic records include annual availability variation, changing effort and overdispersed set catches. The fleet shifts toward vessels with higher catchability. Including or omitting a vessel effect changes the index. Both choices use a Poisson log link, an effort offset, zero catches and equal vessel prediction weights. Each index is scaled to its first year.</p>
<table><tr><th>Poisson CPUE model</th><th>Parameters</th><th>Deviance</th><th>Pearson dispersion</th></tr>{diagnostic_rows}</table><p>Diagnostics are calculated from the set-level fitted values. Overdispersion is intentional in the generated data; these simple Poisson mean models do not provide uncertainty estimates. The year + vessel model uses iterative proportional fitting; year only uses the analytic Poisson group means.</p>
{branch_record}<h2>04 · Fit and compare the toy assessments</h2><table><tr><th>CPUE input</th><th>Fitted recruitment R₀</th><th>Fitted q</th><th>Fixed M (year⁻¹)</th><th>Log-index SSE</th></tr>{parameters}</table><p>The annual age-structured toy model follows ages 0–10+, with an accumulated plus group. It fits a constant recruitment scale R₀ and catchability q to CPUE. Annual fishing mortality is solved from the Baranov catch equation to match removals. CPUE is proportional to beginning-year vulnerable biomass. Weight at age, maturity (ages 3+) and selectivity (ages 2+) are fixed; the initial state is unfished equilibrium. These are illustrative biological assumptions, with no age-composition likelihood, recruitment deviations or uncertainty propagation. SB/SB₀ is spawning biomass relative to its unfished equilibrium under that case’s M.</p>
<h2>05 · Results synthesis: collect fits, plots and tables</h2><p>A separate synthesis stage verifies the four fits, combines comparison tables and draws the CPUE and biomass plots. The report stage packages these outputs and their provenance.</p><h2>06 · Version the data, code and outputs together</h2><p>Each run identifies its data release, extraction and analysis code, settings commit and container digest. The original SQL files travel with the outputs. For the hosted database, the exact SQLite snapshot is saved too. Changing settings retains the data version and the origin records of reused outputs.</p><table class="trail">{trail}</table>
<p>The manifest, choices, diagnostics, runtime records and checksums travel with the report. Model checks cover unfished equilibrium, plus-group survival, catch matching and recovery from known synthetic parameters; separate-job results are checked against local execution. GitHub runner images change; recorded versions support reruns without claiming identical results across every machine.</p>
<p>Model background: <a href="https://www.fao.org/4/x9026e/x9026e06.htm">FAO: catch and mortality</a>; <a href="https://nmfs-ost.github.io/ss3-website/qmds/phases.html">NOAA: age-structured production models</a>. The synthetic input generator supplies a simple abundance trend; this comparison does not assume that an age-structured model generated those records.</p><h2>Review remains a scientific step</h2><p>Automatic execution produces a draft. Analysts review model choices, diagnostics, uncertainty and sensitivities. Data custodians approve releases of protected outputs. This public toy example does not implement a secure research environment.</p></main></html>'''
(OUT / 'report.html').write_text(content)
manifest.setdefault('stage_compute_seconds', {})['report'] = time.perf_counter() - started
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file() and p.name != 'checksums.json'}
(OUT / 'checksums.json').write_text(json.dumps(checksums, indent=2) + '\n')
print('REPORT complete: standalone HTML, model comparisons, manifest and checksums')
