"""Write SQL for the immutable, wholly synthetic 2000–2023 baseline."""
from pathlib import Path
import sqlite3
ROOT = Path(__file__).resolve().parents[1]
def sql(value):
    return "'" + value.replace("'", "''") + "'" if isinstance(value, str) else str(value)
with sqlite3.connect(ROOT / 'data/toy-fishery.sqlite') as db:
    sets = db.execute('SELECT * FROM sets ORDER BY set_id').fetchall()
    catches = db.execute('SELECT * FROM removals ORDER BY year').fetchall()
    version = max(row[0] for row in catches)
    lines = ['begin;']
    for table, rows in [('cpue_sets', sets), ('cpue_catches', catches)]:
        lines.append('insert into public.' + table + ' values\n' + ',\n'.join('(' + ','.join(sql(v) for v in (*row, version)) + ')' for row in rows) + ';')
    lines.extend([f'insert into public.cpue_releases(version) values({version});', 'commit;'])
(ROOT / 'supabase/seed.sql').write_text('\n'.join(lines) + '\n')
print(f'Prepared synthetic seed through {version}: {len(sets)} sets.')
