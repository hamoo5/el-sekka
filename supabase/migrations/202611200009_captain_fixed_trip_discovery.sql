-- Eligible captains can discover open fixed-fare requests; RLS hides them from other roles.
create index if not exists trip_requests_searching_created_at_idx
  on public.trip_requests (created_at)
  where request_status = 'searching';

drop policy if exists trip_requests_read_searching_eligible_captains on public.trip_requests;
create policy trip_requests_read_searching_eligible_captains
  on public.trip_requests
  for select
  to authenticated
  using (
    request_status = 'searching'
    and passenger_id <> (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'captain'
        and p.is_blocked = false
    )
    and exists (
      select 1 from public.captain_applications ca
      where ca.user_id = (select auth.uid())
        and ca.application_status = 'approved'
    )
    and exists (
      select 1 from public.captain_subscriptions cs
      where cs.captain_id = (select auth.uid())
        and cs.payment_status = 'approved'
        and cs.starts_at <= now()
        and cs.expires_at > now()
    )
  );
