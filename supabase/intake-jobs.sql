-- Atomically publish a checked batch and acknowledge its existing workflow.
begin;
create or replace function public.workshop_load_batch(p_sets jsonb,p_catch numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(260914);
 if exists(select 1 from public.cpue_releases where version=2024) then
   return jsonb_build_object('version',2024,'replayed',true);
 end if;
 result:=public.cpue_append_year(2024,p_sets,p_catch);
 perform public.workshop_dispatch_claim(2024);
 return result;
end; $$;
revoke all on function public.workshop_load_batch(jsonb,numeric) from public,anon,authenticated;
grant execute on function public.workshop_load_batch(jsonb,numeric) to service_role;
commit;
