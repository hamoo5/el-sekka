create or replace function public.create_share_ride(
  p_vehicle_id uuid,p_ride_mode text,p_origin_name text,p_origin_lat double precision,p_origin_lng double precision,
  p_destination_name text,p_destination_lat double precision,p_destination_lng double precision,p_route_description text,
  p_departure_at timestamptz,p_seats integer,p_seat_price numeric,p_route_geometry jsonb,p_route_distance_m integer,p_route_duration_seconds integer
)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_ride_id uuid;
begin
  if p_route_geometry is null or jsonb_typeof(p_route_geometry)<>'object'
    or p_route_geometry->>'type'<>'LineString'
    or jsonb_typeof(p_route_geometry->'coordinates')<>'array'
    or jsonb_array_length(p_route_geometry->'coordinates')<2
  then raise exception 'valid_route_geometry_required'; end if;
  if p_route_distance_m is null or p_route_distance_m<=0
    or p_route_duration_seconds is null or p_route_duration_seconds<=0
  then raise exception 'valid_route_metrics_required'; end if;
  v_ride_id:=public.create_share_ride(
    p_vehicle_id,p_ride_mode,p_origin_name,p_origin_lat,p_origin_lng,p_destination_name,p_destination_lat,p_destination_lng,
    p_route_description,p_departure_at,p_seats,p_seat_price
  );
  update public.rides set route_geometry=p_route_geometry,route_distance_m=p_route_distance_m,route_duration_seconds=p_route_duration_seconds
  where id=v_ride_id and captain_id=auth.uid();
  if not found then raise exception 'ride_route_save_failed'; end if;
  return v_ride_id;
end;
$function$;
revoke execute on function public.create_share_ride(uuid,text,text,double precision,double precision,text,double precision,double precision,text,timestamptz,integer,numeric,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.create_share_ride(uuid,text,text,double precision,double precision,text,double precision,double precision,text,timestamptz,integer,numeric,jsonb,integer,integer) to authenticated;
