-- Two fixed historical snapshots; reset clears the added batch, not this archive.
begin;
create schema if not exists workshop_private;
create table if not exists workshop_private.saved_snapshots (
 version integer primary key check(version in (2021,2022)), payload jsonb not null
);
revoke all on workshop_private.saved_snapshots from public, anon, authenticated;
create or replace function public.cpue_archive_snapshot(p_version integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n integer; valid boolean; qc jsonb;
begin
 if p_version not in (2021,2022) then raise exception 'Unknown archive version'; end if;
 select count(*),bool_and(hooks>0 and catch_n>=0 and length(set_id)>0 and length(vessel)>0)
 into n,valid from public.cpue_sets where added_version=2023 and year<=p_version;
 if n=0 or not valid or not exists(select 1 from public.cpue_catches where year=p_version and catch_t>=0)
 or exists(select 1 from public.cpue_sets s where s.added_version=2023 and s.year<=p_version
   and not exists(select 1 from public.cpue_catches c where c.year=s.year and c.catch_t>=0))
 then raise exception 'Snapshot quality check failed'; end if;
 qc:=jsonb_build_object('accepted',true,'errors','[]'::jsonb,'proposed_version',p_version,'rows_received',n,
  'rule_version',1,'rules_sha256',encode(sha256(convert_to(pg_get_functiondef('public.cpue_archive_snapshot(integer)'::regprocedure),'UTF8')),'hex'),
  'checks',jsonb_build_array('required fields and identifiers','positive effort','nonnegative catch','matching set and catch years'));
 return jsonb_build_object('version',p_version,'quality_check',qc,
  'published_at',(select created_at from public.cpue_releases where version=2023),
  'sets',(select jsonb_agg(jsonb_build_array(set_id,year,vessel,hooks,catch_n) order by set_id)
    from public.cpue_sets where added_version=2023 and year<=p_version),
  'removals',(select jsonb_agg(jsonb_build_array(year,catch_t) order by year)
    from public.cpue_catches where added_version=2023 and year<=p_version));
end;
$$;
revoke all on function public.cpue_archive_snapshot(integer) from public,anon,authenticated;
insert into workshop_private.saved_snapshots select v,public.cpue_archive_snapshot(v) from generate_series(2021,2022) v on conflict do nothing;
drop trigger if exists saved_snapshots_immutable on workshop_private.saved_snapshots;
create trigger saved_snapshots_immutable before update or delete on workshop_private.saved_snapshots for each row execute function public.cpue_immutable();
create or replace function public.cpue_snapshot(p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v integer; saved jsonb;
begin
 select payload into saved from workshop_private.saved_snapshots where version=p_version;
 if saved is not null then return saved; end if;
 select coalesce(p_version,max(version)) into v from public.cpue_releases;
 if not exists(select 1 from public.cpue_releases where version=v) then raise exception 'Unknown published snapshot'; end if;
 return jsonb_build_object('version',v,
  'quality_check',(select quality_check from public.cpue_releases where version=v),
  'published_at',(select created_at from public.cpue_releases where version=v),
  'sets',(select jsonb_agg(jsonb_build_array(set_id,year,vessel,hooks,catch_n) order by set_id) from public.cpue_sets where added_version<=v),
  'removals',(select jsonb_agg(jsonb_build_array(year,catch_t) order by year) from public.cpue_catches where added_version<=v));
end;
$$;
commit;
