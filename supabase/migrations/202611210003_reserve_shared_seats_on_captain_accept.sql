-- Reserve overlapping seat capacity as soon as the captain accepts.
-- Lock the ride row so simultaneous acceptances serialize and cannot oversell a segment.
create or replace function public.captain_reply_booking(
  p_booking_id uuid,
  p_action text,
  p_counter_price numeric default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_ride public.rides%rowtype;
  v_used integer;
begin
  select b.*
  into v_booking
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
    select r.*
    into v_ride
    from public.rides r
    where r.id = v_booking.ride_id
      and r.captain_id = v_id
    for update;

    if not found then raise exception 'booking_not_found'; end if;

    perform public.require_captain_ready_for(v_id, v_ride.departure_at);
    if not exists(
      select 1 from public.vehicles v
      where v.id=v_ride.vehicle_id and v.captain_id=v_id
        and v.approval_status='approved' and v.is_active=true
    ) then
      raise exception 'approved_active_vehicle_required';
    end if;
  end if;

  if p_action = 'reject' then
    update public.bookings
    set booking_status = 'rejected', seat_reserved_at = null
    where id = p_booking_id;

  elsif p_action = 'accept' then
    select coalesce(sum(b.seats_requested),0)::integer
    into v_used
    from public.bookings b
    where b.ride_id = v_booking.ride_id
      and b.id <> p_booking_id
      and b.booking_status in ('accepted','confirmed','in_progress')
      and b.pickup_stop_order < v_booking.dropoff_stop_order
      and b.dropoff_stop_order > v_booking.pickup_stop_order;

    if v_used + v_booking.seats_requested > v_ride.available_seats then
      raise exception 'not_enough_seats_on_route_segment';
    end if;

    update public.bookings
    set agreed_price_egp = passenger_offer_egp,
        booking_status = 'accepted',
        seat_reserved_at = now()
    where id = p_booking_id;

  elsif p_action = 'counter' then
    if p_counter_price is null or p_counter_price < 0 then
      raise exception 'invalid_counter_price';
    end if;

    update public.bookings
    set captain_counter_offer_egp = p_counter_price,
        booking_status = 'counter_offer',
        seat_reserved_at = null
    where id = p_booking_id;

    insert into public.booking_offer_history(booking_id, offered_by, amount_egp)
    values (p_booking_id, v_id, p_counter_price);
  else
    raise exception 'invalid_action';
  end if;
end;
$function$;
