-- El Sekka: passenger/captain route-sharing requests and negotiation.
-- Additive only: preserves legacy rides/bookings and fixed-fare trip_requests.
-- A captain may use the passenger flow; a passenger never gains captain privileges.

create table if not exists public.share_route_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  ride_mode text not null check (ride_mode in ('live_share','scheduled_share')),
  origin_name text not null,
  origin_lat double precision,
  origin_lng double precision,
  destination_name text not null,
  destination_lat double precision,
  destination_lng double precision,
  route_description text,
  departure_at timestamptz not null,
  preferred_vehicle_type text check (
    preferred_vehicle_type is null or preferred_vehicle_type in
    ('private_car','taxi','suzuki','microbus','scooter','motorcycle')
  ),
  seats_requested integer not null default 1 check (seats_requested between 1 and 13),
  requester_seat_price_egp numeric(10,2) not null check (requester_seat_price_egp >= 0),
  request_status text not null default 'open'
    check (request_status in ('open','matched','cancelled','completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.share_route_negotiations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.share_route_requests(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  captain_id uuid not null references public.profiles(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id),
  requester_offer_egp numeric(10,2) not null check (requester_offer_egp >= 0),
  captain_counter_offer_egp numeric(10,2) check (
    captain_counter_offer_egp is null or captain_counter_offer_egp >= 0
  ),
  agreed_price_egp numeric(10,2) check (agreed_price_egp is null or agreed_price_egp >= 0),
  negotiation_status text not null default 'pending'
    check (negotiation_status in ('pending','counter_offer','accepted','confirmed','cancelled','rejected')),
  created_at timestamptz not null default now(),
  unique (request_id, captain_id),
  check (requester_id <> captain_id)
);

create table if not exists public.share_route_offer_history (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.share_route_negotiations(id) on delete cascade,
  offered_by uuid not null references public.profiles(id) on delete cascade,
  amount_egp numeric(10,2) not null check (amount_egp >= 0),
  created_at timestamptz not null default now()
);

create index if not exists share_route_requests_open_departure_idx
  on public.share_route_requests (request_status, departure_at);
create index if not exists share_route_requests_requester_idx
  on public.share_route_requests (requester_id, created_at desc);
create index if not exists share_route_negotiations_captain_idx
  on public.share_route_negotiations (captain_id, negotiation_status, created_at desc);
create index if not exists share_route_negotiations_requester_idx
  on public.share_route_negotiations (requester_id, negotiation_status, created_at desc);

alter table public.share_route_requests enable row level security;
alter table public.share_route_negotiations enable row level security;
alter table public.share_route_offer_history enable row level security;

drop policy if exists share_route_requests_read_parties_captains_admin
  on public.share_route_requests;
create policy share_route_requests_read_parties_captains_admin
  on public.share_route_requests
  for select to authenticated
  using (
    requester_id = auth.uid()
    or public.is_admin()
    or (
      request_status = 'open'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'captain' and p.is_blocked = false
      )
    )
  );

drop policy if exists share_route_negotiations_read_parties_admin
  on public.share_route_negotiations;
create policy share_route_negotiations_read_parties_admin
  on public.share_route_negotiations
  for select to authenticated
  using (requester_id = auth.uid() or captain_id = auth.uid() or public.is_admin());

drop policy if exists share_route_history_read_parties_admin
  on public.share_route_offer_history;
create policy share_route_history_read_parties_admin
  on public.share_route_offer_history
  for select to authenticated
  using (
    public.is_admin()
    or offered_by = auth.uid()
    or exists (
      select 1 from public.share_route_negotiations n
      where n.id = share_route_offer_history.negotiation_id
        and (n.requester_id = auth.uid() or n.captain_id = auth.uid())
    )
  );

grant select on public.share_route_requests to authenticated;
grant select on public.share_route_negotiations to authenticated;
grant select on public.share_route_offer_history to authenticated;

