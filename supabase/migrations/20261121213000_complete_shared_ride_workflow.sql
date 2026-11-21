create or replace function public.guard_single_open_shared_ride()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.ride_status not in ('open', 'full', 'in_progress') then return new; end if;
  if new.captain_id is null then raise exception 'captain_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.captain_id::text, 0));
  if exists (
    select 1 from public.rides r
    where r.captain_id = new.captain_id
      and r.ride_status in ('open', 'full', 'in_progress')
      and r.id is distinct from new.id
  ) then
    raise exception 'captain_has_open_ride'
      using detail = 'Complete or cancel the existing shared route before publishing another route.';
  end if;
  return new;
end;
$function$;

drop index if exists public.rides_captain_active_status_idx;
create index rides_captain_active_status_idx
on public.rides(captain_id, ride_status)
where ride_status in ('open', 'full', 'in_progress');

create or replace function public.complete_shared_ride(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_admin boolean;
begin
  if v_actor is null then raise exception 'login_required'; end if;
  v_admin := public.is_admin();

  if not v_admin and not exists (
    select 1 from public.profiles
    where id = v_actor and account_type = 'captain' and coalesce(is_blocked, true) = false
  ) then
    raise exception 'captain_account_required';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found then raise exception 'ride_not_found'; end if;
  if not v_admin and v_ride.captain_id <> v_actor then raise exception 'ride_not_owned'; end if;
  if v_ride.ride_status not in ('open', 'full', 'in_progress') then raise exception 'ride_not_completable'; end if;
  if v_ride.departure_at > now() then raise exception 'ride_not_started_yet'; end if;

  with cancelled_bookings as (
    update public.bookings
    set booking_status = 'cancelled', seat_reserved_at = null
    where ride_id = p_ride_id
      and booking_status in ('pending', 'counter_offer', 'accepted')
    returning id, passenger_id
  )
  insert into public.user_notifications (
    user_id, notification_type, title, body, related_ride_id, related_booking_id
  )
  select cb.passenger_id, 'shared_ride_closed', 'تم إنهاء خط الرحلة',
    'تم إغلاق الخط. لم يعد الحجز متاحًا، وتم إلغاء أي طلب لم يتم تأكيده.',
    p_ride_id, cb.id
  from cancelled_bookings cb
  on conflict (user_id, notification_type, related_booking_id)
    where related_booking_id is not null do nothing;

  update public.bookings
  set booking_status = 'completed', seat_reserved_at = null
  where ride_id = p_ride_id
    and booking_status in ('confirmed', 'in_progress');

  update public.rides
  set ride_status = 'completed'
  where id = p_ride_id
    and ride_status in ('open', 'full', 'in_progress');

  if not found then raise exception 'ride_completion_failed'; end if;
end;
$function$;

revoke all on function public.complete_shared_ride(uuid) from public;
revoke all on function public.complete_shared_ride(uuid) from anon;
grant execute on function public.complete_shared_ride(uuid) to authenticated;