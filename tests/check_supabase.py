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
    before = sql('set role anon; select public.cpue_snapshot(2023);')
    assert len(json.loads(before)['sets']) == 5863
    rows, catch = generator.year_records(2024)
    quoted = json.dumps(rows).replace("'", "''")
    sql(f"set role anon; select public.cpue_append_year(2024,'{quoted}'::jsonb,{catch});", ok=False)
    result = json.loads(sql(f"set role service_role; select public.cpue_append_year(2024,'{quoted}'::jsonb,{catch});"))
    assert result['version'] == 2024 and result['rows_added'] == len(rows)
    assert sql('set role anon; select public.cpue_snapshot(2023);') == before
    sql("update public.cpue_sets set catch_n=catch_n+1 where set_id='2000-0000';", ok=False)
    sql("insert into public.cpue_sets values('late-record',2000,'v01',1000,1,2023);", ok=False)
    sql(f"set role service_role; select public.cpue_append_year(2024,'{quoted}'::jsonb,{catch});", ok=False)
    with tempfile.TemporaryDirectory() as folder:
        current = json.loads(sql('set role anon; select public.cpue_snapshot(2024);'))
        first = snapshot.materialise(current, Path(folder)/'first.sqlite')
        second = snapshot.materialise(current, Path(folder)/'second.sqlite')
        assert first == second
    print('Verified PostgreSQL append, anonymous read-only access, immutable old versions, duplicate rejection and identical snapshot hashes.')
finally:
    subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, check=True)
