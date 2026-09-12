"""A saved HTML alone recovers its inputs and reproduces its reference results."""
import base64
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class Downloads(HTMLParser):
    def __init__(self):
        super().__init__()
        self.files = {}

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'a' and values.get('download'):
            self.files[values['download']] = base64.b64decode(values['href'].split(',', 1)[1])


def check_saved_report():
    with tempfile.TemporaryDirectory(prefix='cpue-report-replay-') as folder:
        root = Path(folder) / 'original'
        for name in ('pipeline', 'scripts', 'data'):
            shutil.copytree(ROOT / name, root / name)
        (root / 'config').mkdir()
        (root / 'config/stages.json').write_text(json.dumps({'cpue_vessel': {'min_hooks': 2000}, 'assessment_year_high_m': {'M': .35}}))
        env = {**os.environ, 'GITHUB_ACTIONS': 'false', 'TOY_CODE_COMMIT': 'a' * 40,
               'TOY_DATA_COMMIT': 'b' * 40, 'GITHUB_RUN_ID': 'original', 'TOY_DEMO_PACE_SECONDS': '0'}
        subprocess.run([sys.executable, 'scripts/workflow_plan.py'], cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
        plan = json.loads((root / 'stages/_plan.json').read_text())
        for key in plan['stages']:
            subprocess.run([sys.executable, 'scripts/run_stage.py', key], cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
        saved_html = (root / 'stages/report/outputs/report.html').read_text()
        download = Downloads(); download.feed(saved_html)
        provenance = json.loads(download.files['provenance.json'])
        assert hashlib.sha256(download.files['source.sqlite']).hexdigest() == provenance['source_sha256']
        assert provenance['git_commit'] == 'a' * 40 and len(provenance['stage_records']) == 12
        assert 'https://github.com/kyuhank/cpue-actions-demo/commit/' + 'a' * 40 in saved_html
        assert provenance == json.loads((root / 'stages/report/outputs/manifest.json').read_text())
        # Lose the original checkout and artifacts: use only the saved report.
        shutil.rmtree(root)
        replay = Path(folder) / 'replay'
        with zipfile.ZipFile(io.BytesIO(download.files['reproduction.zip'])) as archive:
            archive.extractall(replay)
        result = subprocess.run([sys.executable, 'reproduce.py', '--native'], cwd=replay, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr
        assert 'Verified ' in result.stdout
        # Saved identities must catch changes before any analysis is started.
        shutil.rmtree(replay / 'stages')
        with (replay / 'data/toy-fishery.sqlite').open('ab') as output:
            output.write(b'changed')
        failed = subprocess.run([sys.executable, 'reproduce.py', '--native'], cwd=replay, env=env, capture_output=True, text=True)
        assert failed.returncode != 0 and 'File integrity check failed' in failed.stderr
        assert not (replay / 'stages').exists()
    print('Saved HTML recovers the exact SQLite snapshot, code and settings; replay matches scientific outputs and rejects altered inputs.')


if __name__ == "__main__":
    check_saved_report()
