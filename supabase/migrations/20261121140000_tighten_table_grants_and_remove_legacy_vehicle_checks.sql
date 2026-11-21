-- Tighten table grants and remove obsolete vehicle-category checks.
begin;

-- Remove obsolete broad table grants that bypass row-level security controls.
revoke all privileges on table public.favorite_captains, public.points_ledger,
  public.referrals, public.rewards_ledger from public, anon, authenticated;

grant select, insert, update, delete on table public.favorite_captains to authenticated;
grant select on table public.points_ledger, public.referrals, public.rewards_ledger to authenticated;

-- Keep the current product's three vehicle categories as the only accepted values.
alter table public.vehicles drop constraint if exists vehicles_vehicle_type_check;
alter table public.share_route_requests
  drop constraint if exists share_route_requests_preferred_vehicle_type_check;

-- This helper is not used by the current client and reveals whether an email
-- is already registered under a different account type.
revoke all privileges on function public.check_signup_email_role(text,text)
  from public, anon, authenticated;

commit;
