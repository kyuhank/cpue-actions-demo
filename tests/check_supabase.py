"""Check the hosted-data contract on an isolated local PostgreSQL instance."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result
snapshot = module('snapshot', ROOT / 'supabase/snapshot.py')
generator = module('make_data', ROOT / 'pipeline/make_data.py')
name = 'cpue-db-test-' + uuid.uuid4().hex[:8]
subprocess.run(['docker', 'run', '--rm', '-d', '--name', name, '--network', 'none',
                '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'], check=True, stdout=subprocess.DEVNULL)
def sql(text, ok=True):
    result = subprocess.run(['docker', 'exec', '-i', name, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            input=text.encode(), capture_output=True)
    assert (result.returncode == 0) == ok, result.stderr.decode()
    return result.stdout.decode().strip()
try:
    for _ in range(40):
        if subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            break
        time.sleep(.25)
    sql('create role anon; create role authenticated; create role service_role bypassrls;\n' + (ROOT / 'supabase/schema.sql').read_text() + (ROOT / 'supabase/seed.sql').read_text())
    sql((ROOT / 'supabase/quality-check.sql').read_text())
    sql((ROOT / 'supabase/quality-check.sql').read_text())
    sql("create table public.release_events(version integer); create function public.record_release() returns trigger language plpgsql as $$ begin insert into public.release_events values(new.version); return new; end $$; create trigger record_release after insert on public.cpue_releases for each row execute function public.record_release();")
    before = sql('set role anon; select public.cpue_snapshot(2023);')
    assert len(json.loads(before)['sets']) == 5863
    rows, catch = generator.year_records(2024)
    import copy
    invalid = []
    for column, value, code in [(3, 0, 'effort'), (3, -1, 'effort'), (3, 1.5, 'effort'),
                                (4, -1, 'set_catch'), (1, 2023, 'year_coverage'),
                                (2, '', 'identifiers'), (3, None, 'required_fields')]:
        batch = [list(row) for row in rows]; batch[0][column] = value; invalid.append((batch, code))
    invalid.extend([(rows + [rows[0]], 'duplicate_id'), ([rows[0][:-1]], 'row_shape'),
                    ([None], 'row_shape'), (None, 'batch_shape'), ([], 'batch_size')])
    for batch, code in invalid:
        body = json.dumps(batch).replace("'", "''")
        result = json.loads(sql(f"set role service_role; select public.cpue_check_year(2024,'{body}'::jsonb,{catch});"))
        assert not result['accepted'] and code in [e['code'] for e in result['errors']], result
        if code == 'effort':
            error = next(e for e in result['errors'] if e['code'] == code)
            assert error['field'] == 'hooks' and error['failed_records'] == 1
            assert error['examples'] == [{'set_id': rows[0][0], 'observed': batch[0][3]}]
        sql(f"set role service_role; select public.cpue_append_year(2024,'{body}'::jsonb,{catch});", ok=False)
        assert sql('select count(*) from public.release_events;') == '0'
        assert sql('set role anon; select public.cpue_snapshot(2023);') == before
    quoted = json.dumps(rows).replace("'", "''")
    sql(f"set role anon; select public.cpue_append_year(2024,'{quoted}'::jsonb,{catch});", ok=False)
    result = json.loads(sql(f"set role service_role; select public.cpue_append_year(2024,'{quoted}'::jsonb,{catch});"))
    assert result['version'] == 2024 and result['rows_added'] == len(rows)
    assert result['quality_check']['accepted'] and len(result['quality_check']['rules_sha256']) == 64
    assert sql('select count(*) from public.release_events;') == '1'
    assert json.loads(sql('set role anon; select public.cpue_snapshot(2024);'))['quality_check'] == result['quality_check']
    assert sql('set role anon; select public.cpue_snapshot(2023);') == before
    sql("update public.cpue_sets set catch_n=catch_n+1 where set_id='2000-0000';", ok=False)
    sql("insert into public.cpue_sets values('late-record',2000,'v01',1000,1,2023);", ok=False)
    sql(f"set role service_role; select public.cpue_append_year(2024,'{quoted}'::jsonb,{catch});", ok=False)
    with tempfile.TemporaryDirectory() as folder:
        current = json.loads(sql('set role anon; select public.cpue_snapshot(2024);'))
        first = snapshot.materialise(current, Path(folder)/'first.sqlite')
        second = snapshot.materialise(current, Path(folder)/'second.sqlite')
        assert first == second
    print('Verified: malformed, missing, duplicated and invalid records rejected before any release event; valid data publish once with QC evidence; old versions unchanged; anonymous access read-only; identical snapshot hashes.')
finally:
    subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, check=True)
