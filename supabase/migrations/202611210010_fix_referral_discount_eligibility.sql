-- El Sekka: only referred passengers receive the referral trip discount.
-- Existing trip requests and reservation balances are intentionally untouched.

create or replace function public.server_create_fixed_trip_request(
  p_passenger_id uuid,
  p_vehicle_type text,
  p_origin_name text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_destination_name text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_scheduled_at timestamp with time zone,
  p_is_scheduled boolean,
  p_passenger_count integer,
  p_distance_km numeric,
  p_pickup_note text,
  p_ride_preferences jsonb,
  p_use_points boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request_id uuid;
  v_profile public.profiles%rowtype;
  v_fare numeric(10,2);
  v_discount numeric(10,2);
  v_source text;
  v_referral_available boolean := false;
  v_points_available boolean := false;
begin
  v_request_id := public.server_create_fixed_trip_request(
    p_passenger_id,p_vehicle_type,p_origin_name,p_origin_lat,p_origin_lng,
    p_destination_name,p_destination_lat,p_destination_lng,p_scheduled_at,
    p_is_scheduled,p_passenger_count,p_distance_km,p_pickup_note,p_ride_preferences
  );

  select * into v_profile from public.profiles
  where id=p_passenger_id for update;
  select fixed_fare_egp into v_fare from public.trip_requests where id=v_request_id;

  v_referral_available :=
    v_profile.referred_by is not null
    and (coalesce(v_profile.referral_discount_trips_used,0)
      + coalesce(v_profile.referral_discount_trips_reserved,0)) < 3;

  v_points_available := coalesce(p_use_points,false) and coalesce(v_profile.points,0)>=100;

  -- Both discounts are 15%, capped at EGP 15. Ties prefer referral to preserve points.
  if v_referral_available then
    v_source := 'referral';
    v_discount := least(round(v_fare*0.15,2),15);
  end if;
  if v_points_available then
    if v_discount is null or least(round(v_fare*0.15,2),15)>v_discount then
      v_source := 'points';
      v_discount := least(round(v_fare*0.15,2),15);
    end if;
  end if;

  if v_source='points' then
    update public.profiles set points=points-100 where id=p_passenger_id;
    insert into public.points_ledger(user_id,points_delta,reason,reference_type,reference_id)
    values(p_passenger_id,-100,'trip_points_reserved','trip',v_request_id)
    on conflict(user_id,reason,reference_type,reference_id) do nothing;
    update public.trip_requests
    set points_used=100,points_reserved=100,
        points_discount_amount_egp=v_discount
    where id=v_request_id;
  elsif v_source='referral' then
    update public.profiles
    set referral_discount_trips_reserved=referral_discount_trips_reserved+1
    where id=p_passenger_id;
    update public.trip_requests set referral_discount_reserved=true where id=v_request_id;
  end if;

  if v_discount is not null and v_discount>0 then
    update public.trip_requests
    set fare_before_discount=v_fare,
        fixed_fare_egp=greatest(0,v_fare-v_discount),
        discount_source=v_source,
        discount_amount_egp=v_discount
    where id=v_request_id;
  end if;
  return v_request_id;
exception when others then
  raise;
end;
$function$;
