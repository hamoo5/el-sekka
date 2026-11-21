create or replace function public.create_share_ride(
 p_vehicle_id uuid,p_ride_mode text,p_origin_name text,p_origin_lat double precision,p_origin_lng double precision,
 p_destination_name text,p_destination_lat double precision,p_destination_lng double precision,p_route_description text,
 p_departure_at timestamptz,p_seats integer,p_seat_price numeric
)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_id uuid:=auth.uid(); v_ride_id uuid; v_capacity integer;
begin
 if v_id is null then raise exception 'login_required'; end if;
 perform public.require_captain_ready_for(v_id,p_departure_at);
 if p_ride_mode not in ('live_share','scheduled_share') then raise exception 'invalid_ride_mode'; end if;
 if p_departure_at is null or p_departure_at<now()-interval '5 minutes' then raise exception 'departure_time_in_past'; end if;
 select passenger_capacity into v_capacity from public.vehicles where id=p_vehicle_id and captain_id=v_id and approval_status='approved' and is_active=true;
 if not found then raise exception 'approved_active_vehicle_required'; end if;
 if p_seats<1 or p_seats>v_capacity then raise exception 'invalid_seat_count'; end if;
 if p_seat_price is null or p_seat_price<0 then raise exception 'invalid_price'; end if;
 insert into public.rides(captain_id,vehicle_id,ride_mode,origin_name,origin_lat,origin_lng,destination_name,destination_lat,destination_lng,route_description,departure_at,available_seats,seat_capacity,seat_price_egp)
 values(v_id,p_vehicle_id,p_ride_mode,p_origin_name,p_origin_lat,p_origin_lng,p_destination_name,p_destination_lat,p_destination_lng,p_route_description,p_departure_at,p_seats,p_seats,p_seat_price)
 returning id into v_ride_id;
 return v_ride_id;
end;
$function$;