-- Enforce one unfinished shared route per captain. This is separate from legacy trip_requests.
create or replace function public.guard_single_open_shared_ride()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.ride_status not in ('open', 'full') then
    return new;
  end if;

  if new.captain_id is null then
    raise exception 'captain_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.captain_id::text, 0));

  if exists (
    select 1
    from public.rides r
    where r.captain_id = new.captain_id
      and r.ride_status in ('open', 'full')
      and r.id is distinct from new.id
  ) then
    raise exception 'captain_has_open_ride'
      using detail = 'Close or cancel the existing shared route before publishing another route.';
  end if;

  return new;
end;
$function$;

drop trigger if exists rides_one_open_shared_route on public.rides;
create trigger rides_one_open_shared_route
before insert or update of captain_id, ride_status
on public.rides
for each row
execute function public.guard_single_open_shared_ride();

create index if not exists rides_captain_active_status_idx
on public.rides(captain_id, ride_status)
where ride_status in ('open', 'full');

create or replace function public.admin_cancel_shared_ride(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_ride public.rides%rowtype;
  v_in_progress integer;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  perform public.require_admin();

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found then
    raise exception 'ride_not_found';
  end if;

  if v_ride.ride_status not in ('open', 'full') then
    raise exception 'ride_not_cancellable';
  end if;

  select count(*)::integer into v_in_progress
  from public.bookings
  where ride_id = p_ride_id
    and booking_status = 'in_progress';

  if v_in_progress > 0 then
    raise exception 'ride_has_started_bookings';
  end if;

  with cancelled_bookings as (
    update public.bookings
    set booking_status = 'cancelled',
        seat_reserved_at = null
    where ride_id = p_ride_id
      and booking_status in ('pending', 'counter_offer', 'accepted', 'confirmed')
    returning id, passenger_id
  )
  insert into public.user_notifications (
    user_id, notification_type, title, body, related_ride_id, related_booking_id
  )
  select
    cb.passenger_id,
    'shared_ride_cancelled',
    'تم إلغاء خط الرحلة',
    'قامت الإدارة بإلغاء الخط، وتم إلغاء حجزك وتحرير المقاعد المحجوزة.',
    p_ride_id,
    cb.id
  from cancelled_bookings cb
  on conflict (user_id, notification_type, related_booking_id)
    where related_booking_id is not null
  do nothing;

  update public.rides
  set ride_status = 'cancelled'
  where id = p_ride_id
    and ride_status in ('open', 'full');

  if not found then
    raise exception 'ride_cancellation_failed';
  end if;
end;
$function$;

revoke all on function public.admin_cancel_shared_ride(uuid) from public;
revoke all on function public.admin_cancel_shared_ride(uuid) from anon;
grant execute on function public.admin_cancel_shared_ride(uuid) to authenticated;
