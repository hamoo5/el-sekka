-- El Sekka: scheduled trips with passenger/captain price negotiation.
-- Additive only: preserves existing tables, rows, fixed-trip flow, and ride-sharing tables.

create table if not exists public.scheduled_trip_price_offers (
  id uuid primary key default gen_random_uuid(),
  trip_request_id uuid not null references public.trip_requests(id) on delete cascade,
  offered_by uuid not null references public.profiles(id),
  offered_by_role text not null check (offered_by_role in ('passenger','captain')),
  vehicle_id uuid null references public.vehicles(id),
  amount_egp numeric(10,2) not null check (amount_egp > 0),
  offer_status text not null default 'pending'
    check (offer_status in ('pending','accepted','countered','rejected')),
  created_at timestamptz not null default now(),
  constraint scheduled_offer_vehicle_role_check
    check ((offered_by_role = 'passenger' and vehicle_id is null)
        or (offered_by_role = 'captain' and vehicle_id is not null))
);

create unique index if not exists scheduled_trip_one_pending_offer
  on public.scheduled_trip_price_offers(trip_request_id)
  where offer_status = 'pending';

create index if not exists scheduled_trip_offers_request_created
  on public.scheduled_trip_price_offers(trip_request_id, created_at desc);

alter table public.scheduled_trip_price_offers enable row level security;

drop policy if exists scheduled_trip_price_offers_read_participants
  on public.scheduled_trip_price_offers;
create policy scheduled_trip_price_offers_read_participants
  on public.scheduled_trip_price_offers
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.trip_requests tr
      where tr.id = trip_request_id
        and (tr.passenger_id = auth.uid() or tr.accepted_captain_id = auth.uid())
    )
    or exists (
      select 1 from public.trip_requests tr
      where tr.id = trip_request_id
        and tr.request_status = 'searching'
        and offered_by_role = 'captain'
        and offered_by = auth.uid()
    )
  );

revoke all on table public.scheduled_trip_price_offers from anon, authenticated;
grant select on table public.scheduled_trip_price_offers to authenticated;

create or replace function public.server_create_scheduled_trip_request(
  p_passenger_id uuid,
  p_vehicle_type text,
  p_origin_name text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_name text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_scheduled_at timestamptz,
  p_passenger_count integer,
  p_distance_km numeric,
  p_initial_offer_egp numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_capacity integer;
begin
  if p_passenger_id is null then raise exception 'passenger_required'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_passenger_id and role = 'passenger' and is_blocked = false
  ) then raise exception 'passenger_not_eligible'; end if;

  v_capacity := case p_vehicle_type
    when 'private_car' then 3 when 'taxi' then 4
    when 'suzuki' then 6 when 'microbus' then 13
    when 'scooter' then 1 when 'motorcycle' then 1 else null end;
  if v_capacity is null then raise exception 'invalid_vehicle_type'; end if;
  if coalesce(trim(p_origin_name),'') = '' or coalesce(trim(p_destination_name),'') = '' then
    raise exception 'location_required';
  end if;
  if length(p_origin_name) > 300 or length(p_destination_name) > 300 then
    raise exception 'location_too_long';
  end if;
  if p_origin_lat is null or p_origin_lng is null or p_destination_lat is null or p_destination_lng is null
     or p_origin_lat not between -90 and 90 or p_destination_lat not between -90 and 90
     or p_origin_lng not between -180 and 180 or p_destination_lng not between -180 and 180 then
    raise exception 'invalid_coordinates';
  end if;
  if p_passenger_count is null or p_passenger_count < 1 or p_passenger_count > v_capacity then
    raise exception 'invalid_passenger_count';
  end if;
  if p_scheduled_at is null or p_scheduled_at <= now() then raise exception 'invalid_scheduled_at'; end if;
  if p_distance_km is null or p_distance_km <= 0 or p_distance_km > 500 then raise exception 'invalid_distance'; end if;
  if p_initial_offer_egp is null or p_initial_offer_egp <= 0 or p_initial_offer_egp > 100000 then
    raise exception 'invalid_initial_offer';
  end if;

  insert into public.trip_requests (
    passenger_id, vehicle_type, origin_name, origin_lat, origin_lng,
    destination_name, destination_lat, destination_lng, scheduled_at,
    is_scheduled, passenger_count, fixed_fare_egp, request_status
  ) values (
    p_passenger_id, p_vehicle_type, trim(p_origin_name), p_origin_lat, p_origin_lng,
    trim(p_destination_name), p_destination_lat, p_destination_lng, p_scheduled_at,
    true, p_passenger_count, null, 'searching'
  ) returning id into v_request_id;

  insert into public.scheduled_trip_price_offers (
    trip_request_id, offered_by, offered_by_role, vehicle_id, amount_egp, offer_status
  ) values (
    v_request_id, p_passenger_id, 'passenger', null, p_initial_offer_egp, 'pending'
  );

  return v_request_id;
