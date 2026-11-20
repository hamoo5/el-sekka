-- Bind audio paths to their message sender and clear location sharing when trips end.
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.trip_messages'::regclass and conname='trip_messages_audio_path_owner_check') then
  alter table public.trip_messages add constraint trip_messages_audio_path_owner_check
  check(message_type<>'audio' or storage_path like trip_id::text||'/'||sender_id::text||'/%');
 end if;
end $$;

create or replace function public.handle_trip_request_chat_and_tracking()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.request_status='accepted' and old.request_status is distinct from 'accepted' and new.accepted_captain_id is not null then
  insert into public.trip_conversations(trip_id,passenger_id,captain_id) values(new.id,new.passenger_id,new.accepted_captain_id) on conflict(trip_id) do nothing;
 end if;
 if new.request_status in ('completed','cancelled') and old.request_status is distinct from new.request_status then
  update public.trip_conversations set closed_at=coalesce(closed_at,now()),audio_cleanup_after=coalesce(audio_cleanup_after,now()+interval '7 days') where trip_id=new.id;
  insert into public.trip_chat_audio_cleanup(trip_id,message_id,storage_path,delete_after)
  select m.trip_id,m.id,m.storage_path,now()+interval '7 days' from public.trip_messages m
  where m.trip_id=new.id and m.message_type='audio' and m.storage_path is not null
  on conflict(message_id) do nothing;
  update public.trip_tracking_links set revoked_at=coalesce(revoked_at,now()) where trip_id=new.id;
  update public.driver_locations set trip_id=null where trip_id=new.id;
 end if;
 return new;
end;
$$;
revoke execute on function public.handle_trip_request_chat_and_tracking() from PUBLIC,anon,authenticated;
