-- Prevent simultaneous fixed trips for one captain so live location stays bound to one passenger.
create unique index if not exists trip_requests_one_active_trip_per_captain_idx
on public.trip_requests(accepted_captain_id)
where accepted_captain_id is not null and request_status in ('accepted','in_progress');
