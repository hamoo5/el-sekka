-- Correct fixed-line endpoint permissions and validate that the first/last stops match the line.
create or replace function public.create_sekka_line(
 p_vehicle_id uuid, p_title text, p_origin_name text, p_destination_name text,
 p_description text, p_stops jsonb, p_service_days smallint[], p_departure_time time,
 p_seats integer, p_seat_price numeric
) returns uuid
language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
 v_id uuid:=auth.uid();
 v_vehicle public.vehicles%rowtype;
 v_line_id uuid;
 v_stop jsonb;
 v_order integer:=0;
begin
 if v_id is null then raise exception 'login_required'; end if;
 if not exists(select 1 from public.profiles where id=v_id and role='captain' and coalesce(is_blocked,true)=false) then raise exception 'captain_account_required'; end if;
 perform public.require_captain_ready(v_id);
 select * into v_vehicle from public.vehicles where id=p_vehicle_id and captain_id=v_id and approval_status='approved' and is_active=true;
 if not found then raise exception 'approved_active_vehicle_required'; end if;
 if v_vehicle.vehicle_type not in ('private_car','suzuki','microbus') then raise exception 'invalid_vehicle_type'; end if;
 if p_seats is null or p_seats<1 or p_seats>v_vehicle.passenger_capacity or p_seats>13 then raise exception 'invalid_seat_capacity'; end if;
 if nullif(btrim(p_title),'') is null or nullif(btrim(p_origin_name),'') is null or nullif(btrim(p_destination_name),'') is null or btrim(p_origin_name)=btrim(p_destination_name) then raise exception 'invalid_line_details'; end if;
 if jsonb_typeof(p_stops)<>'array' or jsonb_array_length(p_stops)<2 or jsonb_array_length(p_stops)>30 then raise exception 'invalid_line_stops'; end if;
 if btrim(coalesce(p_stops->0->>'name',''))<>btrim(p_origin_name)
    or btrim(coalesce(p_stops->(jsonb_array_length(p_stops)-1)->>'name',''))<>btrim(p_destination_name) then
   raise exception 'line_endpoint_names_mismatch';
 end if;
 if p_service_days is null or cardinality(p_service_days)<1 or cardinality(p_service_days)>7 or not (p_service_days <@ array[0,1,2,3,4,5,6]::smallint[]) then raise exception 'invalid_service_days'; end if;
 if p_departure_time is null or p_seat_price is null or p_seat_price<0 then raise exception 'invalid_schedule'; end if;
 insert into public.sekka_lines(captain_id,vehicle_id,title,origin_name,destination_name,description)
 values(v_id,p_vehicle_id,btrim(p_title),btrim(p_origin_name),btrim(p_destination_name),nullif(btrim(p_description),'')) returning id into v_line_id;
 for v_stop in select value from jsonb_array_elements(p_stops) loop
   if nullif(btrim(v_stop->>'name'),'') is null
      or coalesce((v_stop->>'lat')::double precision,999) not between -90 and 90
      or coalesce((v_stop->>'lng')::double precision,999) not between -180 and 180 then
     raise exception 'invalid_stop_data';
   end if;
   insert into public.sekka_line_stops(line_id,stop_order,stop_name,latitude,longitude)
   values(v_line_id,v_order,btrim(v_stop->>'name'),(v_stop->>'lat')::double precision,(v_stop->>'lng')::double precision);
   v_order:=v_order+1;
 end loop;
 update public.sekka_line_stops set can_dropoff=false where line_id=v_line_id and stop_order=(select min(stop_order) from public.sekka_line_stops where line_id=v_line_id);
 update public.sekka_line_stops set can_pickup=false where line_id=v_line_id and stop_order=(select max(stop_order) from public.sekka_line_stops where line_id=v_line_id);
 insert into public.sekka_line_schedules(line_id,service_days,departure_time,seats_total,seat_price_egp)
 values(v_line_id,(select array_agg(distinct d order by d) from unnest(p_service_days) d),p_departure_time,p_seats,p_seat_price);
 return v_line_id;
end;
$function$;

revoke all on function public.create_sekka_line(uuid,text,text,text,text,jsonb,smallint[],time,integer,numeric) from public,anon;
grant execute on function public.create_sekka_line(uuid,text,text,text,text,jsonb,smallint[],time,integer,numeric) to authenticated;
