"""Fetch an immutable Supabase version and materialise the small SQLite snapshot."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from urllib.request import Request, urlopen


def rpc(url, key, name, body):
    if not re.fullmatch(r'https://[a-z0-9]+\.supabase\.co', url):
        raise ValueError('Use the project HTTPS URL')
    headers = {'apikey': key, 'Content-Type': 'application/json'}
    if key.startswith('eyJ'):
        headers['Authorization'] = 'Bearer ' + key
    request = Request(url + '/rest/v1/rpc/' + name, data=json.dumps(body).encode(), headers=headers)
    with urlopen(request, timeout=20) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError('Snapshot exceeds the demonstration limit')
    return json.loads(raw)


def materialise(snapshot, target):
    if not isinstance(snapshot.get('version'), int) or not 2023 <= snapshot['version'] <= 2035:
        raise ValueError('Unknown database version')
    if not 1 <= len(snapshot['sets']) <= 15000 or not 1 <= len(snapshot['removals']) <= 40:
        raise ValueError('Invalid synthetic snapshot size')
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.incoming.sqlite')
    temporary.unlink(missing_ok=True)
    with sqlite3.connect(temporary) as db:
        db.execute('CREATE TABLE sets (set_id TEXT PRIMARY KEY, year INTEGER NOT NULL, vessel TEXT NOT NULL, hooks INTEGER NOT NULL CHECK(hooks>0), catch_n INTEGER NOT NULL CHECK(catch_n>=0))')
        db.execute('CREATE TABLE removals (year INTEGER PRIMARY KEY, catch_t REAL NOT NULL CHECK(catch_t>=0))')
        db.executemany('INSERT INTO sets VALUES(?,?,?,?,?)', sorted(snapshot['sets']))
        db.executemany('INSERT INTO removals VALUES(?,?)', sorted(snapshot['removals']))
        if db.execute('SELECT max(year) FROM removals').fetchone()[0] != snapshot['version']:
            raise ValueError('Snapshot version and data years differ')
    temporary.replace(target)
    target.with_suffix('.release.json').write_text(json.dumps({
        'version': snapshot['version'], 'published_at': snapshot.get('published_at'),
        'quality_check': snapshot.get('quality_check'),
    }, indent=2) + '\n')
    return hashlib.sha256(target.read_bytes()).hexdigest()


if __name__ == '__main__':
    version = os.getenv('TOY_DATABASE_VERSION', '')
    if version and not re.fullmatch(r'20\d{2}', version):
        raise SystemExit('Invalid database version')
    snapshot = rpc(os.environ['SUPABASE_URL'], os.environ['SUPABASE_ANON_KEY'], 'cpue_snapshot', {'p_version': int(version) if version else None})
    digest = materialise(snapshot, os.environ['TOY_SOURCE_DATABASE'])
    if os.getenv('GITHUB_ENV'):
        with open(os.environ['GITHUB_ENV'], 'a') as f:
            f.write(f'TOY_SOURCE_PROVIDER=supabase\nTOY_SOURCE_VERSION={snapshot["version"]}\n')
    print(f'DATABASE SNAPSHOT: version {snapshot["version"]}; {len(snapshot["sets"])} synthetic sets; sha256 {digest}')
    if snapshot.get('quality_check'):
        print('DATA QUALITY: accepted incoming batch; rules sha256 ' + snapshot['quality_check']['rules_sha256'])
