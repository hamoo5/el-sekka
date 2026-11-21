-- Fixed weekly route lines: private car, Suzuki and microbus only.
create table public.sekka_lines (
  id uuid primary key default gen_random_uuid(),
  captain_id uuid not null references public.profiles(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  title text not null,
  origin_name text not null,
  destination_name text not null,
  description text,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint sekka_lines_title_chk check (length(btrim(title)) between 3 and 100),
  constraint sekka_lines_route_chk check (length(btrim(origin_name)) > 0 and length(btrim(destination_name)) > 0 and origin_name <> destination_name)
);
create table public.sekka_line_stops (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.sekka_lines(id) on delete cascade,
  stop_order integer not null,
  stop_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  can_pickup boolean not null default true,
  can_dropoff boolean not null default true,
  constraint sekka_line_stops_order_chk check (stop_order >= 0),
  constraint sekka_line_stops_lat_chk check (latitude between -90 and 90),
  constraint sekka_line_stops_lng_chk check (longitude between -180 and 180),
  unique(line_id, stop_order)
);
create table public.sekka_line_schedules (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.sekka_lines(id) on delete cascade,
  service_days smallint[] not null,
  departure_time time not null,
  seats_total integer not null,
  seat_price_egp numeric(10,2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint sekka_line_schedules_days_chk check (cardinality(service_days) between 1 and 7 and service_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint sekka_line_schedules_seats_chk check (seats_total between 1 and 13),
  constraint sekka_line_schedules_price_chk check (seat_price_egp >= 0),
  unique(line_id, departure_time, service_days)
);
create table public.sekka_line_runs (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.sekka_lines(id) on delete restrict,
  schedule_id uuid not null references public.sekka_line_schedules(id) on delete restrict,
  departure_at timestamptz not null,
  seats_total integer not null,
  seats_available integer not null,
  run_status text not null default 'open' check (run_status in ('open','cancelled','completed')),
  created_at timestamptz not null default now(),
  constraint sekka_line_runs_seats_chk check (seats_total >= 1 and seats_available between 0 and seats_total),
  unique(schedule_id, departure_at)
);
create table public.sekka_line_bookings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.sekka_line_runs(id) on delete restrict,
  passenger_id uuid not null references public.profiles(id) on delete restrict,
  pickup_stop_id uuid not null references public.sekka_line_stops(id) on delete restrict,
  dropoff_stop_id uuid not null references public.sekka_line_stops(id) on delete restrict,
  seats_requested integer not null,
  seat_price_egp numeric(10,2) not null,
  total_price_egp numeric(10,2) not null,
  booking_status text not null default 'confirmed' check (booking_status in ('confirmed','cancelled','completed')),
  created_at timestamptz not null default now(),
  constraint sekka_line_bookings_seats_chk check (seats_requested between 1 and 13),
  constraint sekka_line_bookings_price_chk check (seat_price_egp >= 0 and total_price_egp >= 0)
);

create index sekka_lines_captain_idx on public.sekka_lines(captain_id);
create index sekka_lines_vehicle_idx on public.sekka_lines(vehicle_id);
create index sekka_line_stops_line_order_idx on public.sekka_line_stops(line_id, stop_order);
create index sekka_line_schedules_line_idx on public.sekka_line_schedules(line_id);
create index sekka_line_runs_departure_idx on public.sekka_line_runs(departure_at) where run_status='open';
create index sekka_line_bookings_passenger_idx on public.sekka_line_bookings(passenger_id, created_at desc);
create index sekka_line_bookings_run_idx on public.sekka_line_bookings(run_id);

alter table public.sekka_lines enable row level security;
alter table public.sekka_line_stops enable row level security;
alter table public.sekka_line_schedules enable row level security;
alter table public.sekka_line_runs enable row level security;
alter table public.sekka_line_bookings enable row level security;

grant select on public.sekka_lines, public.sekka_line_stops, public.sekka_line_schedules, public.sekka_line_runs, public.sekka_line_bookings to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.sekka_lines, public.sekka_line_stops, public.sekka_line_schedules, public.sekka_line_runs, public.sekka_line_bookings from anon, authenticated;

create policy sekka_lines_read_visible on public.sekka_lines for select to authenticated
using ((approval_status='approved' and is_active) or captain_id=(select auth.uid()) or (select public.is_admin()));
create policy sekka_line_stops_read_visible on public.sekka_line_stops for select to authenticated
using (exists(select 1 from public.sekka_lines l where l.id=line_id and ((l.approval_status='approved' and l.is_active) or l.captain_id=(select auth.uid()) or (select public.is_admin()))));
create policy sekka_line_schedules_read_visible on public.sekka_line_schedules for select to authenticated
using (exists(select 1 from public.sekka_lines l where l.id=line_id and ((l.approval_status='approved' and l.is_active) or l.captain_id=(select auth.uid()) or (select public.is_admin()))));
create policy sekka_line_runs_read_visible on public.sekka_line_runs for select to authenticated
using (exists(select 1 from public.sekka_lines l where l.id=line_id and ((l.approval_status='approved' and l.is_active) or l.captain_id=(select auth.uid()) or (select public.is_admin()))));
create policy sekka_line_bookings_read_parties on public.sekka_line_bookings for select to authenticated
using (passenger_id=(select auth.uid()) or (select public.is_admin()) or exists(select 1 from public.sekka_line_runs r join public.sekka_lines l on l.id=r.line_id where r.id=run_id and l.captain_id=(select auth.uid())));

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
 update public.sekka_line_stops set can_pickup=false where line_id=v_line_id and stop_order=(select min(stop_order) from public.sekka_line_stops where line_id=v_line_id);
 update public.sekka_line_stops set can_dropoff=false where line_id=v_line_id and stop_order=(select max(stop_order) from public.sekka_line_stops where line_id=v_line_id);
 insert into public.sekka_line_schedules(line_id,service_days,departure_time,seats_total,seat_price_egp)
 values(v_line_id,(select array_agg(distinct d order by d) from unnest(p_service_days) d),p_departure_time,p_seats,p_seat_price);
 return v_line_id;
end;
$function$;

create or replace function public.admin_review_sekka_line(p_line_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'admin_required'; end if;
 update public.sekka_lines set approval_status=case when p_approve then 'approved' else 'rejected' end,is_active=coalesce(p_approve,false) where id=p_line_id and approval_status='pending';
 if not found then raise exception 'pending_line_not_found'; end if;
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
 v_booking_id uuid;
begin
 if v_id is null then raise exception 'login_required'; end if;
 if not exists(select 1 from public.profiles where id=v_id and role='passenger' and coalesce(is_blocked,true)=false) then raise exception 'rider_account_required'; end if;
 if p_seats is null or p_seats<1 or p_seats>13 or p_departure_at is null or p_departure_at<=now() or p_departure_at>now()+interval '90 days' then raise exception 'invalid_booking_request'; end if;
 select * into v_schedule from public.sekka_line_schedules where id=p_schedule_id and is_active=true;
 if not found then raise exception 'line_schedule_not_found'; end if;
 select * into v_line from public.sekka_lines where id=v_schedule.line_id and approval_status='approved' and is_active=true;
 if not found then raise exception 'line_not_available'; end if;
 if not (extract(dow from (p_departure_at at time zone 'Africa/Cairo'))::smallint = any(v_schedule.service_days))
    or (p_departure_at at time zone 'Africa/Cairo')::time <> v_schedule.departure_time then raise exception 'departure_not_in_schedule'; end if;
 select * into v_pickup from public.sekka_line_stops where id=p_pickup_stop_id and line_id=v_line.id and can_pickup=true;
 select * into v_dropoff from public.sekka_line_stops where id=p_dropoff_stop_id and line_id=v_line.id and can_dropoff=true;
 if v_pickup.id is null or v_dropoff.id is null or v_pickup.stop_order>=v_dropoff.stop_order then raise exception 'invalid_boarding_stops'; end if;
 insert into public.sekka_line_runs(line_id,schedule_id,departure_at,seats_total,seats_available)
 values(v_line.id,v_schedule.id,p_departure_at,v_schedule.seats_total,v_schedule.seats_total)
 on conflict(schedule_id,departure_at) do nothing;
 select * into v_run from public.sekka_line_runs where schedule_id=v_schedule.id and departure_at=p_departure_at for update;
 if v_run.run_status<>'open' or v_run.seats_available<p_seats then raise exception 'not_enough_seats'; end if;
 update public.sekka_line_runs set seats_available=seats_available-p_seats where id=v_run.id;
 insert into public.sekka_line_bookings(run_id,passenger_id,pickup_stop_id,dropoff_stop_id,seats_requested,seat_price_egp,total_price_egp)
 values(v_run.id,v_id,v_pickup.id,v_dropoff.id,p_seats,v_schedule.seat_price_egp,v_schedule.seat_price_egp*p_seats)
 returning id into v_booking_id;
 return v_booking_id;
end;
$function$;

create or replace function public.cancel_sekka_line_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
 v_id uuid:=auth.uid();
 v_booking public.sekka_line_bookings%rowtype;
 v_run public.sekka_line_runs%rowtype;
begin
 if v_id is null then raise exception 'login_required'; end if;
 select * into v_booking from public.sekka_line_bookings where id=p_booking_id and passenger_id=v_id and booking_status='confirmed' for update;
 if not found then raise exception 'booking_not_cancellable'; end if;
 select * into v_run from public.sekka_line_runs where id=v_booking.run_id for update;
 if v_run.departure_at<=now() then raise exception 'departure_already_started'; end if;
 update public.sekka_line_bookings set booking_status='cancelled' where id=p_booking_id;
 update public.sekka_line_runs set seats_available=least(seats_total,seats_available+v_booking.seats_requested) where id=v_run.id;
end;
$function$;

revoke all on function public.create_sekka_line(uuid,text,text,text,text,jsonb,smallint[],time,integer,numeric) from public,anon;
grant execute on function public.create_sekka_line(uuid,text,text,text,text,jsonb,smallint[],time,integer,numeric) to authenticated;
revoke all on function public.admin_review_sekka_line(uuid,boolean) from public,anon;
grant execute on function public.admin_review_sekka_line(uuid,boolean) to authenticated;
revoke all on function public.request_sekka_line_seats(uuid,timestamptz,uuid,uuid,integer) from public,anon;
grant execute on function public.request_sekka_line_seats(uuid,timestamptz,uuid,uuid,integer) to authenticated;
revoke all on function public.cancel_sekka_line_booking(uuid) from public,anon;
grant execute on function public.cancel_sekka_line_booking(uuid) to authenticated;