create or replace function public.create_share_route_request(
  p_ride_mode text,
  p_origin_name text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_name text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_route_description text,
  p_departure_at timestamptz,
  p_seats integer,
  p_seat_price numeric,
  p_vehicle_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
  v_role text;
  v_blocked boolean;
  v_request_id uuid;
begin
  if v_id is null then raise exception 'login_required'; end if;

  select role, is_blocked into v_role, v_blocked
  from public.profiles where id = v_id;

  if not found or v_role not in ('passenger','captain') or coalesce(v_blocked,true) then
    raise exception 'account_not_allowed';
  end if;
  if p_ride_mode not in ('live_share','scheduled_share') then
    raise exception 'invalid_ride_mode';
  end if;
  if nullif(btrim(p_origin_name),'') is null
     or nullif(btrim(p_destination_name),'') is null
     or p_origin_name = p_destination_name then
    raise exception 'invalid_route';
  end if;
  if p_departure_at is null or p_departure_at < now() - interval '5 minutes' then
    raise exception 'invalid_departure_time';
  end if;
  if p_seats is null or p_seats < 1 or p_seats > 13
     or p_seat_price is null or p_seat_price < 0 then
    raise exception 'invalid_seat_request';
  end if;
  if p_vehicle_type is not null and p_vehicle_type not in
    ('private_car','taxi','suzuki','microbus','scooter','motorcycle') then
    raise exception 'invalid_vehicle_type';
  end if;

  insert into public.share_route_requests (
    requester_id, ride_mode, origin_name, origin_lat, origin_lng,
    destination_name, destination_lat, destination_lng, route_description,
    departure_at, preferred_vehicle_type, seats_requested, requester_seat_price_egp
  ) values (
    v_id, p_ride_mode, btrim(p_origin_name), p_origin_lat, p_origin_lng,
    btrim(p_destination_name), p_destination_lat, p_destination_lng,
    nullif(btrim(p_route_description),''),
    p_departure_at, p_vehicle_type, p_seats, p_seat_price
  ) returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.captain_reply_share_route_request(
  p_request_id uuid,
  p_vehicle_id uuid,
  p_action text,
  p_counter_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
  v_request public.share_route_requests%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_negotiation public.share_route_negotiations%rowtype;
  v_negotiation_id uuid;
begin
  if v_id is null then raise exception 'login_required'; end if;
  if p_action not in ('accept','counter') then raise exception 'invalid_action'; end if;
  if p_action = 'counter' and (p_counter_price is null or p_counter_price < 0) then
    raise exception 'invalid_counter_price';
  end if;

  perform public.require_captain_ready(v_id);

  select * into v_request
  from public.share_route_requests
  where id = p_request_id
  for update;
  if not found or v_request.request_status <> 'open' then
    raise exception 'share_request_not_available';
  end if;
  if v_request.requester_id = v_id then raise exception 'cannot_reply_to_own_request'; end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
    and captain_id = v_id
    and approval_status = 'approved'
    and is_active = true;
  if not found then raise exception 'approved_active_vehicle_required'; end if;
  if v_request.preferred_vehicle_type is not null
     and v_vehicle.vehicle_type <> v_request.preferred_vehicle_type then
    raise exception 'vehicle_type_mismatch';
  end if;
  if v_request.seats_requested > v_vehicle.passenger_capacity then
    raise exception 'not_enough_vehicle_capacity';
  end if;

  select * into v_negotiation
  from public.share_route_negotiations
  where request_id = p_request_id and captain_id = v_id
  for update;

  if not found then
    insert into public.share_route_negotiations (
      request_id, requester_id, captain_id, vehicle_id, requester_offer_egp
    ) values (
      p_request_id, v_request.requester_id, v_id, p_vehicle_id,
      v_request.requester_seat_price_egp
    ) returning id into v_negotiation_id;

    insert into public.share_route_offer_history(negotiation_id, offered_by, amount_egp)
    values (v_negotiation_id, v_request.requester_id, v_request.requester_seat_price_egp);
  else
    if v_negotiation.negotiation_status <> 'pending' then
      raise exception 'negotiation_not_replyable';
    end if;
    update public.share_route_negotiations
    set vehicle_id = p_vehicle_id
    where id = v_negotiation.id;
    v_negotiation_id := v_negotiation.id;
  end if;

  if p_action = 'accept' then
    update public.share_route_negotiations
    set agreed_price_egp = requester_offer_egp,
        captain_counter_offer_egp = null,
        negotiation_status = 'accepted'
    where id = v_negotiation_id;
  else
    update public.share_route_negotiations
    set captain_counter_offer_egp = p_counter_price,
        agreed_price_egp = null,
        negotiation_status = 'counter_offer'
    where id = v_negotiation_id;

    insert into public.share_route_offer_history(negotiation_id, offered_by, amount_egp)
    values (v_negotiation_id, v_id, p_counter_price);
  end if;

  return v_negotiation_id;
end;
$$;

create or replace function public.requester_reply_share_route(
  p_negotiation_id uuid,
  p_action text,
  p_new_offer numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
  v_negotiation public.share_route_negotiations%rowtype;
  v_request public.share_route_requests%rowtype;
begin
  if v_id is null then raise exception 'login_required'; end if;
  if p_action not in ('accept','counter','cancel') then raise exception 'invalid_action'; end if;
  if p_action = 'counter' and (p_new_offer is null or p_new_offer < 0) then
    raise exception 'invalid_offer';
  end if;

  select r.* into v_request
  from public.share_route_requests r
  join public.share_route_negotiations n on n.request_id = r.id
  where n.id = p_negotiation_id and r.requester_id = v_id
  for update of r;
  if not found then raise exception 'negotiation_not_found'; end if;
  if v_request.request_status <> 'open' then raise exception 'share_request_not_available'; end if;

  select * into v_negotiation
  from public.share_route_negotiations
  where id = p_negotiation_id and requester_id = v_id
  for update;
  if not found or v_negotiation.negotiation_status <> 'counter_offer' then
    raise exception 'no_counter_offer_to_reply';
  end if;

  if p_action = 'accept' then
    update public.share_route_negotiations
    set agreed_price_egp = captain_counter_offer_egp,
        negotiation_status = 'accepted'
    where id = p_negotiation_id;
  elsif p_action = 'counter' then
    update public.share_route_negotiations
    set requester_offer_egp = p_new_offer,
        captain_counter_offer_egp = null,
        agreed_price_egp = null,
        negotiation_status = 'pending'
    where id = p_negotiation_id;

    insert into public.share_route_offer_history(negotiation_id, offered_by, amount_egp)
    values (p_negotiation_id, v_id, p_new_offer);
  else
    update public.share_route_negotiations
    set negotiation_status = 'cancelled'
    where id = p_negotiation_id;
  end if;
end;
$$;

create or replace function public.confirm_share_route_match(p_negotiation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
  v_request_id uuid;
begin
  if v_id is null then raise exception 'login_required'; end if;

  select n.request_id into v_request_id
  from public.share_route_negotiations n
  join public.share_route_requests r on r.id = n.request_id
  where n.id = p_negotiation_id
    and n.requester_id = v_id
    and n.negotiation_status = 'accepted'
    and n.agreed_price_egp is not null
    and r.request_status = 'open'
  for update of r;

  if not found then raise exception 'accepted_negotiation_not_found'; end if;

  update public.share_route_negotiations
  set negotiation_status = 'confirmed'
  where id = p_negotiation_id and requester_id = v_id;

  update public.share_route_requests
  set request_status = 'matched'
  where id = v_request_id and requester_id = v_id and request_status = 'open';
end;
$$;

revoke all on function public.create_share_route_request(text,text,double precision,double precision,text,double precision,double precision,text,timestamptz,integer,numeric,text) from public;
revoke all on function public.captain_reply_share_route_request(uuid,uuid,text,numeric) from public;
revoke all on function public.requester_reply_share_route(uuid,text,numeric) from public;
revoke all on function public.confirm_share_route_match(uuid) from public;

grant execute on function public.create_share_route_request(text,text,double precision,double precision,text,double precision,double precision,text,timestamptz,integer,numeric,text) to authenticated;
grant execute on function public.captain_reply_share_route_request(uuid,uuid,text,numeric) to authenticated;
grant execute on function public.requester_reply_share_route(uuid,text,numeric) to authenticated;
grant execute on function public.confirm_share_route_match(uuid) to authenticated;
