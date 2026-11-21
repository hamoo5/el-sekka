-- Retire legacy RPC overloads not used by the current client.
begin;

revoke all privileges on function public.admin_review_captain(uuid,boolean,text) from public, anon, authenticated;
revoke all privileges on function public.admin_review_vehicle(uuid,boolean) from public, anon, authenticated;
revoke all privileges on function public.apply_as_captain(text,date) from public, anon, authenticated;
revoke all privileges on function public.submit_vehicle(text,text,text,integer,text,text,integer,boolean,boolean,boolean,boolean) from public, anon, authenticated;
revoke all privileges on function public.submit_captain_application(text,text,date) from public, anon, authenticated;
revoke all privileges on function public.submit_captain_application_v2(text,text,date,text,text,text,integer,text,text,integer,boolean,boolean,boolean,boolean,text,text,text,text) from public, anon, authenticated;
revoke all privileges on function public.review_captain_application(uuid,text,text) from public, anon, authenticated;
revoke all privileges on function public.create_share_ride(uuid,text,text,double precision,double precision,text,double precision,double precision,text,timestamp with time zone,integer,numeric) from public, anon, authenticated;
revoke all privileges on function public.request_seats(uuid,text,text,integer,integer,integer,numeric) from public, anon, authenticated;

drop policy if exists captain_applications_admin_read on public.captain_applications;

commit;
