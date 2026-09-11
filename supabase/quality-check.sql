-- Validate incoming synthetic records before publishing an immutable release.
begin;
alter table public.cpue_releases add column if not exists quality_check jsonb;

create or replace function public.cpue_check_year(p_year integer, p_sets jsonb, p_catch numeric)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare errors jsonb := '[]'; expected integer; received integer := 0; result jsonb;
begin
  select max(version)+1 into expected from public.cpue_releases;
  if p_year is null or p_year is distinct from expected or p_year>2035 then
    errors := errors || jsonb_build_object('code','release_order','message','Supply the next unpublished synthetic year.');
  end if;
  if p_catch is null or p_catch<0 or p_catch::text in ('NaN','Infinity','-Infinity') then
    errors := errors || jsonb_build_object('code','annual_catch','message','Annual catch must be finite and nonnegative.');
  end if;
  if jsonb_typeof(p_sets) is distinct from 'array' then
    errors := errors || jsonb_build_object('code','batch_shape','message','Supply an array of set records.');
  else
    received := jsonb_array_length(p_sets);
    if received not between 1 and 400 then
      errors := errors || jsonb_build_object('code','batch_size','message','Supply between 1 and 400 synthetic sets.');
    elsif exists(select 1 from jsonb_array_elements(p_sets) r where jsonb_typeof(r) is distinct from 'array') then
      errors := errors || jsonb_build_object('code','row_shape','message','Each set must contain five fields.');
    elsif exists(select 1 from jsonb_array_elements(p_sets) r where jsonb_array_length(r)<>5) then
      errors := errors || jsonb_build_object('code','row_shape','message','Each set must contain five fields.');
    elsif exists(select 1 from jsonb_array_elements(p_sets) r where
      jsonb_typeof(r->0) is distinct from 'string' or jsonb_typeof(r->2) is distinct from 'string'
      or jsonb_typeof(r->1) is distinct from 'number' or jsonb_typeof(r->3) is distinct from 'number'
      or jsonb_typeof(r->4) is distinct from 'number') then
      errors := errors || jsonb_build_object('code','required_fields','message','Set ID, vessel, year, hooks and catch must be present with the expected types.');
    else
      if exists(select 1 from jsonb_array_elements(p_sets) r where
        length(btrim(r->>0)) not between 1 and 64 or length(btrim(r->>2)) not between 1 and 64) then
        errors := errors || jsonb_build_object('code','identifiers','message','Set and vessel identifiers must be nonempty and at most 64 characters.');
      end if;
      if exists(select 1 from jsonb_array_elements(p_sets) r where (r->>1)::numeric is distinct from p_year::numeric) then
        errors := errors || jsonb_build_object('code','year_coverage','message','Set years must match the submitted annual catch year.');
      end if;
      if exists(select 1 from jsonb_array_elements(p_sets) r where
        (r->>3)::numeric not between 1 and 2147483647 or mod((r->>3)::numeric,1)<>0) then
        errors := errors || jsonb_build_object('code','effort','message','Hooks must be a positive integer; zero effort is rejected.');
      end if;
      if exists(select 1 from jsonb_array_elements(p_sets) r where
        (r->>4)::numeric not between 0 and 2147483647 or mod((r->>4)::numeric,1)<>0) then
        errors := errors || jsonb_build_object('code','set_catch','message','Catch count must be a nonnegative integer; zero catches are retained.');
      end if;
      if exists(select 1 from jsonb_array_elements(p_sets) r group by r->>0 having count(*)>1)
        or exists(select 1 from jsonb_array_elements(p_sets) r join public.cpue_sets s on s.set_id=r->>0) then
        errors := errors || jsonb_build_object('code','duplicate_id','message','Set IDs must be unique within the batch and absent from published data.');
      end if;
    end if;
  end if;
  result := jsonb_build_object('accepted',jsonb_array_length(errors)=0,'errors',errors,
    'proposed_version',p_year,'rows_received',received,'rule_version',1,
    'rules_sha256',encode(sha256(convert_to(pg_get_functiondef('public.cpue_check_year(integer,jsonb,numeric)'::regprocedure),'UTF8')),'hex'),
    'checks',jsonb_build_array('required fields and types','unique set IDs','positive effort',
      'nonnegative catch; zero catches retained','matching set and catch years','next unpublished release'));
  return result;
end;
$$;
revoke all on function public.cpue_check_year(integer,jsonb,numeric) from public, anon, authenticated;
grant execute on function public.cpue_check_year(integer,jsonb,numeric) to service_role;

create or replace function public.cpue_append_year(p_year integer, p_sets jsonb, p_catch numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare qc jsonb;
begin
  perform pg_advisory_xact_lock(260612);
  qc := public.cpue_check_year(p_year,p_sets,p_catch);
  if not (qc->>'accepted')::boolean then
    raise exception 'Incoming data failed the quality check' using errcode='22023', detail=qc::text;
  end if;
  insert into public.cpue_sets
    select r->>0,(r->>1)::integer,r->>2,(r->>3)::integer,(r->>4)::integer,p_year
    from jsonb_array_elements(p_sets) r;
  insert into public.cpue_catches values(p_year,p_catch,p_year);
  insert into public.cpue_releases(version,quality_check) values(p_year,qc);
  return jsonb_build_object('version',p_year,'rows_added',jsonb_array_length(p_sets),'quality_check',qc);
end;
$$;

create or replace function public.cpue_snapshot(p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v integer;
begin
  select coalesce(p_version,max(version)) into v from public.cpue_releases;
  if not exists(select 1 from public.cpue_releases where version=v) then
    raise exception 'Unknown published snapshot';
  end if;
  return jsonb_build_object('version',v,
    'quality_check',(select quality_check from public.cpue_releases where version=v),
    'published_at',(select created_at from public.cpue_releases where version=v),
    'sets',(select jsonb_agg(jsonb_build_array(set_id,year,vessel,hooks,catch_n) order by set_id)
      from public.cpue_sets where added_version<=v),
    'removals',(select jsonb_agg(jsonb_build_array(year,catch_t) order by year)
      from public.cpue_catches where added_version<=v));
end;
$$;
commit;
