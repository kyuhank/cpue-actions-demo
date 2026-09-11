"""Rebuild the account-free, local browser calculation companion."""
from pathlib import Path
import json
import sqlite3
ROOT = Path(__file__).resolve().parents[1]
with sqlite3.connect(ROOT / 'data/toy-fishery.sqlite') as db:
    data = {'sets': [list(x) for x in db.execute('SELECT * FROM sets ORDER BY set_id')], 'removals': [list(x) for x in db.execute('SELECT * FROM removals ORDER BY year')]}
data['choice'] = 'both'
shell = (ROOT / 'docs/template-browser.html').read_text()
for key, value in {'CSS': (ROOT / 'docs/demo.css').read_text(), 'JS': (ROOT / 'docs/demo.js').read_text(), 'DATA': json.dumps(data,separators=(',',':'))}.items():
    shell = shell.replace('@@'+key+'@@',value)
(ROOT / 'docs/browser.html').write_text(shell)
