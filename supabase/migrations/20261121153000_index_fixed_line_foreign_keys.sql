create index if not exists sekka_line_runs_line_id_idx on public.sekka_line_runs(line_id);
create index if not exists sekka_line_bookings_pickup_stop_idx on public.sekka_line_bookings(pickup_stop_id);
create index if not exists sekka_line_bookings_dropoff_stop_idx on public.sekka_line_bookings(dropoff_stop_id);
