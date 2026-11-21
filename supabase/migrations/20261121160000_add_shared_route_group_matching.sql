-- Match nearby shared-route requests as one captain-facing group.
create or replace function public.captain_reply_share_route_group(
 p_request_ids uuid[], p_vehicle_id uuid, p_action text, p_counter_price numeric default null
) returns integer
language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
 v_id uuid:=auth.uid();
 v_vehicle public.vehicles%rowtype;
 v_first public.share_route_requests%rowtype;
 v_request public.share_route_requests%rowtype;
 v_negotiation public.share_route_negotiations%rowtype;
 v_request_id uuid;
 v_count integer;
 v_total_seats integer:=0;
 v_origin_distance double precision;
 v_destination_distance double precision;
 v_time_difference double precision;
 v_negotiation_id uuid;
begin
 if v_id is null then raise exception 'login_required'; end if;
 if p_action not in ('accept','counter') then raise exception 'invalid_action'; end if;
 if p_action='counter' and (p_counter_price is null or p_counter_price<0) then raise exception 'invalid_counter_price'; end if;
 if p_request_ids is null or cardinality(p_request_ids)<1 or cardinality(p_request_ids)>10 then raise exception 'invalid_group_size'; end if;
 select count(distinct x)::integer into v_count from unnest(p_request_ids) as t(x);
 if v_count<>cardinality(p_request_ids) then raise exception 'duplicate_request_ids'; end if;

 perform public.require_captain_ready(v_id);
 select * into v_vehicle from public.vehicles
 where id=p_vehicle_id and captain_id=v_id and approval_status='approved' and is_active=true;
 if not found then raise exception 'approved_active_vehicle_required'; end if;
 if v_vehicle.vehicle_type not in ('private_car','suzuki','microbus') then raise exception 'invalid_vehicle_type'; end if;

 select * into v_first from public.share_route_requests
 where id=any(p_request_ids) and request_status='open' and ride_mode='scheduled_share'
 order by departure_at,id limit 1;
 if not found then raise exception 'share_request_not_available'; end if;

 for v_request_id in select x from unnest(p_request_ids) as t(x) order by x loop
  select * into v_request from public.share_route_requests where id=v_request_id for update;
  if not found or v_request.request_status<>'open' or v_request.ride_mode<>'scheduled_share' then
   raise exception 'share_request_not_available';
  end if;
  if v_request.requester_id=v_id then raise exception 'cannot_reply_to_own_request'; end if;
  if v_request.preferred_vehicle_type is not null and v_request.preferred_vehicle_type<>v_vehicle.vehicle_type then
   raise exception 'vehicle_type_mismatch';
  end if;

  v_origin_distance:=6371000*acos(least(1::double precision,greatest(-1::double precision,
   sin(radians(v_first.origin_lat))*sin(radians(v_request.origin_lat))+
   cos(radians(v_first.origin_lat))*cos(radians(v_request.origin_lat))*
   cos(radians(v_request.origin_lng-v_first.origin_lng)))));
  v_destination_distance:=6371000*acos(least(1::double precision,greatest(-1::double precision,
   sin(radians(v_first.destination_lat))*sin(radians(v_request.destination_lat))+
   cos(radians(v_first.destination_lat))*cos(radians(v_request.destination_lat))*
   cos(radians(v_request.destination_lng-v_first.destination_lng)))));
  v_time_difference:=abs(extract(epoch from (v_request.departure_at-v_first.departure_at)));
  if v_origin_distance>2000 or v_destination_distance>2000 or v_time_difference>1800 then
   raise exception 'requests_not_close_enough_to_group';
  end if;
  v_total_seats:=v_total_seats+v_request.seats_requested;
 end loop;

 if v_total_seats>v_vehicle.passenger_capacity then raise exception 'group_exceeds_vehicle_capacity'; end if;

 for v_request_id in select x from unnest(p_request_ids) as t(x) order by x loop
  select * into v_request from public.share_route_requests where id=v_request_id;
  select * into v_negotiation from public.share_route_negotiations
   where request_id=v_request_id and captain_id=v_id for update;
  if found then
   if v_negotiation.negotiation_status<>'pending' then raise exception 'negotiation_not_replyable'; end if;
   update public.share_route_negotiations set vehicle_id=p_vehicle_id where id=v_negotiation.id;
   v_negotiation_id:=v_negotiation.id;
  else
   insert into public.share_route_negotiations(request_id,requester_id,captain_id,vehicle_id,requester_offer_egp)
   values(v_request.id,v_request.requester_id,v_id,p_vehicle_id,v_request.requester_seat_price_egp)
   returning id into v_negotiation_id;
   insert into public.share_route_offer_history(negotiation_id,offered_by,amount_egp)
   values(v_negotiation_id,v_request.requester_id,v_request.requester_seat_price_egp);
  end if;

  if p_action='accept' then
   update public.share_route_negotiations
   set agreed_price_egp=requester_offer_egp,captain_counter_offer_egp=null,negotiation_status='accepted'
   where id=v_negotiation_id;
  else
   update public.share_route_negotiations
   set captain_counter_offer_egp=p_counter_price,agreed_price_egp=null,negotiation_status='counter_offer'
   where id=v_negotiation_id;
   insert into public.share_route_offer_history(negotiation_id,offered_by,amount_egp)
   values(v_negotiation_id,v_id,p_counter_price);
  end if;
 end loop;
 return v_count;
end;
$function$;

revoke all on function public.captain_reply_share_route_group(uuid[],uuid,text,numeric) from public,anon;
grant execute on function public.captain_reply_share_route_group(uuid[],uuid,text,numeric) to authenticated;
