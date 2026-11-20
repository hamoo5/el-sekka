-- Add passenger pickup notes and ride preferences without replacing existing trip data.
alter table public.trip_requests
  add column if not exists pickup_note text,
  add column if not exists ride_preferences jsonb not null
    default '{"quiet":false,"ac":false,"luggage":false}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.trip_requests'::regclass and conname='trip_requests_pickup_note_length_check') then
    alter table public.trip_requests add constraint trip_requests_pickup_note_length_check
      check (pickup_note is null or char_length(pickup_note) <= 160);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.trip_requests'::regclass and conname='trip_requests_ride_preferences_object_check') then
    alter table public.trip_requests add constraint trip_requests_ride_preferences_object_check
      check (jsonb_typeof(ride_preferences) = 'object');
  end if;
end $$;

-- Keep the original, already-used RPC intact; this overload adds validated metadata.
create or replace function public.server_create_fixed_trip_request(
  p_passenger_id uuid,
  p_vehicle_type text,
  p_origin_name text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_name text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_scheduled_at timestamptz,
  p_is_scheduled boolean,
  p_passenger_count integer,
  p_distance_km numeric,
  p_pickup_note text,
  p_ride_preferences jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_preferences jsonb := coalesce(p_ride_preferences, '{"quiet":false,"ac":false,"luggage":false}'::jsonb);
begin
  if p_pickup_note is not null and char_length(btrim(p_pickup_note)) > 160 then
    raise exception 'pickup_note_too_long';
  end if;
  if jsonb_typeof(v_preferences) <> 'object'
     or (v_preferences - array['quiet','ac','luggage']) <> '{}'::jsonb
     or exists (
       select 1 from jsonb_each(v_preferences) as item(key, value)
       where jsonb_typeof(item.value) <> 'boolean'
     ) then
    raise exception 'invalid_ride_preferences';
  end if;

  v_request_id := public.server_create_fixed_trip_request(
    p_passenger_id,p_vehicle_type,p_origin_name,p_origin_lat,p_origin_lng,
    p_destination_name,p_destination_lat,p_destination_lng,p_scheduled_at,
    p_is_scheduled,p_passenger_count,p_distance_km
  );

  update public.trip_requests
  set pickup_note = nullif(btrim(p_pickup_note), ''),
      ride_preferences = '{"quiet":false,"ac":false,"luggage":false}'::jsonb || v_preferences
  where id = v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.server_create_fixed_trip_request(
  uuid,text,text,double precision,double precision,text,double precision,double precision,timestamptz,boolean,integer,numeric,text,jsonb
) from public, anon, authenticated;
grant execute on function public.server_create_fixed_trip_request(
  uuid,text,text,double precision,double precision,text,double precision,double precision,timestamptz,boolean,integer,numeric,text,jsonb
) to service_role;
