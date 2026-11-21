create or replace function public.route_point_projection(p_geometry jsonb,p_lat double precision,p_lng double precision)
returns table(distance_m integer,offset_m integer)
language plpgsql immutable security definer set search_path to 'pg_catalog','public'
as $function$
declare
 v_coords jsonb:=p_geometry->'coordinates'; v_count integer; i integer;
 ax double precision; ay double precision; bx double precision; byy double precision;
 px double precision; py double precision; dx double precision; dy double precision;
 t double precision; seg_len double precision; cum_len double precision:=0;
 nearest double precision:='Infinity'::double precision; nearest_offset double precision:=0;
 dist double precision; lat0 double precision;
begin
 if p_geometry is null or jsonb_typeof(v_coords)<>'array' or p_lat is null or p_lng is null
   or p_lat not between -90 and 90 or p_lng not between -180 and 180
 then raise exception 'invalid_route_projection_input'; end if;
 v_count:=jsonb_array_length(v_coords);
 if v_count<2 then raise exception 'invalid_route_geometry'; end if;
 for i in 0..v_count-2 loop
   lat0:=radians(((v_coords->i->>1)::double precision+(v_coords->(i+1)->>1)::double precision+p_lat)/3.0);
   ax:=radians((v_coords->i->>0)::double precision)*6371000.0*cos(lat0);
   ay:=radians((v_coords->i->>1)::double precision)*6371000.0;
   bx:=radians((v_coords->(i+1)->>0)::double precision)*6371000.0*cos(lat0);
   byy:=radians((v_coords->(i+1)->>1)::double precision)*6371000.0;
   px:=radians(p_lng)*6371000.0*cos(lat0); py:=radians(p_lat)*6371000.0;
   dx:=bx-ax; dy:=byy-ay; seg_len:=sqrt(dx*dx+dy*dy);
   if seg_len>0 then
     t:=greatest(0,least(1,((px-ax)*dx+(py-ay)*dy)/(seg_len*seg_len)));
     dist:=sqrt((px-(ax+t*dx))^2+(py-(ay+t*dy))^2);
     if dist<nearest then nearest:=dist; nearest_offset:=cum_len+t*seg_len; end if;
     cum_len:=cum_len+seg_len;
   end if;
 end loop;
 distance_m:=round(nearest)::integer; offset_m:=round(nearest_offset)::integer; return next;
end;
$function$;
revoke execute on function public.route_point_projection(jsonb,double precision,double precision) from public,anon,authenticated;

create or replace function public.request_seats(
 p_ride_id uuid,p_pickup_name text,p_dropoff_name text,p_pickup_order integer,p_dropoff_order integer,p_seats integer,p_offer numeric,
 p_pickup_lat double precision,p_pickup_lng double precision,p_dropoff_lat double precision,p_dropoff_lng double precision
)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_id uuid:=auth.uid(); v_ride public.rides%rowtype; v_booking_id uuid; v_pickup record; v_dropoff record;
begin
 if v_id is null then raise exception 'login_required'; end if;
 if not exists(select 1 from public.profiles where id=v_id and account_type='rider' and is_blocked=false) then raise exception 'rider_account_required'; end if;
 select * into v_ride from public.rides where id=p_ride_id for update;
 if not found or v_ride.ride_status<>'open' then raise exception 'ride_not_available'; end if;
 if v_ride.captain_id=v_id then raise exception 'cannot_book_own_ride'; end if;
 if p_seats<1 or p_seats>13 or p_offer<0 then raise exception 'invalid_booking_details'; end if;
 if v_ride.route_geometry is null or v_ride.route_distance_m is null then raise exception 'ride_route_geometry_missing'; end if;
 select * into v_pickup from public.route_point_projection(v_ride.route_geometry,p_pickup_lat,p_pickup_lng);
 select * into v_dropoff from public.route_point_projection(v_ride.route_geometry,p_dropoff_lat,p_dropoff_lng);
 if v_pickup.distance_m>500 or v_dropoff.distance_m>500 then raise exception 'pickup_dropoff_off_route'; end if;
 if v_pickup.offset_m<0 or v_dropoff.offset_m<=v_pickup.offset_m or v_dropoff.offset_m>v_ride.route_distance_m+1000 then raise exception 'invalid_route_segment'; end if;
 insert into public.bookings(ride_id,passenger_id,pickup_name,dropoff_name,pickup_stop_order,dropoff_stop_order,
   pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,pickup_route_offset_m,dropoff_route_offset_m,quoted_fare_egp,seats_requested,passenger_offer_egp)
 values(p_ride_id,v_id,p_pickup_name,p_dropoff_name,p_pickup_order,p_dropoff_order,
   p_pickup_lat,p_pickup_lng,p_dropoff_lat,p_dropoff_lng,v_pickup.offset_m,v_dropoff.offset_m,p_offer,p_seats,p_offer)
 returning id into v_booking_id;
 insert into public.booking_offer_history(booking_id,offered_by,amount_egp) values(v_booking_id,v_id,p_offer);
 return v_booking_id;
end;
$function$;
revoke execute on function public.request_seats(uuid,text,text,integer,integer,integer,numeric,double precision,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.request_seats(uuid,text,text,integer,integer,integer,numeric,double precision,double precision,double precision,double precision) to authenticated;
