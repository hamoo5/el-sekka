-- Explicit server-side privileges; RLS still blocks anon/authenticated access to internal tables.
grant select,insert,update,delete on public.trip_conversations to service_role;
grant select,insert,update,delete on public.trip_messages to service_role;
grant select,insert,update,delete on public.trip_chat_audio_cleanup to service_role;
grant select,insert,update,delete on public.trip_tracking_links to service_role;
grant select,insert,update,delete on public.driver_locations to service_role;
