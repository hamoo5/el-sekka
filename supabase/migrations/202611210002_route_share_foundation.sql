-- Route-sharing phase 1 foundation: store route geometry and each booking's actual segment.
-- Additive only; existing ride and booking rows remain unchanged.
alter table public.rides
  add column if not exists route_geometry jsonb,
  add column if not exists route_distance_m integer,
  add column if not exists route_duration_seconds integer;

alter table public.rides
  drop constraint if exists rides_route_geometry_shape_check;
alter table public.rides
  add constraint rides_route_geometry_shape_check
  check (
    route_geometry is null
    or (
      jsonb_typeof(route_geometry) = 'object'
      and route_geometry->>'type' = 'LineString'
      and jsonb_typeof(route_geometry->'coordinates') = 'array'
      and jsonb_array_length(route_geometry->'coordinates') >= 2
    )
  ) not valid;

alter table public.rides
  drop constraint if exists rides_route_metrics_positive_check;
alter table public.rides
  add constraint rides_route_metrics_positive_check
  check (
    (route_distance_m is null or route_distance_m > 0)
    and (route_duration_seconds is null or route_duration_seconds > 0)
  ) not valid;

alter table public.bookings
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists dropoff_lat double precision,
  add column if not exists dropoff_lng double precision,
  add column if not exists pickup_route_offset_m integer,
  add column if not exists dropoff_route_offset_m integer,
  add column if not exists quoted_fare_egp numeric(10,2),
  add column if not exists seat_reserved_at timestamptz;

alter table public.bookings
  drop constraint if exists bookings_route_coordinates_pair_check;
alter table public.bookings
  add constraint bookings_route_coordinates_pair_check
  check (
    (pickup_lat is null and pickup_lng is null)
    or (pickup_lat between -90 and 90 and pickup_lng between -180 and 180)
  ) not valid;

alter table public.bookings
  drop constraint if exists bookings_dropoff_coordinates_pair_check;
alter table public.bookings
  add constraint bookings_dropoff_coordinates_pair_check
  check (
    (dropoff_lat is null and dropoff_lng is null)
    or (dropoff_lat between -90 and 90 and dropoff_lng between -180 and 180)
  ) not valid;

alter table public.bookings
  drop constraint if exists bookings_route_offsets_order_check;
alter table public.bookings
  add constraint bookings_route_offsets_order_check
  check (
    (pickup_route_offset_m is null and dropoff_route_offset_m is null)
    or (
      pickup_route_offset_m >= 0
      and dropoff_route_offset_m > pickup_route_offset_m
    )
  ) not valid;

alter table public.bookings
  drop constraint if exists bookings_quoted_fare_nonnegative_check;
alter table public.bookings
  add constraint bookings_quoted_fare_nonnegative_check
  check (quoted_fare_egp is null or quoted_fare_egp >= 0) not valid;

create index if not exists bookings_ride_segment_status_idx
  on public.bookings (ride_id, pickup_route_offset_m, dropoff_route_offset_m, booking_status);

comment on column public.rides.route_geometry is
  'GeoJSON LineString for the captain-published road route; coordinates use [longitude, latitude].';
comment on column public.bookings.pickup_route_offset_m is
  'Distance along the published route from its start to the passenger pickup projection, in meters.';
comment on column public.bookings.dropoff_route_offset_m is
  'Distance along the published route from its start to the passenger dropoff projection, in meters.';
comment on column public.bookings.quoted_fare_egp is
  'Fare calculated for the passenger segment and shown before captain acceptance.';
