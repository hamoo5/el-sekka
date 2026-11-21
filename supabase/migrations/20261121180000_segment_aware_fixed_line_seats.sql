create or replace function public.get_sekka_line_segment_availability(
 p_schedule_id uuid,p_departure_at timestamptz,p_pickup_stop_id uuid,p_dropoff_stop_id uuid
) returns integer
language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
 v_id uuid:=auth.uid();
 v_schedule public.sekka_line_schedules%rowtype;
 v_line public.sekka_lines%rowtype;
 v_pickup public.sekka_line_stops%rowtype;
 v_dropoff public.sekka_line_stops%rowtype;
 v_run public.sekka_line_runs%rowtype;
 v_occupied integer:=0;
begin
 if v_id is null then raise exception 'login_required'; end if;
 if not exists(select 1 from public.profiles where id=v_id and role='passenger' and coalesce(is_blocked,true)=false) then raise exception 'rider_account_required'; end if;
 if p_departure_at is null or p_departure_at<=now() or p_departure_at>now()+interval '90 days' then raise exception 'invalid_departure_time'; end if;
 select * into v_schedule from public.sekka_line_schedules where id=p_schedule_id and is_active=true;
 if not found then raise exception 'line_schedule_not_found'; end if;
 select * into v_line from public.sekka_lines where id=v_schedule.line_id and approval_status='approved' and is_active=true;
 if not found then raise exception 'line_not_available'; end if;
 if not (extract(dow from (p_departure_at at time zone 'Africa/Cairo'))::smallint=any(v_schedule.service_days))
    or (p_departure_at at time zone 'Africa/Cairo')::time<>v_schedule.departure_time then raise exception 'departure_not_in_schedule'; end if;
 select * into v_pickup from public.sekka_line_stops where id=p_pickup_stop_id and line_id=v_line.id and can_pickup=true;
 select * into v_dropoff from public.sekka_line_stops where id=p_dropoff_stop_id and line_id=v_line.id and can_dropoff=true;
 if v_pickup.id is null or v_dropoff.id is null or v_pickup.stop_order>=v_dropoff.stop_order then raise exception 'invalid_boarding_stops'; end if;
 select * into v_run from public.sekka_line_runs where schedule_id=v_schedule.id and departure_at=p_departure_at;
 if not found then return v_schedule.seats_total; end if;
 select coalesce(sum(b.seats_requested),0)::integer into v_occupied
 from public.sekka_line_bookings b
 join public.sekka_line_stops bp on bp.id=b.pickup_stop_id
 join public.sekka_line_stops bd on bd.id=b.dropoff_stop_id
 where b.run_id=v_run.id and b.booking_status='confirmed'
   and bp.stop_order<v_dropoff.stop_order and bd.stop_order>v_pickup.stop_order;
 return greatest(v_schedule.seats_total-v_occupied,0);
end;
$function$;

create or replace function public.request_sekka_line_seats(
 p_schedule_id uuid,p_departure_at timestamptz,p_pickup_stop_id uuid,p_dropoff_stop_id uuid,p_seats integer
) returns uuid
language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
 v_id uuid:=auth.uid();
 v_schedule public.sekka_line_schedules%rowtype;
 v_line public.sekka_lines%rowtype;
 v_pickup public.sekka_line_stops%rowtype;
 v_dropoff public.sekka_line_stops%rowtype;
 v_run public.sekka_line_runs%rowtype;
 v_occupied integer:=0;
 v_booking_id uuid;
begin
 if v_id is null then raise exception 'login_required'; end if;
 if not exists(select 1 from public.profiles where id=v_id and role='passenger' and coalesce(is_blocked,true)=false) then raise exception 'rider_account_required'; end if;
 if p_seats is null or p_seats<1 or p_seats>13 or p_departure_at is null or p_departure_at<=now() or p_departure_at>now()+interval '90 days' then raise exception 'invalid_booking_request'; end if;
 select * into v_schedule from public.sekka_line_schedules where id=p_schedule_id and is_active=true;
 if not found then raise exception 'line_schedule_not_found'; end if;
 select * into v_line from public.sekka_lines where id=v_schedule.line_id and approval_status='approved' and is_active=true;
 if not found then raise exception 'line_not_available'; end if;
 if not (extract(dow from (p_departure_at at time zone 'Africa/Cairo'))::smallint=any(v_schedule.service_days))
    or (p_departure_at at time zone 'Africa/Cairo')::time<>v_schedule.departure_time then raise exception 'departure_not_in_schedule'; end if;
 select * into v_pickup from public.sekka_line_stops where id=p_pickup_stop_id and line_id=v_line.id and can_pickup=true;
 select * into v_dropoff from public.sekka_line_stops where id=p_dropoff_stop_id and line_id=v_line.id and can_dropoff=true;
 if v_pickup.id is null or v_dropoff.id is null or v_pickup.stop_order>=v_dropoff.stop_order then raise exception 'invalid_boarding_stops'; end if;
 insert into public.sekka_line_runs(line_id,schedule_id,departure_at,seats_total,seats_available)
 values(v_line.id,v_schedule.id,p_departure_at,v_schedule.seats_total,v_schedule.seats_total)
 on conflict(schedule_id,departure_at) do nothing;
 select * into v_run from public.sekka_line_runs where schedule_id=v_schedule.id and departure_at=p_departure_at for update;
 if v_run.run_status<>'open' then raise exception 'line_run_not_open'; end if;
 select coalesce(sum(b.seats_requested),0)::integer into v_occupied
 from public.sekka_line_bookings b
 join public.sekka_line_stops bp on bp.id=b.pickup_stop_id
 join public.sekka_line_stops bd on bd.id=b.dropoff_stop_id
 where b.run_id=v_run.id and b.booking_status='confirmed'
   and bp.stop_order<v_dropoff.stop_order and bd.stop_order>v_pickup.stop_order;
 if v_schedule.seats_total-v_occupied<p_seats then raise exception 'not_enough_seats_for_segment'; end if;
 insert into public.sekka_line_bookings(run_id,passenger_id,pickup_stop_id,dropoff_stop_id,seats_requested,seat_price_egp,total_price_egp)
 values(v_run.id,v_id,v_pickup.id,v_dropoff.id,p_seats,v_schedule.seat_price_egp,v_schedule.seat_price_egp*p_seats)
 returning id into v_booking_id;
 return v_booking_id;
end;
$function$;

revoke all on function public.get_sekka_line_segment_availability(uuid,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.get_sekka_line_segment_availability(uuid,timestamptz,uuid,uuid) to authenticated;
revoke all on function public.request_sekka_line_seats(uuid,timestamptz,uuid,uuid,integer) from public,anon;
grant execute on function public.request_sekka_line_seats(uuid,timestamptz,uuid,uuid,integer) to authenticated;
