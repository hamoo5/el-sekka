-- Remove unused RPC entry points; these helpers are invoked internally by SECURITY DEFINER workflows.
revoke all on function public.passenger_reply_booking(uuid,text,numeric) from public, anon, authenticated;
revoke all on function public.require_captain_ready(uuid) from public, anon, authenticated;
revoke all on function public.require_captain_ready_for(uuid,timestamp with time zone) from public, anon, authenticated;
