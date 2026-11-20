-- El Sekka: automatic captain document validity, private uploads and in-app notices.
-- Captains are auto-activated only when all six document images are supplied and all three expiry dates are future dates.
-- This validates completeness and dates, NOT authenticity or legal validity of the uploaded images.

alter table public.captain_applications
  add column if not exists national_id_expiry date,
  add column if not exists vehicle_license_expiry date,
  add column if not exists national_id_front_path text,
  add column if not exists national_id_back_path text,
  add column if not exists driver_license_front_path text,
  add column if not exists driver_license_back_path text,
  add column if not exists vehicle_license_front_path text,
  add column if not exists vehicle_license_back_path text;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('captain-documents','captain-documents',false,5242880,array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists captain_documents_owner_read on storage.objects;
create policy captain_documents_owner_read on storage.objects
for select to authenticated
using (bucket_id='captain-documents' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists captain_documents_admin_read on storage.objects;
create policy captain_documents_admin_read on storage.objects
for select to authenticated
using (bucket_id='captain-documents' and public.is_admin());

drop policy if exists captain_documents_owner_insert on storage.objects;
create policy captain_documents_owner_insert on storage.objects
for insert to authenticated
with check (bucket_id='captain-documents' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists captain_documents_owner_update on storage.objects;
create policy captain_documents_owner_update on storage.objects
for update to authenticated
using (bucket_id='captain-documents' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='captain-documents' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists captain_documents_owner_delete on storage.objects;
create policy captain_documents_owner_delete on storage.objects
for delete to authenticated
using (bucket_id='captain-documents' and (storage.foldername(name))[1]=auth.uid()::text);

create table if not exists public.captain_document_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('expiry_30_days','expired','captain_activated')),
  document_type text not null check (document_type in ('national_id','driver_license','vehicle_license','account')),
  expires_on date,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, notification_type, document_type, expires_on)
);

create unique index if not exists captain_document_notifications_dedupe_idx
  on public.captain_document_notifications(user_id,notification_type,document_type,coalesce(expires_on,'infinity'::date));

alter table public.captain_document_notifications enable row level security;
drop policy if exists captain_document_notifications_owner_read on public.captain_document_notifications;
create policy captain_document_notifications_owner_read on public.captain_document_notifications
for select to authenticated using (user_id=auth.uid());
drop policy if exists captain_document_notifications_owner_update on public.captain_document_notifications;
create policy captain_document_notifications_owner_update on public.captain_document_notifications
for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
revoke all on public.captain_document_notifications from anon, authenticated;
grant select on public.captain_document_notifications to authenticated;
grant update (read_at) on public.captain_document_notifications to authenticated;

create or replace function public.submit_captain_application_v3(
  p_national_id_last4 text,
  p_national_id_expiry date,
  p_license_number text,
  p_license_expiry date,
  p_vehicle_license_expiry date,
  p_national_id_front_path text,
  p_national_id_back_path text,
  p_driver_license_front_path text,
  p_driver_license_back_path text,
  p_vehicle_license_front_path text,
  p_vehicle_license_back_path text,
  p_vehicle_type text,
  p_make text,
  p_model text,
  p_model_year integer,
  p_color text,
  p_plate_number text,
  p_passenger_capacity integer,
  p_has_ac boolean,
  p_has_large_trunk boolean,
  p_no_smoking boolean,
  p_pets_allowed boolean,
  p_profile_photo_path text,
  p_vehicle_front_path text,
  p_vehicle_side_path text,
  p_vehicle_rear_path text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_blocked boolean;
  v_app_id uuid;
  v_app_status text;
  v_vehicle_id uuid;
  v_cap integer;
  v_path text;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  select role,is_blocked into v_role,v_blocked from public.profiles where id=v_uid;
  if not found or v_role not in ('passenger','captain') or coalesce(v_blocked,true) then
    raise exception 'account_not_allowed';
  end if;

  if p_national_id_last4 is null or p_national_id_last4 !~ '^[0-9]{4}$'
     or p_national_id_expiry is null or p_national_id_expiry<=current_date
     or nullif(btrim(p_license_number),'') is null or length(btrim(p_license_number))>80
     or p_license_expiry is null or p_license_expiry<=current_date
     or p_vehicle_license_expiry is null or p_vehicle_license_expiry<=current_date
     or p_vehicle_type is null or p_vehicle_type not in ('private_car','taxi','suzuki','microbus','scooter','motorcycle')
     or nullif(btrim(p_make),'') is null or nullif(btrim(p_model),'') is null
     or p_model_year is null or p_model_year<1980 or p_model_year>extract(year from current_date)::integer+1
     or nullif(btrim(p_color),'') is null or nullif(btrim(p_plate_number),'') is null
     or p_passenger_capacity is null or p_passenger_capacity<1 or p_passenger_capacity>13 then
    raise exception 'invalid_application_data';
  end if;

  v_cap := case p_vehicle_type when 'private_car' then 3 when 'taxi' then 4 when 'suzuki' then 6 when 'microbus' then 13 when 'scooter' then 1 when 'motorcycle' then 1 end;
  if p_passenger_capacity>v_cap then raise exception 'vehicle_capacity_exceeded'; end if;

  foreach v_path in array array[
    p_national_id_front_path,p_national_id_back_path,
    p_driver_license_front_path,p_driver_license_back_path,
    p_vehicle_license_front_path,p_vehicle_license_back_path
  ] loop
    if nullif(v_path,'') is null
       or (storage.foldername(v_path))[1]<>v_uid::text
       or not exists(select 1 from storage.objects o where o.bucket_id='captain-documents' and o.name=v_path) then
      raise exception 'captain_document_upload_missing';
    end if;
  end loop;

  foreach v_path in array array[p_profile_photo_path,p_vehicle_front_path,p_vehicle_side_path,p_vehicle_rear_path] loop
    if nullif(v_path,'') is null
       or (storage.foldername(v_path))[1]<>v_uid::text
       or not exists(select 1 from storage.objects o where o.bucket_id='captain-media' and o.name=v_path) then
      raise exception 'captain_media_upload_missing';
    end if;
  end loop;

  select id,application_status,vehicle_id into v_app_id,v_app_status,v_vehicle_id
  from public.captain_applications where user_id=v_uid for update;

  if v_vehicle_id is not null then
    update public.vehicles set vehicle_type=p_vehicle_type,make=btrim(p_make),model=btrim(p_model),
      model_year=p_model_year,color=btrim(p_color),plate_number=btrim(p_plate_number),
      passenger_capacity=p_passenger_capacity,has_ac=coalesce(p_has_ac,false),
      has_large_trunk=coalesce(p_has_large_trunk,false),no_smoking=coalesce(p_no_smoking,true),
      pets_allowed=coalesce(p_pets_allowed,false),approval_status='pending',
      is_active=false,
      photo_front_path=p_vehicle_front_path,photo_side_path=p_vehicle_side_path,photo_rear_path=p_vehicle_rear_path
    where id=v_vehicle_id and captain_id=v_uid;
    if not found then v_vehicle_id:=null; end if;
  end if;

  if v_vehicle_id is null then
    insert into public.vehicles(captain_id,vehicle_type,make,model,model_year,color,plate_number,
      passenger_capacity,has_ac,has_large_trunk,no_smoking,pets_allowed,approval_status,is_active,
      photo_front_path,photo_side_path,photo_rear_path)
    values(v_uid,p_vehicle_type,btrim(p_make),btrim(p_model),p_model_year,btrim(p_color),btrim(p_plate_number),
      p_passenger_capacity,coalesce(p_has_ac,false),coalesce(p_has_large_trunk,false),coalesce(p_no_smoking,true),
      coalesce(p_pets_allowed,false),'pending',false,p_vehicle_front_path,p_vehicle_side_path,p_vehicle_rear_path)
    returning id into v_vehicle_id;
  end if;

  update public.profiles set avatar_path=p_profile_photo_path where id=v_uid;

  if v_app_id is null then
    insert into public.captain_applications(
      user_id,national_id_last4,national_id_expiry,license_number,license_expiry,vehicle_license_expiry,
      national_id_front_path,national_id_back_path,driver_license_front_path,driver_license_back_path,
      vehicle_license_front_path,vehicle_license_back_path,vehicle_id,application_status,reviewed_at,created_at
    ) values (
      v_uid,p_national_id_last4,p_national_id_expiry,btrim(p_license_number),p_license_expiry,p_vehicle_license_expiry,
      p_national_id_front_path,p_national_id_back_path,p_driver_license_front_path,p_driver_license_back_path,
      p_vehicle_license_front_path,p_vehicle_license_back_path,v_vehicle_id,'pending',null,now()
    ) returning id into v_app_id;
  else
    update public.captain_applications set
      national_id_last4=p_national_id_last4,national_id_expiry=p_national_id_expiry,
      license_number=btrim(p_license_number),license_expiry=p_license_expiry,
      vehicle_license_expiry=p_vehicle_license_expiry,
      national_id_front_path=p_national_id_front_path,national_id_back_path=p_national_id_back_path,
      driver_license_front_path=p_driver_license_front_path,driver_license_back_path=p_driver_license_back_path,
      vehicle_license_front_path=p_vehicle_license_front_path,vehicle_license_back_path=p_vehicle_license_back_path,
      vehicle_id=v_vehicle_id,application_status='pending',admin_notes=null,reviewed_by=null,
      reviewed_at=null,created_at=now()
    where id=v_app_id;
  end if;

  return v_app_id;
end;
$$;

revoke all on function public.submit_captain_application_v2(text,text,date,text,text,text,integer,text,text,integer,boolean,boolean,boolean,boolean,text,text,text,text) from public,anon,authenticated;
revoke all on function public.submit_captain_application_v3(text,date,text,date,date,text,text,text,text,text,text,text,text,text,integer,text,text,integer,boolean,boolean,boolean,boolean,text,text,text,text) from public,anon;
grant execute on function public.submit_captain_application_v3(text,date,text,date,date,text,text,text,text,text,text,text,text,text,integer,text,text,integer,boolean,boolean,boolean,boolean,text,text,text,text) to authenticated;

-- Document completeness is automatic; approval of the captain and vehicle remains an admin decision.
create or replace function public.review_captain_application_v2(
  p_application_id uuid,
  p_decision text,
  p_admin_notes text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $
declare
  v_uid uuid := auth.uid();
  v_app public.captain_applications%rowtype;
begin
  if v_uid is null or not public.is_admin() then raise exception 'admin_only'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  if p_admin_notes is not null and length(p_admin_notes)>1000 then raise exception 'admin_notes_too_long'; end if;

  select * into v_app from public.captain_applications where id=p_application_id for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.application_status not in ('pending','suspended') then raise exception 'application_not_reviewable'; end if;
  if v_app.vehicle_id is null then raise exception 'application_vehicle_missing'; end if;

  if p_decision='approved' then
    if v_app.national_id_expiry is null or v_app.national_id_expiry<=current_date
       or v_app.license_expiry is null or v_app.license_expiry<=current_date
       or v_app.vehicle_license_expiry is null or v_app.vehicle_license_expiry<=current_date then
      raise exception 'captain_documents_expired_or_missing';
    end if;
    if not exists(
      select 1 from storage.objects o
      where o.bucket_id='captain-documents'
        and o.name in (v_app.national_id_front_path,v_app.national_id_back_path,
          v_app.driver_license_front_path,v_app.driver_license_back_path,
          v_app.vehicle_license_front_path,v_app.vehicle_license_back_path)
      group by o.bucket_id having count(*)=6
    ) then raise exception 'captain_document_upload_missing'; end if;
  end if;

  update public.captain_applications set application_status=p_decision,
    admin_notes=nullif(btrim(p_admin_notes),''),reviewed_by=v_uid,reviewed_at=now()
  where id=p_application_id;
  update public.profiles set role=case when p_decision='approved' then 'captain' else 'passenger' end
  where id=v_app.user_id;
  update public.vehicles set approval_status=case when p_decision='approved' then 'approved' else 'rejected' end,
    is_active=false
  where id=v_app.vehicle_id and captain_id=v_app.user_id;
end;
$;

revoke all on function public.review_captain_application_v2(uuid,text,text) from public,anon;
grant execute on function public.review_captain_application_v2(uuid,text,text) to authenticated;

-- Enforce current document validity at the moment a captain responds to a route-sharing request,
-- even if the scheduled daily expiry job has not run yet.
create or replace function public.captain_reply_share_route_request(
  p_request_id uuid,
  p_vehicle_id uuid,
  p_action text,
  p_counter_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := auth.uid();
  v_request public.share_route_requests%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_negotiation public.share_route_negotiations%rowtype;
  v_negotiation_id uuid;
begin
  if v_id is null then raise exception 'login_required'; end if;
  if p_action not in ('accept','counter') then raise exception 'invalid_action'; end if;
  if p_action = 'counter' and (p_counter_price is null or p_counter_price < 0) then
    raise exception 'invalid_counter_price';
  end if;

  perform public.require_captain_ready(v_id);
  if not exists (
    select 1 from public.captain_applications a
    where a.user_id=v_id and a.application_status='approved'
      and a.national_id_expiry>current_date
      and a.license_expiry>current_date
      and a.vehicle_license_expiry>current_date
  ) then
    raise exception 'captain_documents_expired_or_missing';
  end if;

  select * into v_request
  from public.share_route_requests
  where id = p_request_id
  for update;
  if not found or v_request.request_status <> 'open' then
    raise exception 'share_request_not_available';
  end if;
  perform public.require_captain_ready_for(v_id, v_request.departure_at);
  if v_request.requester_id = v_id then raise exception 'cannot_reply_to_own_request'; end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
    and captain_id = v_id
    and approval_status = 'approved'
    and is_active = true;
  if not found then raise exception 'approved_active_vehicle_required'; end if;
  if v_request.preferred_vehicle_type is not null
     and v_vehicle.vehicle_type <> v_request.preferred_vehicle_type then
    raise exception 'vehicle_type_mismatch';
  end if;
  if v_request.seats_requested > v_vehicle.passenger_capacity then
    raise exception 'not_enough_vehicle_capacity';
  end if;

  select * into v_negotiation
  from public.share_route_negotiations
  where request_id = p_request_id and captain_id = v_id
  for update;

  if not found then
    insert into public.share_route_negotiations (
      request_id, requester_id, captain_id, vehicle_id, requester_offer_egp
    ) values (
      p_request_id, v_request.requester_id, v_id, p_vehicle_id,
      v_request.requester_seat_price_egp
    ) returning id into v_negotiation_id;

    insert into public.share_route_offer_history(negotiation_id, offered_by, amount_egp)
    values (v_negotiation_id, v_request.requester_id, v_request.requester_seat_price_egp);
  else
    if v_negotiation.negotiation_status <> 'pending' then
      raise exception 'negotiation_not_replyable';
    end if;
    update public.share_route_negotiations
    set vehicle_id = p_vehicle_id
    where id = v_negotiation.id;
    v_negotiation_id := v_negotiation.id;
  end if;

  if p_action = 'accept' then
    update public.share_route_negotiations
    set agreed_price_egp = requester_offer_egp,
        captain_counter_offer_egp = null,
        negotiation_status = 'accepted'
    where id = v_negotiation_id;
  else
    update public.share_route_negotiations
    set captain_counter_offer_egp = p_counter_price,
        agreed_price_egp = null,
        negotiation_status = 'counter_offer'
    where id = v_negotiation_id;

    insert into public.share_route_offer_history(negotiation_id, offered_by, amount_egp)
    values (v_negotiation_id, v_id, p_counter_price);
  end if;

  return v_negotiation_id;
end;
$$;

create or replace function public.process_captain_document_expiry_for(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
begin
  select a.user_id,a.vehicle_id,a.national_id_expiry,a.license_expiry,a.vehicle_license_expiry
  into r
  from public.captain_applications a
  where a.user_id=p_user_id
    and a.application_status in ('approved','suspended');

  if not found then return; end if;

  if r.national_id_expiry is null or r.national_id_expiry<=current_date
     or r.license_expiry is null or r.license_expiry<=current_date
     or r.vehicle_license_expiry is null or r.vehicle_license_expiry<=current_date then
    update public.captain_applications
    set application_status='suspended'
    where user_id=r.user_id and application_status='approved';
    update public.vehicles set is_active=false
    where captain_id=r.user_id and (r.vehicle_id is null or id=r.vehicle_id);
    if r.national_id_expiry is null or r.national_id_expiry<=current_date then
      insert into public.captain_document_notifications(user_id,notification_type,document_type,expires_on,message)
      values(r.user_id,'expired','national_id',r.national_id_expiry,'انتهت صلاحية بطاقة الرقم القومي. تم إيقاف نشاط القيادة لحين التجديد.')
      on conflict do nothing;
    end if;
    if r.license_expiry is null or r.license_expiry<=current_date then
      insert into public.captain_document_notifications(user_id,notification_type,document_type,expires_on,message)
      values(r.user_id,'expired','driver_license',r.license_expiry,'انتهت صلاحية رخصة القيادة. تم إيقاف نشاط القيادة لحين التجديد.')
      on conflict do nothing;
    end if;
    if r.vehicle_license_expiry is null or r.vehicle_license_expiry<=current_date then
      insert into public.captain_document_notifications(user_id,notification_type,document_type,expires_on,message)
      values(r.user_id,'expired','vehicle_license',r.vehicle_license_expiry,'انتهت صلاحية رخصة السيارة. تم إيقاف نشاط القيادة لحين التجديد.')
      on conflict do nothing;
    end if;
  else
    if r.national_id_expiry<=current_date+30 then
      insert into public.captain_document_notifications(user_id,notification_type,document_type,expires_on,message)
      values(r.user_id,'expiry_30_days','national_id',r.national_id_expiry,'بطاقة الرقم القومي ستنتهي خلال 30 يوماً. حدّث المستند قبل انتهاء صلاحيته.')
      on conflict do nothing;
    end if;
    if r.license_expiry<=current_date+30 then
      insert into public.captain_document_notifications(user_id,notification_type,document_type,expires_on,message)
      values(r.user_id,'expiry_30_days','driver_license',r.license_expiry,'رخصة القيادة ستنتهي خلال 30 يوماً. حدّث المستند قبل انتهاء صلاحيته.')
      on conflict do nothing;
    end if;
    if r.vehicle_license_expiry<=current_date+30 then
      insert into public.captain_document_notifications(user_id,notification_type,document_type,expires_on,message)
      values(r.user_id,'expiry_30_days','vehicle_license',r.vehicle_license_expiry,'رخصة السيارة ستنتهي خلال 30 يوماً. حدّث المستند قبل انتهاء صلاحيتها.')
      on conflict do nothing;
    end if;
  end if;
end;
$$;

create or replace function public.process_captain_document_expiry()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select a.user_id
    from public.captain_applications a
    where a.application_status in ('approved','suspended')
  loop
    perform public.process_captain_document_expiry_for(v_user_id);
  end loop;
end;
$$;

create or replace function public.process_my_captain_document_status()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  perform public.process_captain_document_expiry_for(auth.uid());
end;
$;

revoke all on function public.process_captain_document_expiry() from public,anon,authenticated;
revoke all on function public.process_captain_document_expiry_for(uuid) from public,anon,authenticated;
revoke all on function public.process_my_captain_document_status() from public,anon;
grant execute on function public.process_my_captain_document_status() to authenticated;

do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
      if not exists(select 1 from cron.job where jobname='el-sekka-captain-document-expiry') then
        perform cron.schedule('el-sekka-captain-document-expiry','15 3 * * *',
          'select public.process_captain_document_expiry();');
      end if;
    exception when others then
      raise notice 'pg_cron scheduling was not available; expiry checks will run when users open the app.';
    end;
  else
    raise notice 'pg_cron is unavailable; expiry checks will run when users open the app.';
  end if;
end $$;
