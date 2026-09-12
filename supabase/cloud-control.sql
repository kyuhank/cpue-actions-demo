-- Atomic limits and an audit trail for the public synthetic demonstration.
begin;
create schema if not exists workshop_private;
revoke all on schema workshop_private from public, anon, authenticated;
create table if not exists workshop_private.cloud_requests (
  id uuid primary key, kind text not null, created_at timestamptz not null default now(),
  finished_at timestamptz, result jsonb
);
create table if not exists workshop_private.cloud_cache (
  key text primary key, value jsonb not null, expires_at timestamptz not null
);
create table if not exists workshop_private.cloud_demo (
  id boolean primary key default true check(id),
  phase text not null default 'idle' check(phase in ('idle','active','cleaning')),
  run_id bigint, reset_at timestamptz, last_reset_at timestamptz,
  generation integer not null default 0
);
insert into workshop_private.cloud_demo(id) values(true) on conflict do nothing;
alter table workshop_private.cloud_demo add column if not exists cleanup_until timestamptz;
revoke all on all tables in schema workshop_private from public, anon, authenticated;
create or replace function public.workshop_reserve(p_id uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous workshop_private.cloud_requests; total integer; latest timestamptz;
begin
 perform pg_advisory_xact_lock(260913);
 if exists(select 1 from workshop_private.cloud_demo where phase='cleaning') then
   raise exception 'The demonstration is being reset';
 end if;
 if p_kind not in ('data','invalid','extract','prepare_vessel','prepare_year','synthesis','report','cpue_vessel','cpue_year','cpue_summary','cpue_report','assessment_vessel_ref',
   'assessment_vessel_high_m','assessment_year_ref','assessment_year_high_m') then raise exception 'Unknown action'; end if;
 select * into previous from workshop_private.cloud_requests where id=p_id;
 if found then return jsonb_build_object('duplicate',true,'result',previous.result); end if;
 select count(*),max(created_at) into total,latest from workshop_private.cloud_requests where created_at>=date_trunc('day',now());
 if total>=60 then raise exception 'Daily demonstration limit reached'; end if;
 if latest>now()-interval '30 seconds' then raise exception 'Wait for the current demonstration before updating again'; end if;
 if exists(select 1 from workshop_private.cloud_requests where finished_at is null and created_at>now()-interval '10 minutes') then raise exception 'A demonstration request is already being processed'; end if;
 insert into workshop_private.cloud_requests(id,kind) values(p_id,p_kind);
 return jsonb_build_object('duplicate',false);
end; $$;
create or replace function public.workshop_finish(p_id uuid, p_result jsonb) returns void
language sql security definer set search_path='' as $$
 update workshop_private.cloud_requests set result=p_result,finished_at=now() where id=p_id and finished_at is null;
$$;
create or replace function public.workshop_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('remaining', greatest(0,60-(select count(*) from workshop_private.cloud_requests where created_at>=date_trunc('day',now()))),
 'next_update', (select max(created_at)+interval '30 seconds' from workshop_private.cloud_requests),
 'last_request', (select jsonb_build_object('kind',kind,'created_at',created_at,'result',result) from workshop_private.cloud_requests order by created_at desc limit 1));
$$;
create or replace function public.workshop_cache_get(p_key text) returns jsonb
language sql stable security definer set search_path='' as $$
 select value from workshop_private.cloud_cache where key=p_key and expires_at>now();
$$;
create or replace function public.workshop_cache_put(p_key text,p_value jsonb,p_seconds integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from workshop_private.cloud_cache where expires_at<now();
 insert into workshop_private.cloud_cache values(p_key,p_value,now()+make_interval(secs=>least(p_seconds,86400)))
 on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at;
end; $$;
revoke all on function public.workshop_reserve(uuid,text),public.workshop_finish(uuid,jsonb),public.workshop_state(),
 public.workshop_cache_get(text),public.workshop_cache_put(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.workshop_reserve(uuid,text),public.workshop_finish(uuid,jsonb),public.workshop_state(),
 public.workshop_cache_get(text),public.workshop_cache_put(text,jsonb,integer) to service_role;
create table if not exists workshop_private.cloud_dispatches(version integer primary key,created_at timestamptz default now());
revoke all on workshop_private.cloud_dispatches from public,anon,authenticated;
create or replace function public.workshop_dispatch_claim(p_version integer) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.cpue_releases where version=p_version) then raise exception 'Unknown release'; end if;
 insert into workshop_private.cloud_dispatches(version) values(p_version) on conflict do nothing;
 return found;
end; $$;
revoke all on function public.workshop_dispatch_claim(integer) from public,anon,authenticated;
grant execute on function public.workshop_dispatch_claim(integer) to service_role;
commit;
