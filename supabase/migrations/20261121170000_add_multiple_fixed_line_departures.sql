create or replace function public.add_sekka_line_schedule(
 p_line_id uuid,p_service_days smallint[],p_departure_time time,p_seats integer,p_seat_price numeric
) returns uuid
language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
 v_id uuid:=auth.uid();
 v_line public.sekka_lines%rowtype;
 v_vehicle public.vehicles%rowtype;
 v_schedule_id uuid;
begin
 if v_id is null then raise exception 'login_required'; end if;
 perform public.require_captain_ready(v_id);
 select * into v_line from public.sekka_lines
 where id=p_line_id and captain_id=v_id and approval_status='approved' and is_active=true
 for update;
 if not found then raise exception 'approved_owned_line_required'; end if;
 select * into v_vehicle from public.vehicles
 where id=v_line.vehicle_id and captain_id=v_id and approval_status='approved' and is_active=true;
 if not found then raise exception 'approved_active_vehicle_required'; end if;
 if p_service_days is null or cardinality(p_service_days)<1 or cardinality(p_service_days)>7
    or not (p_service_days <@ array[0,1,2,3,4,5,6]::smallint[]) then raise exception 'invalid_service_days'; end if;
 if p_departure_time is null or p_seat_price is null or p_seat_price<0 then raise exception 'invalid_schedule'; end if;
 if p_seats is null or p_seats<1 or p_seats>v_vehicle.passenger_capacity then raise exception 'invalid_seat_capacity'; end if;
 insert into public.sekka_line_schedules(line_id,service_days,departure_time,seats_total,seat_price_egp)
 values(p_line_id,(select array_agg(distinct d order by d) from unnest(p_service_days) d),p_departure_time,p_seats,p_seat_price)
 returning id into v_schedule_id;
 return v_schedule_id;
end;
$function$;
revoke all on function public.add_sekka_line_schedule(uuid,smallint[],time,integer,numeric) from public,anon;
grant execute on function public.add_sekka_line_schedule(uuid,smallint[],time,integer,numeric) to authenticated;
