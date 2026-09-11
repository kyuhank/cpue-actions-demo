"""Verify anonymous isolation, idempotence and concurrent cloud limits in PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess,time,uuid
root=Path(__file__).resolve().parents[1];name='cpue-cloud-test-'+uuid.uuid4().hex[:8]
subprocess.run(['docker','run','--rm','-d','--name',name,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'],check=True,stdout=subprocess.DEVNULL)
def sql(query):
 return subprocess.run(['docker','exec','-i',name,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True)
def good(query):
 r=sql(query);assert r.returncode==0,r.stderr;return r.stdout.strip()
try:
 for _ in range(40):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.25)
 good('create role anon;create role authenticated;create role service_role;create table public.cpue_releases(version integer primary key);insert into public.cpue_releases values(2025);')
 good((root/'supabase/cloud-control.sql').read_text());good((root/'supabase/cloud-control.sql').read_text())
 for query in ["select public.workshop_state()", "select public.workshop_cache_get('status')", "select * from workshop_private.cloud_requests",f"select public.workshop_reserve('{uuid.uuid4()}','data')"]:
  assert sql('set role anon;'+query).returncode!=0
 ids=[str(uuid.uuid4()) for _ in range(12)]
 with ThreadPoolExecutor(max_workers=12) as pool:
  results=list(pool.map(lambda x:sql(f"set role service_role;select public.workshop_reserve('{x}','data');"),ids))
 assert sum(r.returncode==0 for r in results)==1
 winner=ids[next(i for i,r in enumerate(results) if r.returncode==0)]
 good(f"set role service_role;select public.workshop_finish('{winner}', '{{\"published\":true,\"database_version\":2025}}');")
 replay=json.loads(good(f"set role service_role;select public.workshop_reserve('{winner}','data');"))
 assert replay=={'duplicate':True,'result':{'published':True,'database_version':2025}}
 assert good('select count(*) from workshop_private.cloud_requests')=='1'
 good("update workshop_private.cloud_requests set created_at=now()-interval '1 minute';")
 second=str(uuid.uuid4());good(f"set role service_role;select public.workshop_reserve('{second}','invalid');")
 # A request that has not finished also prevents another worker from entering.
 good("update workshop_private.cloud_requests set created_at=now()-interval '1 minute';")
 assert sql(f"set role service_role;select public.workshop_reserve('{uuid.uuid4()}','data');").returncode!=0
 good(f"select public.workshop_finish('{second}', '{{\"published\":false}}');")
 good("insert into workshop_private.cloud_requests(id,kind,created_at,finished_at) select gen_random_uuid(),'data',now()-interval '2 minutes',now() from generate_series(1,58);")
 assert json.loads(good('set role service_role;select public.workshop_state()'))['remaining']==0
 assert sql(f"set role service_role;select public.workshop_reserve('{uuid.uuid4()}','data');").returncode!=0
 assert good('set role service_role;select public.workshop_dispatch_claim(2025)')=='t'
 assert good('set role service_role;select public.workshop_dispatch_claim(2025)')=='f'
 assert sql('set role service_role;select public.workshop_dispatch_claim(9999)').returncode!=0
 print('Cloud controls: only one of 12 simultaneous requests accepted; retries do not repeat writes; pending/30-second/daily-60 gates enforced; anonymous access denied; database release dispatch claimed once.')
finally:subprocess.run(['docker','rm','-f',name],check=True,stdout=subprocess.DEVNULL)
