"""Retrieve each analysis module at its locked commit before any jobs start."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    'extract': {'extract.py': 'extract.py', 'extract.sql': 'extract.sql', 'extract-catch.sql': 'extract-catch.sql'},
    'cpue_vessel': {'cpue.py': 'cpue_vessel.py'},
    'cpue_year': {'cpue.py': 'cpue_year.py'},
    'cpue_summary': {'cpue_summary.py': 'cpue_summary.py'},
    'cpue_report': {'cpue_report.py': 'cpue_report.py'},
    'prepare_vessel': {'prepare_inputs.py': 'prepare_vessel.py'},
    'prepare_year': {'prepare_inputs.py': 'prepare_year.py'},
    **{key: {'assessment.py': key + '.py'} for key in ('assessment_vessel_ref', 'assessment_vessel_high_m', 'assessment_year_ref', 'assessment_year_high_m')},
    'synthesis': {'synthesis.py': 'synthesis.py', 'collect_results.py': 'collect_results.py'},
    'report': {'report.py': 'report.py', 'reproduction.py': 'reproduction.py'},
}
REPOS = {'extract': 'extract', 'cpue': 'cpue', 'prepare': 'inputs', 'assessment': 'assessment', 'synthesis': 'synthesis', 'report': 'report'}


def selected_sources(root=ROOT):
    locked = json.loads((root / 'modules.lock.json').read_text())
    catalog = json.loads((root / 'module-branches.json').read_text())
    selection_path = (root / os.getenv('TOY_STAGE_CONFIG', 'config/stages.json')).with_name('modules.json')
    selections = json.loads(selection_path.read_text()) if selection_path.exists() else {}
    if not isinstance(selections, dict) or set(selections) - set(FILES):
        raise ValueError('Unknown workshop module selection')
    for key, selection in selections.items():
        if (not isinstance(selection, dict) or set(selection) != {'branch', 'request'}
                or not isinstance(selection['branch'], str)
                or selection['branch'] not in catalog.get(key, {})
                or not isinstance(selection['request'], str)
                or not re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', selection['request'])):
            raise ValueError('Only registered branches and explicit workshop requests are accepted')
        locked[key] = {**catalog[key][selection['branch']], 'requested_revision': selection['request']}
    return locked


def resolve():
    locked = selected_sources()
    if set(locked) != set(FILES):
        raise ValueError('The module lock must identify every workflow stage')
    requests = set()
    for key, source in locked.items():
        expected = 'kyuhank/cpue-demo-' + REPOS[key.split('_')[0]]
        if source['repository'] != expected or not re.fullmatch('[0-9a-f]{40}', source['commit']):
            raise ValueError('Only fixed workshop repositories and exact commits are accepted')
        requests.add((source['repository'], source['commit']))

    def fetch(pair):
        repo, commit = pair
        with urllib.request.urlopen('https://codeload.github.com/' + repo + '/zip/' + commit, timeout=30) as response:
            content = response.read(1024 * 1024 + 1)
        if len(content) > 1024 * 1024:
            raise ValueError('Module archive exceeds the demonstration limit')
        files = {}
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            for member in archive.infolist():
                name = member.filename.partition('/')[2]
                if name in {'extract.py', 'extract.sql', 'extract-catch.sql', 'cpue.py', 'cpue_summary.py', 'cpue_report.py', 'prepare_inputs.py', 'assessment.py', 'synthesis.py', 'collect_results.py', 'report.py', 'reproduction.py', 'model.json'}:
                    if member.file_size > 512 * 1024 or name in files:
                        raise ValueError('Invalid module source file')
                    files[name] = archive.read(member)
        return pair, files

    with ThreadPoolExecutor(max_workers=8) as pool:
        archives = dict(pool.map(fetch, sorted(requests)))
    versions, assembled = {}, {}
    for key, source in locked.items():
        files = archives[source['repository'], source['commit']]
        targets = {}
        for name, target in FILES[key].items():
            content = files[name]
            if target in assembled and assembled[target] != content:
                raise ValueError('Conflicting shared module source: ' + target)
            assembled[target] = content
            targets['pipeline/' + target] = hashlib.sha256(content).hexdigest()
        versions[key] = {**source, 'files': targets, 'entrypoint': next(iter(FILES[key].values())),
                         'specification': json.loads(files.get('model.json', b'{}'))}
    for target, content in assembled.items():
        (ROOT / 'pipeline' / target).write_bytes(content)
    # Keep the small local example compatible with the same module sources.
    (ROOT / 'pipeline/prepare_inputs.py').write_bytes(assembled['prepare_vessel.py'])
    (ROOT / 'pipeline/cpue.py').write_bytes(assembled['cpue_vessel.py'])
    (ROOT / 'pipeline/assessment.py').write_bytes(assembled['assessment_vessel_ref.py'])
    (ROOT / 'module-versions.json').write_text(json.dumps(versions, indent=2) + '\n')
    for key, source in versions.items():
        print(f'MODULE {key}: {source["repository"]} · {source["branch"]} @ {source["commit"]}')
    return versions


if __name__ == '__main__':
    resolve()
