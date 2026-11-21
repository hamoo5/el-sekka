begin;

-- Keep an inaccessible audit archive before retiring legacy point-to-point data.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.legacy_uber_archive (
  id bigint generated always as identity primary key,
  source_table text not null,
  archived_at timestamptz not null default now(),
  row_data jsonb not null
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'trip_requests',
    'trip_offers',
    'trip_conversations',
    'trip_messages',
    'trip_chat_audio_cleanup',
    'trip_tracking_links',
    'driver_locations',
    'trip_pricing_rules'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format(
        'insert into private.legacy_uber_archive(source_table,row_data) select %L,to_jsonb(t) from public.%I t',
        'public.' || v_table,
        v_table
      );
    end if;
  end loop;
end;
$$;

-- Stop the scheduled job that called the retired audio-cleanup endpoint.
do $$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'trip-audio-cleanup'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

-- Remove the old cleanup token; it is no longer used by any service.
delete from vault.secrets where name = 'trip_audio_cleanup_token';

-- Remove storage access policies for the old trip voice-message bucket.
drop policy if exists trip_audio_insert_sender on storage.objects;
drop policy if exists trip_audio_read_participants on storage.objects;
drop policy if exists trip_audio_delete_own_upload on storage.objects;

do $
begin
  if exists (select 1 from storage.objects where bucket_id = 'trip-audio') then
    raise exception 'trip_audio_bucket_not_empty';
  end if;
  -- Storage protects bucket deletion from SQL. Keep this empty private bucket
  -- inert after removing every policy; it has no objects and no application use.
  update storage.buckets set public = false where id = 'trip-audio';
end;
$;

-- The generic reports table also supports shared-seat bookings; remove only its
-- legacy point-to-point reference.
alter table public.reports
  drop constraint if exists reports_trip_request_id_fkey;
alter table public.reports
  drop column if exists trip_request_id;

-- Retire the old fixed-trip and tracking RPCs.
drop function if exists public.server_create_fixed_trip_request(
  uuid,text,text,double precision,double precision,text,double precision,double precision,
  timestamptz,boolean,integer,numeric
);
drop function if exists public.server_create_fixed_trip_request(
  uuid,text,text,double precision,double precision,text,double precision,double precision,
  timestamptz,boolean,integer,numeric,text,jsonb
);
drop function if exists public.server_create_fixed_trip_request(
  uuid,text,text,double precision,double precision,text,double precision,double precision,
  timestamptz,boolean,integer,numeric,text,jsonb,boolean
);
drop function if exists public.calculate_fixed_trip_fare(text,numeric);
drop function if exists public.captain_accept_fixed_trip(uuid,uuid);
drop function if exists public.captain_start_fixed_trip(uuid);
drop function if exists public.captain_complete_fixed_trip(uuid);
drop function if exists public.passenger_cancel_fixed_trip(uuid);
drop function if exists public.captain_update_fixed_trip_location(uuid,double precision,double precision,double precision);
drop function if exists public.get_trip_counterparty_name(uuid);
drop function if exists public.verify_trip_audio_cleanup_token(text);

-- Keep account-boundary checks for the new shared-road tables only.
create or replace function public.enforce_rider_captain_boundaries()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_type text;
begin
  if tg_table_name = 'share_route_requests' then
    select account_type into v_type from public.profiles where id = new.requester_id;
    if v_type is distinct from 'rider' then raise exception 'rider_account_required'; end if;
  elsif tg_table_name = 'bookings' then
    select account_type into v_type from public.profiles where id = new.passenger_id;
    if v_type is distinct from 'rider' then raise exception 'rider_account_required'; end if;
  elsif tg_table_name = 'captain_applications' then
    select account_type into v_type from public.profiles where id = new.user_id;
    if v_type is distinct from 'captain' then raise exception 'captain_account_required'; end if;
  elsif tg_table_name in ('vehicles', 'rides') then
    select account_type into v_type from public.profiles where id = new.captain_id;
    if v_type is distinct from 'captain' then raise exception 'captain_account_required'; end if;
  end if;
  return new;
end;
$function$;

-- Keep service validation for shared-road features; there is no fixed-trip branch.
create or replace function public.enforce_sekka_service_vehicle_types()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_vehicle_type text;
  v_vehicle_owner uuid;
  v_preferred_type text;
begin
  if tg_table_name = 'share_route_requests' then
    if new.preferred_vehicle_type is not null
       and new.preferred_vehicle_type not in ('private_car','suzuki','microbus') then
      raise exception 'vehicle_type_not_allowed_for_shared_trip' using errcode = '23514';
    end if;
  elsif tg_table_name = 'rides' then
    select v.vehicle_type, v.captain_id
      into v_vehicle_type, v_vehicle_owner
    from public.vehicles v
    where v.id = new.vehicle_id;
    if not found then
      raise exception 'shared_ride_vehicle_not_found' using errcode = '23503';
    end if;
    if v_vehicle_owner is distinct from new.captain_id then
      raise exception 'shared_ride_vehicle_owner_mismatch' using errcode = '23514';
    end if;
    if v_vehicle_type not in ('private_car','suzuki','microbus') then
      raise exception 'vehicle_type_not_allowed_for_shared_trip' using errcode = '23514';
    end if;
  elsif tg_table_name = 'bookings' then
    select v.vehicle_type into v_vehicle_type
    from public.rides r
    join public.vehicles v on v.id = r.vehicle_id
    where r.id = new.ride_id;
    if not found or v_vehicle_type not in ('private_car','suzuki','microbus') then
      raise exception 'seat_booking_requires_shared_vehicle' using errcode = '23514';
    end if;
  elsif tg_table_name = 'share_route_negotiations' then
    select v.vehicle_type, sr.preferred_vehicle_type
      into v_vehicle_type, v_preferred_type
    from public.vehicles v
    join public.share_route_requests sr on sr.id = new.request_id
    where v.id = new.vehicle_id;
    if not found
       or v_vehicle_type not in ('private_car','suzuki','microbus')
       or (v_preferred_type is not null and v_vehicle_type <> v_preferred_type) then
      raise exception 'negotiation_requires_matching_shared_vehicle' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

-- Restrict all newly registered and stored vehicles to the three approved classes.
alter table public.vehicles
  drop constraint if exists vehicles_vehicle_type_sekka_only_chk;
alter table public.vehicles
  add constraint vehicles_vehicle_type_sekka_only_chk
  check (vehicle_type in ('private_car','suzuki','microbus'));

alter table public.share_route_requests
  drop constraint if exists share_route_requests_vehicle_type_sekka_only_chk;
alter table public.share_route_requests
  add constraint share_route_requests_vehicle_type_sekka_only_chk
  check (preferred_vehicle_type is null or preferred_vehicle_type in ('private_car','suzuki','microbus'));

-- Tighten the current captain application RPC so its validation and capacity
-- calculation match the three approved vehicle classes.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'submit_captain_application_v3'
    and p.prokind = 'f';

  if v_definition is null then
    raise exception 'submit_captain_application_v3_not_found';
  end if;

  v_definition := replace(
    v_definition,
    'p_vehicle_type not in (''private_car'',''taxi'',''suzuki'',''microbus'',''scooter'',''motorcycle'')',
    'p_vehicle_type not in (''private_car'',''suzuki'',''microbus'')'
  );
  v_definition := replace(
    v_definition,
    'v_cap := case p_vehicle_type when ''private_car'' then 3 when ''taxi'' then 4 when ''suzuki'' then 6 when ''microbus'' then 13 when ''scooter'' then 1 when ''motorcycle'' then 1 end;',
    'v_cap := case p_vehicle_type when ''private_car'' then 3 when ''suzuki'' then 6 when ''microbus'' then 13 end;'
  );

  if position('p_vehicle_type not in (''private_car'',''suzuki'',''microbus'')' in v_definition) = 0
     or position('when ''taxi''' in v_definition) > 0
     or position('when ''scooter''' in v_definition) > 0
     or position('when ''motorcycle''' in v_definition) > 0 then
    raise exception 'captain_vehicle_type_rewrite_failed';
  end if;

  execute v_definition;
end;
$$;

-- Remove all dedicated tables for individual point-to-point rides and tracking.
drop table if exists public.trip_chat_audio_cleanup;
drop table if exists public.trip_messages;
drop table if exists public.trip_conversations;
drop table if exists public.trip_offers;
drop table if exists public.trip_tracking_links;
drop table if exists public.driver_locations;
drop table if exists public.trip_requests;
drop table if exists public.trip_pricing_rules;

-- Dropping these legacy tables removes their triggers and policies first.
drop function if exists public.handle_trip_request_chat_and_tracking();
drop function if exists public.release_sekka_trip_reservations_on_cancel();
drop function if exists public.process_sekka_referral_trip_completion();
drop function if exists public.reject_phone_number_in_trip_message();
drop function if exists private.captain_has_zero_completed_trips();

-- Remove the private token configuration used only by retired audio cleanup.
drop table if exists private.trip_audio_cleanup_config;

commit;
