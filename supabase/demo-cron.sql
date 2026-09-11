-- The scheduler runs in Supabase, independently of any presentation computer.
create extension if not exists pg_cron;
create or replace function workshop_private.tick_demo_cleanup() returns void
language plpgsql security definer set search_path='' as $$
declare endpoint text; token text;
begin
 select replace(url,'/dispatch-workshop','/workshop-api/api/maintenance'),secret
 into endpoint,token from workshop_private.webhook_config where id;
 if endpoint is null or token is null then return; end if;
 perform net.http_post(url:=endpoint,
   headers:=jsonb_build_object('Content-Type','application/json','X-Workshop-Webhook',token),
   body:='{}'::jsonb,timeout_milliseconds:=60000);
 delete from cron.job_run_details where jobid in
   (select jobid from cron.job where jobname='cpue-demo-cleanup') and end_time<now()-interval '1 day';
end; $$;
revoke all on function workshop_private.tick_demo_cleanup() from public,anon,authenticated;
select cron.schedule('cpue-demo-cleanup','* * * * *','select workshop_private.tick_demo_cleanup();');
