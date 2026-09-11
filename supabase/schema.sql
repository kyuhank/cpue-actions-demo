-- Synthetic workshop data only. Run once in a new Supabase Free project.
begin;
create table public.cpue_releases (
  version integer primary key check (version between 2023 and 2035),
  created_at timestamptz not null default now()
);
create table public.cpue_sets (
  set_id text primary key, year integer not null, vessel text not null,
  hooks integer not null check (hooks > 0), catch_n integer not null check (catch_n >= 0),
  added_version integer not null references public.cpue_releases(version) deferrable initially deferred
);
create table public.cpue_catches (
  year integer primary key, catch_t numeric not null check (catch_t >= 0),
  added_version integer not null references public.cpue_releases(version) deferrable initially deferred
);
alter table public.cpue_releases enable row level security;
alter table public.cpue_sets enable row level security;
alter table public.cpue_catches enable row level security;
revoke all on public.cpue_releases, public.cpue_sets, public.cpue_catches from anon, authenticated;

create function public.cpue_immutable() returns trigger language plpgsql as $$
begin raise exception 'Published workshop records are immutable'; end;
$$;
create trigger cpue_sets_immutable before update or delete on public.cpue_sets
for each row execute function public.cpue_immutable();
create trigger cpue_catches_immutable before update or delete on public.cpue_catches
for each row execute function public.cpue_immutable();
create trigger cpue_releases_immutable before update or delete on public.cpue_releases
for each row execute function public.cpue_immutable();

create function public.cpue_unpublished_only() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if exists(select 1 from public.cpue_releases where version=new.added_version) then
    raise exception 'Cannot add records to a published version';
  end if;
  return new;
end;
$$;
create trigger cpue_sets_unpublished before insert on public.cpue_sets
for each row execute function public.cpue_unpublished_only();
create trigger cpue_catches_unpublished before insert on public.cpue_catches
for each row execute function public.cpue_unpublished_only();

create function public.cpue_snapshot(p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v integer;
begin
  select coalesce(p_version, max(version)) into v from public.cpue_releases;
  if not exists(select 1 from public.cpue_releases where version=v) then
    raise exception 'Unknown published snapshot';
  end if;
  return jsonb_build_object('version',v,
    'sets',(select jsonb_agg(jsonb_build_array(set_id,year,vessel,hooks,catch_n) order by set_id)
            from public.cpue_sets where added_version<=v),
    'removals',(select jsonb_agg(jsonb_build_array(year,catch_t) order by year)
                from public.cpue_catches where added_version<=v));
end;
$$;
revoke all on function public.cpue_snapshot(integer) from public;
-- Anonymous reads expose only this deliberately public, synthetic snapshot.
grant execute on function public.cpue_snapshot(integer) to anon, authenticated, service_role;

create function public.cpue_append_year(p_year integer, p_sets jsonb, p_catch numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare expected integer;
begin
  perform pg_advisory_xact_lock(260612);
  select max(version)+1 into expected from public.cpue_releases;
  if expected is null or p_year != expected or p_year>2035 then
    raise exception 'Append the next synthetic year only';
  end if;
  if jsonb_typeof(p_sets)!='array' or jsonb_array_length(p_sets) not between 1 and 400
     or p_catch is null or p_catch<0 then raise exception 'Invalid synthetic batch'; end if;
  if exists(select 1 from jsonb_array_elements(p_sets) r
            where jsonb_array_length(r)!=5 or (r->>1)::integer != p_year
               or length(r->>0)>64 or length(r->>2)>64) then
    raise exception 'Batch contains invalid records';
  end if;
  insert into public.cpue_sets
    select r->>0,(r->>1)::integer,r->>2,(r->>3)::integer,(r->>4)::integer,p_year
    from jsonb_array_elements(p_sets) r;
  insert into public.cpue_catches values(p_year,p_catch,p_year);
  -- The webhook fires on this release; pg_net sends it after the transaction commits.
  insert into public.cpue_releases(version) values(p_year);
  return jsonb_build_object('version',p_year,'rows_added',jsonb_array_length(p_sets));
end;
$$;
revoke all on function public.cpue_append_year(integer,jsonb,numeric) from public, anon, authenticated;
grant execute on function public.cpue_append_year(integer,jsonb,numeric) to service_role;
commit;
