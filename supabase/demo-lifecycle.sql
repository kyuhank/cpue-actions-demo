-- Only the disposable synthetic workshop state is reset. Daily limits survive.
begin;
create or replace function public.workshop_demo_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(d)-'id' from workshop_private.cloud_demo d where id;
$$;

create or replace function public.workshop_demo_start(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(260913);
 if not exists(select 1 from workshop_private.cloud_requests where id=p_request and finished_at is null)
   or exists(select 1 from workshop_private.cloud_demo where phase='cleaning') then
   raise exception 'No active demonstration request';
 end if;
 update workshop_private.cloud_demo set phase='active',reset_at=null where id;
end; $$;

create or replace function public.workshop_demo_observe(p_run bigint,p_completed timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(260913);
 if p_run<=0 then raise exception 'Invalid run'; end if;
 update workshop_private.cloud_demo set phase='active',run_id=p_run,
   reset_at=case when p_completed is null then null else p_completed+interval '10 minutes' end
 where id and phase!='cleaning';
end; $$;

create or replace function public.workshop_demo_claim_reset(p_run bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare d workshop_private.cloud_demo;
begin
 perform pg_advisory_xact_lock(260913);
 select * into d from workshop_private.cloud_demo where id;
 if d.run_id is distinct from p_run then return false; end if;
 if d.phase='cleaning' and d.cleanup_until>now() then return false; end if;
 if d.phase!='cleaning' and (d.reset_at is null or d.reset_at>now()) then return false; end if;
 if exists(select 1 from workshop_private.cloud_requests where finished_at is null and created_at>now()-interval '10 minutes') then return false; end if;
 update workshop_private.cloud_demo set phase='cleaning',cleanup_until=now()+interval '3 minutes' where id;
 return true;
end; $$;

create or replace function public.workshop_demo_finish_reset(p_run bigint) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(260913);
 perform pg_advisory_xact_lock(260612);
 if not exists(select 1 from workshop_private.cloud_demo where id and phase='cleaning' and run_id=p_run) then
   raise exception 'No claimed demonstration reset';
 end if;
 if not exists(select 1 from public.cpue_releases where version=2023) then
   raise exception 'Synthetic baseline is missing';
 end if;
 -- The publication guard remains active during normal analysis. This explicitly
 -- authorised demo cleanup removes only synthetic additions after the baseline.
 alter table public.cpue_sets disable trigger cpue_sets_immutable;
 alter table public.cpue_catches disable trigger cpue_catches_immutable;
 alter table public.cpue_releases disable trigger cpue_releases_immutable;
 delete from public.cpue_sets where added_version>2023;
 delete from public.cpue_catches where added_version>2023;
 delete from public.cpue_releases where version>2023;
 set constraints all immediate;
 alter table public.cpue_sets enable trigger cpue_sets_immutable;
 alter table public.cpue_catches enable trigger cpue_catches_immutable;
 alter table public.cpue_releases enable trigger cpue_releases_immutable;
 delete from workshop_private.cloud_dispatches;
 delete from workshop_private.cloud_cache;
 -- Retain today's request counters so resetting cannot bypass the daily limit.
 delete from workshop_private.cloud_requests where created_at<date_trunc('day',now());
 update workshop_private.cloud_demo set phase='idle',run_id=null,reset_at=null,cleanup_until=null,
   last_reset_at=now(),generation=generation+1 where id;
end; $$;

revoke all on function public.workshop_demo_state(),public.workshop_demo_start(uuid),
 public.workshop_demo_observe(bigint,timestamptz),public.workshop_demo_claim_reset(bigint),
 public.workshop_demo_finish_reset(bigint) from public,anon,authenticated;
grant execute on function public.workshop_demo_state(),public.workshop_demo_start(uuid),
 public.workshop_demo_observe(bigint,timestamptz),public.workshop_demo_claim_reset(bigint),
 public.workshop_demo_finish_reset(bigint) to service_role;
commit;
