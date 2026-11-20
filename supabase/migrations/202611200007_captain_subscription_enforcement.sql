-- El Sekka: enforce captain subscription + document eligibility across all captain actions.
-- This migration is intentionally separate from 006 so the document workflow can be reviewed independently.

create or replace function public.require_captain_ready_for(
  p_captain_id uuid,
  p_activity_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_captain_id is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.captain_applications a on a.user_id = p.id
    where p.id = p_captain_id
      and p.role = 'captain'
      and coalesce(p.is_blocked, true) = false
      and a.application_status = 'approved'
      and a.national_id_expiry > current_date
      and a.license_expiry > current_date
      and a.vehicle_license_expiry > current_date
  ) then
    raise exception 'captain_documents_or_approval_invalid';
  end if;

  if not exists (
    select 1
    from public.captain_subscriptions s
    where s.captain_id = p_captain_id
      and s.payment_status = 'approved'
      and s.starts_at <= now()
      and s.expires_at > greatest(now(), coalesce(p_activity_at, now()))
  ) then
    raise exception 'active_subscription_required';
  end if;
end;
$$;

create or replace function public.require_captain_ready(p_captain_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.require_captain_ready_for(p_captain_id, now());
end;
$$;

revoke all on function public.require_captain_ready_for(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.require_captain_ready(uuid) from public, anon, authenticated;

-- Keep vehicle visibility aligned with operational eligibility.
create or replace function public.sync_captain_subscription_status()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.vehicles v
  set is_active = (
    v.approval_status = 'approved'
    and exists (
      select 1
      from public.profiles p
      join public.captain_applications a on a.user_id = p.id
      where p.id = v.captain_id
        and p.role = 'captain'
        and coalesce(p.is_blocked, true) = false
        and a.application_status = 'approved'
        and a.national_id_expiry > current_date
        and a.license_expiry > current_date
        and a.vehicle_license_expiry > current_date
    )
    and exists (
      select 1
      from public.captain_subscriptions s
      where s.captain_id = v.captain_id
        and s.payment_status = 'approved'
        and s.starts_at <= now()
        and s.expires_at > now()
    )
  )
  where v.captain_id is not null;
end;
$$;

revoke all on function public.sync_captain_subscription_status() from public, anon, authenticated;

-- A captain can submit a first subscription or renew after expiry.
-- Payment approval remains a human/admin action because payment is external.
create or replace function public.submit_subscription(
  p_plan_days integer,
  p_payment_reference text,
  p_proof_path text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := auth.uid();
  v_amount numeric(10,2);
  v_result uuid;
begin
  if v_id is null then raise exception 'login_required'; end if;

  if not exists (
    select 1
    from public.profiles p
    join public.captain_applications a on a.user_id = p.id
    where p.id = v_id
      and p.role = 'captain'
      and coalesce(p.is_blocked, true) = false
      and a.application_status = 'approved'
      and a.national_id_expiry > current_date
      and a.license_expiry > current_date
      and a.vehicle_license_expiry > current_date
  ) then
    raise exception 'valid_captain_documents_required';
  end if;

  v_amount := case p_plan_days when 30 then 150 when 90 then 400 else null end;
  if v_amount is null then raise exception 'invalid_subscription_plan'; end if;
  if nullif(btrim(p_payment_reference), '') is null then
    raise exception 'payment_reference_required';
  end if;
  if nullif(btrim(p_proof_path), '') is null then
    raise exception 'payment_proof_required';
  end if;

  perform 1 from public.profiles where id = v_id for update;

  if exists (
    select 1 from public.captain_subscriptions
    where captain_id = v_id and payment_status = 'submitted'
  ) then
    raise exception 'subscription_already_pending';
  end if;

  insert into public.captain_subscriptions (
    captain_id, plan_days, amount_egp,
    payment_reference, payment_proof_path, payment_status
  )
  values (
    v_id, p_plan_days, v_amount,
    btrim(p_payment_reference), btrim(p_proof_path), 'submitted'
  )
  returning id into v_result;

  return v_result;
end;
$$;

revoke all on function public.submit_subscription(integer,text,text) from public, anon;
grant execute on function public.submit_subscription(integer,text,text) to authenticated;

-- Approval starts a new plan now, or appends it to the latest still-active expiry.
create or replace function public.admin_approve_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sub public.captain_subscriptions%rowtype;
  v_start timestamptz;
begin
  perform public.require_admin();

  select * into v_sub
  from public.captain_subscriptions
  where id = p_subscription_id
  for update;

  if not found then raise exception 'subscription_not_found'; end if;
  if v_sub.payment_status <> 'submitted' then
    raise exception 'subscription_already_reviewed';
  end if;

  select greatest(now(), coalesce(max(expires_at), now()))
  into v_start
  from public.captain_subscriptions
  where captain_id = v_sub.captain_id
    and payment_status = 'approved'
    and expires_at > now();

  update public.captain_subscriptions
  set payment_status = 'approved',
      starts_at = v_start,
      expires_at = v_start + make_interval(days => v_sub.plan_days),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_subscription_id;

  insert into public.financial_transactions(
    user_id, transaction_type, amount_egp,
    reference_id, description, created_by
  )
  values (
    v_sub.captain_id,
    case when v_sub.plan_days = 30 then 'subscription' else 'renewal' end,
    v_sub.amount_egp,
    p_subscription_id,
    'Captain subscription approved',
    auth.uid()
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
  values (auth.uid(), 'subscription_approved', 'subscription', p_subscription_id::text);

  perform public.sync_captain_subscription_status();
end;
$$;

revoke all on function public.admin_approve_subscription(uuid) from public, anon;
grant execute on function public.admin_approve_subscription(uuid) to authenticated;

-- A captain may reject a booking while inactive, but cannot accept or counter-offer.
create or replace function public.captain_reply_booking(
  p_booking_id uuid,
  p_action text,
  p_counter_price numeric default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_departure_at timestamptz;
begin
  select b, r.departure_at
  into v_booking, v_departure_at
  from public.bookings b
  join public.rides r on r.id = b.ride_id
  where b.id = p_booking_id
    and r.captain_id = v_id
  for update of b;

  if not found then raise exception 'booking_not_found'; end if;
  if v_booking.booking_status not in ('pending','counter_offer') then
    raise exception 'booking_not_replyable';
  end if;

  if p_action in ('accept','counter') then
    perform public.require_captain_ready_for(v_id, v_departure_at);
  end if;

  if p_action = 'reject' then
    update public.bookings set booking_status = 'rejected'
    where id = p_booking_id;

  elsif p_action = 'accept' then
    update public.bookings
    set agreed_price_egp = passenger_offer_egp,
        booking_status = 'accepted'
    where id = p_booking_id;

  elsif p_action = 'counter' then
    if p_counter_price is null or p_counter_price < 0 then
      raise exception 'invalid_counter_price';
    end if;

    update public.bookings
    set captain_counter_offer_egp = p_counter_price,
        booking_status = 'counter_offer'
    where id = p_booking_id;

    insert into public.booking_offer_history(booking_id, offered_by, amount_egp)
    values (p_booking_id, v_id, p_counter_price);
  else
    raise exception 'invalid_action';
  end if;
end;
$$;

revoke all on function public.captain_reply_booking(uuid,text,numeric) from public, anon;
grant execute on function public.captain_reply_booking(uuid,text,numeric) to authenticated;

-- Re-check captain eligibility when a passenger confirms a previously accepted seat.
create or replace function public.confirm_seat_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_ride public.rides%rowtype;
  v_used integer;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id and passenger_id = v_id
  for update;

  if not found then raise exception 'booking_not_found'; end if;
  if v_booking.booking_status <> 'accepted'
     or v_booking.agreed_price_egp is null then
    raise exception 'price_not_agreed';
  end if;

  select * into v_ride
  from public.rides
  where id = v_booking.ride_id
  for update;

  if not found or v_ride.ride_status <> 'open' then
    raise exception 'ride_not_available';
  end if;

  perform public.require_captain_ready_for(v_ride.captain_id, v_ride.departure_at);

  select coalesce(sum(b.seats_requested),0)
  into v_used
  from public.bookings b
  where b.ride_id = v_booking.ride_id
    and b.id <> p_booking_id
    and b.booking_status in ('confirmed','in_progress')
    and b.pickup_stop_order < v_booking.dropoff_stop_order
    and b.dropoff_stop_order > v_booking.pickup_stop_order;

  if v_used + v_booking.seats_requested > v_ride.available_seats then
    raise exception 'not_enough_seats_on_route_segment';
  end if;

  update public.bookings
  set booking_status = 'confirmed'
  where id = p_booking_id;
end;
$$;

revoke all on function public.confirm_seat_booking(uuid) from public, anon;
grant execute on function public.confirm_seat_booking(uuid) to authenticated;

-- A scheduled shared ride must fall within the captain's paid subscription period.
create or replace function public.create_share_ride(
  p_vehicle_id uuid,
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
  p_seat_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := auth.uid();
  v_ride_id uuid;
  v_capacity integer;
begin
  if v_id is null then raise exception 'login_required'; end if;
  perform public.require_captain_ready_for(v_id, p_departure_at);

  if p_ride_mode not in ('live_share','scheduled_share') then
    raise exception 'invalid_ride_mode';
  end if;
  if p_departure_at is null or p_departure_at < now() - interval '5 minutes' then
    raise exception 'departure_time_in_past';
  end if;

  select passenger_capacity into v_capacity
  from public.vehicles
  where id = p_vehicle_id
    and captain_id = v_id
    and approval_status = 'approved'
    and is_active = true;
  if not found then raise exception 'approved_active_vehicle_required'; end if;

  if p_seats < 1 or p_seats > v_capacity then
    raise exception 'invalid_seat_count';
  end if;
  if p_seat_price is null or p_seat_price < 0 then
    raise exception 'invalid_price';
  end if;

  insert into public.rides (
    captain_id, vehicle_id, ride_mode,
    origin_name, origin_lat, origin_lng,
    destination_name, destination_lat, destination_lng,
    route_description, departure_at, available_seats, seat_price_egp
  )
  values (
    v_id, p_vehicle_id, p_ride_mode,
    p_origin_name, p_origin_lat, p_origin_lng,
    p_destination_name, p_destination_lat, p_destination_lng,
    p_route_description, p_departure_at, p_seats, p_seat_price
  )
  returning id into v_ride_id;

  return v_ride_id;
end;
$$;

revoke all on function public.create_share_ride(uuid,text,text,double precision,double precision,text,double precision,double precision,text,timestamptz,integer,numeric) from public, anon;
grant execute on function public.create_share_ride(uuid,text,text,double precision,double precision,text,double precision,double precision,text,timestamptz,integer,numeric) to authenticated;

-- Extend the existing document-status refresh to synchronize vehicle activation as well.
create or replace function public.process_my_captain_document_status()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  perform public.process_captain_document_expiry();
  perform public.sync_captain_subscription_status();
end;
$$;

revoke all on function public.process_my_captain_document_status() from public, anon;
grant execute on function public.process_my_captain_document_status() to authenticated;

-- Keep subscription expiry reflected in vehicle activity daily; all write RPCs also enforce it immediately.
do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
      if not exists(select 1 from cron.job where jobname='el-sekka-captain-subscription-sync') then
        perform cron.schedule('el-sekka-captain-subscription-sync','20 3 * * *',
          'select public.sync_captain_subscription_status();');
      end if;
    exception when others then
      raise notice 'pg_cron scheduling was not available; eligibility is still enforced by RPCs and refreshed on app open.';
    end;
  else
    raise notice 'pg_cron is unavailable; eligibility is still enforced by RPCs and refreshed on app open.';
  end if;
end $$;
