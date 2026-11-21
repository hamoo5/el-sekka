-- Tighten the fixed-line tables to authenticated read-only access and correct endpoint stop permissions.
revoke all on public.sekka_lines, public.sekka_line_stops, public.sekka_line_schedules, public.sekka_line_runs, public.sekka_line_bookings from public, anon, authenticated;
grant select on public.sekka_lines, public.sekka_line_stops, public.sekka_line_schedules, public.sekka_line_runs, public.sekka_line_bookings to authenticated;

update public.sekka_line_stops s
set can_pickup = true, can_dropoff = true
where exists (select 1 from public.sekka_lines l where l.id=s.line_id);

update public.sekka_line_stops s
set can_dropoff = false
where stop_order=(select min(s2.stop_order) from public.sekka_line_stops s2 where s2.line_id=s.line_id);

update public.sekka_line_stops s
set can_pickup = false
where stop_order=(select max(s2.stop_order) from public.sekka_line_stops s2 where s2.line_id=s.line_id);
