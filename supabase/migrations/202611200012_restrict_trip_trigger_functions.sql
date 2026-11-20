-- Trigger-only functions must not be callable through the public Data API.
revoke execute on function public.handle_trip_request_chat_and_tracking() from PUBLIC;
revoke execute on function public.handle_trip_request_chat_and_tracking() from anon, authenticated;
revoke execute on function public.reject_phone_number_in_trip_message() from PUBLIC;
revoke execute on function public.reject_phone_number_in_trip_message() from anon, authenticated;
