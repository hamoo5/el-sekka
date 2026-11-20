-- Private in-app chat, trip location updates and secure tracking-link records.
create table if not exists public.trip_conversations (
  trip_id uuid primary key references public.trip_requests(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  captain_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  audio_cleanup_after timestamptz
);
alter table public.trip_conversations enable row level security;
revoke all on public.trip_conversations from anon, authenticated;
grant select on public.trip_conversations to authenticated;

create table if not exists public.trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trip_conversations(trip_id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message_type text not null check (message_type in ('text','audio')),
  body text,
  storage_path text,
  created_at timestamptz not null default now(),
  constraint trip_messages_payload_check check (
    (message_type='text' and body is not null and char_length(btrim(body)) between 1 and 1200 and storage_path is null)
    or (message_type='audio' and body is null and storage_path is not null)
  )
);
create index if not exists trip_messages_trip_created_idx on public.trip_messages(trip_id,created_at);
alter table public.trip_messages enable row level security;
revoke all on public.trip_messages from anon, authenticated;
grant select,insert on public.trip_messages to authenticated;

drop policy if exists trip_conversations_read_participants on public.trip_conversations;
create policy trip_conversations_read_participants on public.trip_conversations for select to authenticated
using (passenger_id=(select auth.uid()) or captain_id=(select auth.uid()));

drop policy if exists trip_messages_read_participants on public.trip_messages;
create policy trip_messages_read_participants on public.trip_messages for select to authenticated
using (exists(select 1 from public.trip_conversations c where c.trip_id=trip_messages.trip_id and (c.passenger_id=(select auth.uid()) or c.captain_id=(select auth.uid()))));

drop policy if exists trip_messages_insert_active_participant on public.trip_messages;
create policy trip_messages_insert_active_participant on public.trip_messages for insert to authenticated
with check (
 sender_id=(select auth.uid()) and exists(
  select 1 from public.trip_conversations c join public.trip_requests tr on tr.id=c.trip_id
  where c.trip_id=trip_messages.trip_id and c.closed_at is null
    and tr.request_status in ('accepted','in_progress')
    and (c.passenger_id=(select auth.uid()) or c.captain_id=(select auth.uid()))
 )
);

create table if not exists public.trip_chat_audio_cleanup (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trip_requests(id) on delete cascade,
 message_id uuid not null references public.trip_messages(id) on delete cascade,
 storage_path text not null,
 delete_after timestamptz not null,
 cleaned_at timestamptz,
 unique(message_id)
);
alter table public.trip_chat_audio_cleanup enable row level security;
revoke all on public.trip_chat_audio_cleanup from anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('trip-audio','trip-audio',false,1048576,array['audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict(id) do update set public=false,file_size_limit=1048576,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists trip_audio_read_participants on storage.objects;
create policy trip_audio_read_participants on storage.objects for select to authenticated
using(bucket_id='trip-audio' and exists(select 1 from public.trip_conversations c where c.trip_id::text=(storage.foldername(name))[1] and (c.passenger_id=(select auth.uid()) or c.captain_id=(select auth.uid()))));

drop policy if exists trip_audio_insert_sender on storage.objects;
create policy trip_audio_insert_sender on storage.objects for insert to authenticated
with check(bucket_id='trip-audio' and (storage.foldername(name))[2]=(select auth.uid())::text and exists(
 select 1 from public.trip_conversations c join public.trip_requests tr on tr.id=c.trip_id
 where c.trip_id::text=(storage.foldername(name))[1] and c.closed_at is null
 and tr.request_status in ('accepted','in_progress')
 and (c.passenger_id=(select auth.uid()) or c.captain_id=(select auth.uid()))
));

create or replace function public.reject_phone_number_in_trip_message()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.message_type='text' and new.body ~* '(^|[^0-9])(\+?20)?0?1[0125][0-9]{8}([^0-9]|$)' then
  raise exception 'phone_numbers_not_allowed_in_trip_chat';
 end if;
 return new;
end;
$$;
revoke all on function public.reject_phone_number_in_trip_message() from public,anon,authenticated;
drop trigger if exists trip_messages_block_phone_numbers on public.trip_messages;
create trigger trip_messages_block_phone_numbers before insert on public.trip_messages for each row execute function public.reject_phone_number_in_trip_message();

create table if not exists public.trip_tracking_links (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trip_requests(id) on delete cascade,
 token_hash text not null unique,
 created_by uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz
);
create index if not exists trip_tracking_links_trip_idx on public.trip_tracking_links(trip_id);
alter table public.trip_tracking_links enable row level security;
revoke all on public.trip_tracking_links from anon,authenticated;

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
 end if;
 return new;
end;
$$;
revoke all on function public.handle_trip_request_chat_and_tracking() from public,anon,authenticated;
drop trigger if exists trip_request_chat_tracking_status on public.trip_requests;
create trigger trip_request_chat_tracking_status after update of request_status on public.trip_requests for each row execute function public.handle_trip_request_chat_and_tracking();

alter table public.driver_locations add column if not exists trip_id uuid references public.trip_requests(id) on delete set null;
create index if not exists driver_locations_trip_idx on public.driver_locations(trip_id);
drop policy if exists driver_location_read_active_parties_admin on public.driver_locations;
create policy driver_location_read_active_parties_admin on public.driver_locations for select to authenticated
using(is_admin() or captain_id=(select auth.uid()) or exists(
 select 1 from public.trip_requests tr where tr.id=driver_locations.trip_id and tr.accepted_captain_id=driver_locations.captain_id
 and tr.passenger_id=(select auth.uid()) and tr.request_status in ('accepted','in_progress')
));

create or replace function public.captain_update_fixed_trip_location(p_request_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_meters double precision default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_captain uuid:=auth.uid();
begin
 if v_captain is null then raise exception 'login_required'; end if;
 if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
 or (p_accuracy_meters is not null and (p_accuracy_meters<0 or p_accuracy_meters>10000)) then raise exception 'invalid_location'; end if;
 if not exists(select 1 from public.trip_requests tr where tr.id=p_request_id and tr.accepted_captain_id=v_captain and tr.request_status in ('accepted','in_progress')) then raise exception 'active_trip_required'; end if;
 insert into public.driver_locations(captain_id,trip_id,latitude,longitude,accuracy_meters,updated_at)
 values(v_captain,p_request_id,p_latitude,p_longitude,p_accuracy_meters,now())
 on conflict(captain_id) do update set trip_id=excluded.trip_id,latitude=excluded.latitude,longitude=excluded.longitude,accuracy_meters=excluded.accuracy_meters,updated_at=now();
 return true;
end;
$$;
revoke all on function public.captain_update_fixed_trip_location(uuid,double precision,double precision,double precision) from public,anon;
grant execute on function public.captain_update_fixed_trip_location(uuid,double precision,double precision,double precision) to authenticated;

create or replace function public.captain_start_fixed_trip(p_request_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin update public.trip_requests set request_status='in_progress' where id=p_request_id and accepted_captain_id=auth.uid() and request_status='accepted';
if not found then raise exception 'trip_not_startable'; end if; return true; end; $$;
revoke all on function public.captain_start_fixed_trip(uuid) from public,anon;
grant execute on function public.captain_start_fixed_trip(uuid) to authenticated;

create or replace function public.captain_complete_fixed_trip(p_request_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin update public.trip_requests set request_status='completed' where id=p_request_id and accepted_captain_id=auth.uid() and request_status='in_progress';
if not found then raise exception 'trip_not_completable'; end if; return true; end; $$;
revoke all on function public.captain_complete_fixed_trip(uuid) from public,anon;
grant execute on function public.captain_complete_fixed_trip(uuid) to authenticated;

create or replace function public.passenger_cancel_fixed_trip(p_request_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin update public.trip_requests set request_status='cancelled' where id=p_request_id and passenger_id=auth.uid() and request_status in ('searching','accepted');
if not found then raise exception 'trip_not_cancellable'; end if; return true; end; $$;
revoke all on function public.passenger_cancel_fixed_trip(uuid) from public,anon;
grant execute on function public.passenger_cancel_fixed_trip(uuid) to authenticated;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.trip_messages;
  alter publication supabase_realtime add table public.trip_requests;
  alter publication supabase_realtime add table public.driver_locations;
 end if;
exception when duplicate_object then null;
end $$;