end;
$$;

revoke all on function public.server_create_scheduled_trip_request(
  uuid,text,text,double precision,double precision,text,double precision,double precision,
  timestamptz,integer,numeric,numeric
) from public, anon, authenticated;
grant execute on function public.server_create_scheduled_trip_request(
  uuid,text,text,double precision,double precision,text,double precision,double precision,
  timestamptz,integer,numeric,numeric
) to service_role;

create or replace function public.captain_counter_scheduled_trip_offer(
  p_request_id uuid,
  p_vehicle_id uuid,
  p_amount_egp numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_captain_id uuid := auth.uid();
  v_request public.trip_requests%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_offer_id uuid;
begin
  if v_captain_id is null then raise exception 'login_required'; end if;
  perform public.require_captain_ready(v_captain_id);

  select * into v_request from public.trip_requests
  where id = p_request_id for update;
  if not found or v_request.is_scheduled is not true or v_request.request_status <> 'searching' then
    raise exception 'scheduled_request_unavailable';
  end if;
  if v_request.passenger_id = v_captain_id then raise exception 'own_request_not_allowed'; end if;
  if p_amount_egp is null or p_amount_egp <= 0 or p_amount_egp > 100000 then
    raise exception 'invalid_offer_amount';
  end if;

  select * into v_vehicle from public.vehicles
  where id = p_vehicle_id and captain_id = v_captain_id
    and vehicle_type = v_request.vehicle_type
    and approval_status = 'approved' and is_active = true
    and passenger_capacity >= v_request.passenger_count
  for update;
  if not found then raise exception 'vehicle_not_eligible'; end if;

  if not exists (
    select 1 from public.scheduled_trip_price_offers
    where trip_request_id = p_request_id and offer_status = 'pending'
      and offered_by_role = 'passenger'
  ) then raise exception 'passenger_offer_not_pending'; end if;

  update public.scheduled_trip_price_offers
  set offer_status = 'countered'
  where trip_request_id = p_request_id and offer_status = 'pending';

  insert into public.scheduled_trip_price_offers(
    trip_request_id, offered_by, offered_by_role, vehicle_id, amount_egp, offer_status
  ) values (p_request_id, v_captain_id, 'captain', p_vehicle_id, p_amount_egp, 'pending')
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;

create or replace function public.passenger_counter_scheduled_trip_offer(
  p_request_id uuid,
  p_amount_egp numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.trip_requests%rowtype;
  v_offer_id uuid;
begin
  if v_user_id is null then raise exception 'login_required'; end if;
  select * into v_request from public.trip_requests
  where id = p_request_id for update;
  if not found or v_request.passenger_id <> v_user_id
     or v_request.is_scheduled is not true or v_request.request_status <> 'searching' then
    raise exception 'scheduled_request_unavailable';
  end if;
  if p_amount_egp is null or p_amount_egp <= 0 or p_amount_egp > 100000 then
    raise exception 'invalid_offer_amount';
  end if;
  if not exists (
    select 1 from public.scheduled_trip_price_offers
    where trip_request_id = p_request_id and offer_status = 'pending'
      and offered_by_role = 'captain'
  ) then raise exception 'captain_offer_not_pending'; end if;

  update public.scheduled_trip_price_offers
  set offer_status = 'countered'
  where trip_request_id = p_request_id and offer_status = 'pending';

  insert into public.scheduled_trip_price_offers(
    trip_request_id, offered_by, offered_by_role, vehicle_id, amount_egp, offer_status
  ) values (p_request_id, v_user_id, 'passenger', null, p_amount_egp, 'pending')
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;

create or replace function public.respond_scheduled_trip_offer(
  p_offer_id uuid,
  p_vehicle_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_offer public.scheduled_trip_price_offers%rowtype;
  v_request public.trip_requests%rowtype;
  v_captain_id uuid;
  v_vehicle_id uuid;
  v_vehicle public.vehicles%rowtype;
begin
  if v_user_id is null then raise exception 'login_required'; end if;

  select * into v_offer from public.scheduled_trip_price_offers
  where id = p_offer_id for update;
  if not found or v_offer.offer_status <> 'pending' then raise exception 'offer_not_pending'; end if;

  select * into v_request from public.trip_requests
  where id = v_offer.trip_request_id for update;
  if not found or v_request.is_scheduled is not true or v_request.request_status <> 'searching' then
    raise exception 'scheduled_request_unavailable';
  end if;

  if v_offer.offered_by_role = 'captain' then
    if v_user_id <> v_request.passenger_id then raise exception 'only_passenger_can_accept'; end if;
    v_captain_id := v_offer.offered_by;
    v_vehicle_id := v_offer.vehicle_id;
  else
    if v_user_id = v_request.passenger_id then raise exception 'captain_must_accept_passenger_offer'; end if;
    perform public.require_captain_ready(v_user_id);
    if p_vehicle_id is null then raise exception 'vehicle_required'; end if;
    select * into v_vehicle from public.vehicles
    where id = p_vehicle_id and captain_id = v_user_id
      and vehicle_type = v_request.vehicle_type
      and approval_status = 'approved' and is_active = true
      and passenger_capacity >= v_request.passenger_count
    for update;
    if not found then raise exception 'vehicle_not_eligible'; end if;
    v_captain_id := v_user_id;
    v_vehicle_id := p_vehicle_id;
  end if;

  update public.trip_requests
  set request_status = 'accepted',
      accepted_captain_id = v_captain_id,
      accepted_vehicle_id = v_vehicle_id,
      fixed_fare_egp = v_offer.amount_egp
  where id = v_request.id and request_status = 'searching';
  if not found then raise exception 'request_already_accepted'; end if;

  update public.scheduled_trip_price_offers
  set offer_status = case when id = p_offer_id then 'accepted' else 'rejected' end
  where trip_request_id = v_request.id and offer_status = 'pending';
  return true;
end;
$$;

revoke all on function public.captain_counter_scheduled_trip_offer(uuid,uuid,numeric) from public, anon;
revoke all on function public.passenger_counter_scheduled_trip_offer(uuid,numeric) from public, anon;
revoke all on function public.respond_scheduled_trip_offer(uuid,uuid) from public, anon;
grant execute on function public.captain_counter_scheduled_trip_offer(uuid,uuid,numeric) to authenticated;
grant execute on function public.passenger_counter_scheduled_trip_offer(uuid,numeric) to authenticated;
grant execute on function public.respond_scheduled_trip_offer(uuid,uuid) to authenticated;

-- Remove unnecessary table-level capabilities; admin price editing remains protected by RLS.
revoke references, trigger, truncate on table public.trip_pricing_rules from anon, authenticated;
