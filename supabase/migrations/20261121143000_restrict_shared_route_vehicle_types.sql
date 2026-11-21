-- Restrict shared-route requests to El Sekka's three supported vehicle classes.
create or replace function public.create_share_route_request(
  p_ride_mode text,
  p_origin_name text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_name text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_route_description text,
  p_departure_at timestamp with time zone,
  p_seats integer,
  p_seat_price numeric,
  p_vehicle_type text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_id uuid := auth.uid();
  v_role text;
  v_blocked boolean;
  v_request_id uuid;
begin
  if v_id is null then
    raise exception 'login_required';
  end if;

  select role, is_blocked into v_role, v_blocked
  from public.profiles where id = v_id;

  if not found or v_role not in ('passenger', 'captain') or coalesce(v_blocked, true) then
    raise exception 'account_not_allowed';
  end if;

  if p_ride_mode is null or p_ride_mode not in ('live_share', 'scheduled_share') then
    raise exception 'invalid_ride_mode';
  end if;
  if nullif(btrim(p_origin_name), '') is null
     or nullif(btrim(p_destination_name), '') is null
     or btrim(p_origin_name) = btrim(p_destination_name) then
    raise exception 'invalid_route';
  end if;
  if p_origin_lat is null or p_origin_lat not between -90 and 90
     or p_destination_lat is null or p_destination_lat not between -90 and 90
     or p_origin_lng is null or p_origin_lng not between -180 and 180
     or p_destination_lng is null or p_destination_lng not between -180 and 180 then
    raise exception 'invalid_route_coordinates';
  end if;
  if p_departure_at is null or p_departure_at < now() - interval '5 minutes' then
    raise exception 'invalid_departure_time';
  end if;
  if p_seats is null or p_seats < 1 or p_seats > 13
     or p_seat_price is null or p_seat_price < 0 then
    raise exception 'invalid_seat_request';
  end if;
  if p_vehicle_type is not null
     and p_vehicle_type not in ('private_car', 'suzuki', 'microbus') then
    raise exception 'invalid_vehicle_type';
  end if;

  insert into public.share_route_requests (
    requester_id, ride_mode, origin_name, origin_lat, origin_lng,
    destination_name, destination_lat, destination_lng, route_description,
    departure_at, preferred_vehicle_type, seats_requested, requester_seat_price_egp
  ) values (
    v_id, p_ride_mode, btrim(p_origin_name), p_origin_lat, p_origin_lng,
    btrim(p_destination_name), p_destination_lat, p_destination_lng,
    nullif(btrim(p_route_description), ''), p_departure_at,
    p_vehicle_type, p_seats, p_seat_price
  ) returning id into v_request_id;

  return v_request_id;
end;
$function$;

revoke all on function public.create_share_route_request(text,text,double precision,double precision,text,double precision,double precision,text,timestamp with time zone,integer,numeric,text) from public, anon;
grant execute on function public.create_share_route_request(text,text,double precision,double precision,text,double precision,double precision,text,timestamp with time zone,integer,numeric,text) to authenticated;
