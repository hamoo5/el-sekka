-- Daily cleanup of voice notes after a 7-day dispute window.
create extension if not exists pg_net;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table if not exists private.trip_audio_cleanup_config(token_hash text primary key,created_at timestamptz not null default now());
revoke all on private.trip_audio_cleanup_config from public,anon,authenticated,service_role;

do $$
declare v_token text;
begin
 if not exists(select 1 from vault.decrypted_secrets where name='trip_audio_cleanup_token') then
  v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  perform vault.create_secret(v_token,'trip_audio_cleanup_token','Internal authorization token for scheduled trip audio cleanup');
  insert into private.trip_audio_cleanup_config(token_hash) values(encode(extensions.digest(v_token,'sha256'),'hex'));
 end if;
end $$;

create or replace function public.verify_trip_audio_cleanup_token(p_token text)
returns boolean language sql security definer set search_path=public,private,extensions as $$
 select exists(select 1 from private.trip_audio_cleanup_config where token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex'));
$$;
revoke all on function public.verify_trip_audio_cleanup_token(text) from public,anon,authenticated;
grant execute on function public.verify_trip_audio_cleanup_token(text) to service_role;

do $$ begin
 if exists(select 1 from cron.job where jobname='trip-audio-cleanup') then
  perform cron.unschedule(jobid) from cron.job where jobname='trip-audio-cleanup';
 end if;
end $$;

select cron.schedule('trip-audio-cleanup','0 4 * * *',$job$
 select net.http_post(
  url:='https://pwrptcxytjhhkgvdqkvu.supabase.co/functions/v1/cleanup-trip-audio',
  headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='trip_audio_cleanup_token')),
  body:='{}'::jsonb
 );
$job$);
