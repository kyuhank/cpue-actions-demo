"""Exercise a disposable reset against PostgreSQL, including the publication guard."""
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[1]
name = 'cpue-reset-test-' + uuid.uuid4().hex[:8]
subprocess.run(['docker','run','--rm','-d','--name',name,'--network','none',
                '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'],check=True,stdout=subprocess.DEVNULL)

def sql(query):
    return subprocess.run(['docker','exec','-i',name,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],
                          input=query,text=True,capture_output=True)

def good(query):
    r = sql(query)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()

try:
    for _ in range(40):
        if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],
                          stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0:
            break
        time.sleep(.25)
    good('create role anon;create role authenticated;create role service_role;create table public.untouched(value integer);insert into public.untouched values(7);')
    for file in ['schema.sql','seed.sql','quality-check.sql','cloud-control.sql','demo-lifecycle.sql','saved-snapshots.sql']:
        good((root/'supabase'/file).read_text())
    good((root/'supabase/demo-lifecycle.sql').read_text())
    baseline = good('select public.cpue_snapshot(2023);')
    archives={v:good(f'set role anon;select public.cpue_snapshot({v})') for v in (2021,2022)}
    for v,raw in archives.items():
        item=json.loads(raw);assert item['version']==v and item['quality_check']['accepted']
        assert max(row[1] for row in item['sets'])==v
        assert len(item['sets'])<len(json.loads(baseline)['sets'])
    assert sql('set role anon;select * from workshop_private.saved_snapshots').returncode!=0
    for query in ["select public.workshop_demo_state()","select public.workshop_demo_claim_reset(101)",
                  "select public.workshop_demo_finish_reset(101)"]:
        assert sql('set role anon;' + query).returncode != 0
    assert sql('set role service_role;select public.workshop_demo_finish_reset(101)').returncode != 0
    request = str(uuid.uuid4())
    good(f"select public.workshop_reserve('{request}','data');select public.workshop_demo_start('{request}');")
    good("set role service_role;select public.cpue_append_year(2024,'[[\"demo-new-set\",2024,\"v01\",1000,3]]',25);")
    assert good('select public.workshop_dispatch_claim(2024)') == 't'
    good(f"select public.workshop_finish('{request}','{{\"published\":true,\"previous_run\":null}}');")
    good("create table public.test_clock(value timestamptz);insert into public.test_clock values(now());select public.workshop_demo_observe(101,(select value from public.test_clock));")
    assert float(good("select extract(epoch from(reset_at-(select value from public.test_clock))) from workshop_private.cloud_demo")) == 600
    assert good('select public.workshop_demo_claim_reset(101)') == 'f'
    good("update workshop_private.cloud_demo set reset_at=now()-interval '1 second';")
    assert good('select public.workshop_demo_claim_reset(101)') == 't'
    assert good('select public.workshop_demo_claim_reset(101)') == 'f'
    assert sql(f"select public.workshop_reserve('{uuid.uuid4()}','data')").returncode != 0
    good("select public.workshop_cache_put('status','{}',3600);select public.workshop_cache_put('output:101:manifest.json','{}',3600);select public.workshop_cache_put('unrelated','7',3600);")
    good('set role service_role;select public.workshop_demo_finish_reset(101)')
    assert good('select count(*) from workshop_private.cloud_dispatches') == '0'
    assert good("select key from workshop_private.cloud_cache") == 'unrelated'
    assert good('select public.cpue_snapshot(2023)') == baseline
    for v,raw in archives.items():assert good(f'select public.cpue_snapshot({v})')==raw
    assert good('select max(version) from public.cpue_releases') == '2023'
    assert json.loads(good('select public.workshop_state()'))['remaining'] == 59
    assert json.loads(good('select public.workshop_demo_state()'))['phase'] == 'idle'
    assert good('select value from public.untouched') == '7'
    assert sql('delete from public.cpue_releases where version=2023').returncode != 0
    good("set role service_role;select public.cpue_append_year(2024,'[[\"demo-new-set\",2024,\"v01\",1000,3]]',25);")
    assert good('select public.workshop_dispatch_claim(2024)') == 't'
    print('Reset: 600-second deadline, no early/anonymous reset, baseline restored exactly, publication guard and daily limits retained; another 2024 release is accepted.')
finally:
    subprocess.run(['docker','rm','-f',name],check=True,stdout=subprocess.DEVNULL)
