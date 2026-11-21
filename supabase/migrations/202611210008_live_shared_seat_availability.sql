alter table public.rides add column if not exists seat_capacity integer;
update public.rides set seat_capacity=available_seats where seat_capacity is null;
alter table public.rides alter column seat_capacity set not null;
alter table public.rides drop constraint if exists rides_seat_capacity_positive_check;
alter table public.rides add constraint rides_seat_capacity_positive_check check(seat_capacity>0) not valid;

create or replace function public.refresh_shared_ride_available_seats(p_ride_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_capacity integer; v_peak integer:=0; v_has_missing_offsets boolean;
begin
 select coalesce(seat_capacity,available_seats) into v_capacity from public.rides where id=p_ride_id for update;
 if not found then return; end if;
 select exists(select 1 from public.bookings b where b.ride_id=p_ride_id and b.booking_status in ('accepted','confirmed','in_progress')
   and (b.pickup_route_offset_m is null or b.dropoff_route_offset_m is null)) into v_has_missing_offsets;
 if v_has_missing_offsets then
   select coalesce(sum(seats_requested),0)::integer into v_peak from public.bookings where ride_id=p_ride_id and booking_status in ('accepted','confirmed','in_progress');
 else
   with events as (
     select pickup_route_offset_m pos,seats_requested delta from public.bookings where ride_id=p_ride_id and booking_status in ('accepted','confirmed','in_progress')
     union all select dropoff_route_offset_m pos,-seats_requested delta from public.bookings where ride_id=p_ride_id and booking_status in ('accepted','confirmed','in_progress')
   ), running as (
     select sum(delta) over(order by pos,delta rows between unbounded preceding and current row) occupied from events
   ) select coalesce(max(occupied),0)::integer into v_peak from running;
 end if;
 update public.rides set available_seats=greatest(0,v_capacity-v_peak) where id=p_ride_id;
end;
$function$;
revoke execute on function public.refresh_shared_ride_available_seats(uuid) from public,anon,authenticated;

create or replace function public.trigger_refresh_shared_ride_available_seats()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
begin
 if tg_op='DELETE' then perform public.refresh_shared_ride_available_seats(old.ride_id); return old; end if;
 perform public.refresh_shared_ride_available_seats(new.ride_id);
 if tg_op='UPDATE' and old.ride_id is distinct from new.ride_id then perform public.refresh_shared_ride_available_seats(old.ride_id); end if;
 return new;
end;
$function$;
revoke execute on function public.trigger_refresh_shared_ride_available_seats() from public,anon,authenticated;

drop trigger if exists bookings_refresh_shared_ride_available_seats on public.bookings;
create trigger bookings_refresh_shared_ride_available_seats
after insert or update of booking_status,seats_requested,pickup_route_offset_m,dropoff_route_offset_m or delete
on public.bookings for each row execute function public.trigger_refresh_shared_ride_available_seats();

create or replace function public.captain_reply_booking(p_booking_id uuid,p_action text,p_counter_price numeric default null)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_id uuid:=auth.uid(); v_booking public.bookings%rowtype; v_ride public.rides%rowtype; v_used integer;
begin
 select b.* into v_booking from public.bookings b join public.rides r on r.id=b.ride_id where b.id=p_booking_id and r.captain_id=v_id for update of b;
 if not found then raise exception 'booking_not_found'; end if;
 if v_booking.booking_status not in ('pending','counter_offer') then raise exception 'booking_not_replyable'; end if;
 if p_action in ('accept','counter') then
   select r.* into v_ride from public.rides r where r.id=v_booking.ride_id and r.captain_id=v_id for update;
   if not found then raise exception 'booking_not_found'; end if;
   perform public.require_captain_ready_for(v_id,v_ride.departure_at);
   if not exists(select 1 from public.vehicles v where v.id=v_ride.vehicle_id and v.captain_id=v_id and v.approval_status='approved' and v.is_active=true) then raise exception 'approved_active_vehicle_required'; end if;
 end if;
 if p_action='reject' then update public.bookings set booking_status='rejected',seat_reserved_at=null where id=p_booking_id;
 elsif p_action='accept' then
   select coalesce(sum(b.seats_requested),0)::integer into v_used from public.bookings b
   where b.ride_id=v_booking.ride_id and b.id<>p_booking_id and b.booking_status in ('accepted','confirmed','in_progress')
   and ((b.pickup_route_offset_m is not null and b.dropoff_route_offset_m is not null and v_booking.pickup_route_offset_m is not null and v_booking.dropoff_route_offset_m is not null
     and b.pickup_route_offset_m<v_booking.dropoff_route_offset_m and b.dropoff_route_offset_m>v_booking.pickup_route_offset_m)
     or ((b.pickup_route_offset_m is null or b.dropoff_route_offset_m is null or v_booking.pickup_route_offset_m is null or v_booking.dropoff_route_offset_m is null)
     and b.pickup_stop_order<v_booking.dropoff_stop_order and b.dropoff_stop_order>v_booking.pickup_stop_order));
   if v_used+v_booking.seats_requested>coalesce(v_ride.seat_capacity,v_ride.available_seats) then raise exception 'not_enough_seats_on_route_segment'; end if;
   update public.bookings set agreed_price_egp=passenger_offer_egp,booking_status='accepted',seat_reserved_at=now() where id=p_booking_id;
 elsif p_action='counter' then
   if p_counter_price is null or p_counter_price<0 then raise exception 'invalid_counter_price'; end if;
   update public.bookings set captain_counter_offer_egp=p_counter_price,booking_status='counter_offer',seat_reserved_at=null where id=p_booking_id;
   insert into public.booking_offer_history(booking_id,offered_by,amount_egp) values(p_booking_id,v_id,p_counter_price);
 else raise exception 'invalid_action'; end if;
end;
$function$;
alter publication supabase_realtime add table public.rides;