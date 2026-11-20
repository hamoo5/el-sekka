-- Expose only the other participant's display name to an authenticated trip participant.
create or replace function public.get_trip_counterparty_name(p_trip_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_other_id uuid; v_name text;
begin
 if v_uid is null then raise exception 'login_required'; end if;
 select case when passenger_id=v_uid then accepted_captain_id when accepted_captain_id=v_uid then passenger_id else null end
 into v_other_id from public.trip_requests where id=p_trip_id;
 if v_other_id is null then raise exception 'trip_participant_required'; end if;
 select display_name into v_name from public.profiles where id=v_other_id;
 return coalesce(nullif(btrim(v_name),''),'مستخدم السكة');
end;
$$;
revoke all on function public.get_trip_counterparty_name(uuid) from PUBLIC,anon;
grant execute on function public.get_trip_counterparty_name(uuid) to authenticated;
