-- El Sekka: captain + vehicle onboarding and public vehicle media.
-- Photos are intentionally public profile/vehicle photos; official documents remain private and are not uploaded by this form.

alter table public.profiles add column if not exists avatar_path text;
alter table public.vehicles add column if not exists photo_front_path text;
alter table public.vehicles add column if not exists photo_side_path text;
alter table public.vehicles add column if not exists photo_rear_path text;
alter table public.captain_applications add column if not exists vehicle_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'captain_applications_vehicle_id_fkey'
      and conrelid = 'public.captain_applications'::regclass
  ) then
    alter table public.captain_applications
      add constraint captain_applications_vehicle_id_fkey
      foreign key (vehicle_id) references public.vehicles(id) on delete set null;
  end if;
end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('captain-media','captain-media',true,5242880,array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists captain_media_public_read on storage.objects;
create policy captain_media_public_read on storage.objects
for select to public using (bucket_id='captain-media');

drop policy if exists captain_media_owner_insert on storage.objects;
create policy captain_media_owner_insert on storage.objects
for insert to authenticated
with check (bucket_id='captain-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists captain_media_owner_update on storage.objects;
create policy captain_media_owner_update on storage.objects
for update to authenticated
using (bucket_id='captain-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='captain-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists captain_media_owner_delete on storage.objects;
create policy captain_media_owner_delete on storage.objects
for delete to authenticated
using (bucket_id='captain-media' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.submit_captain_application_v2(
  p_national_id_last4 text,
  p_license_number text,
  p_license_expiry date,
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
begin
  if v_uid is null then raise exception 'login_required'; end if;
  select role,is_blocked into v_role,v_blocked from public.profiles where id=v_uid;
  if not found or v_role <> 'passenger' or coalesce(v_blocked,true) then
    raise exception 'account_not_allowed';
  end if;
  if p_national_id_last4 is null or p_national_id_last4 !~ '^[0-9]{4}$'
     or nullif(btrim(p_license_number),'') is null or length(btrim(p_license_number))>80
     or p_license_expiry is null or p_license_expiry<=current_date
     or p_vehicle_type not in ('private_car','taxi','suzuki','microbus','scooter','motorcycle')
     or nullif(btrim(p_make),'') is null or nullif(btrim(p_model),'') is null
     or p_model_year is null or p_model_year<1980 or p_model_year>extract(year from current_date)::integer+1
     or nullif(btrim(p_color),'') is null or nullif(btrim(p_plate_number),'') is null
     or p_passenger_capacity is null or p_passenger_capacity<1 or p_passenger_capacity>13
     or nullif(p_profile_photo_path,'') is null or nullif(p_vehicle_front_path,'') is null
     or nullif(p_vehicle_side_path,'') is null or nullif(p_vehicle_rear_path,'') is null then
    raise exception 'invalid_application_data';
  end if;
  v_cap := case p_vehicle_type when 'private_car' then 3 when 'taxi' then 4 when 'suzuki' then 6 when 'microbus' then 13 when 'scooter' then 1 when 'motorcycle' then 1 end;
  if p_passenger_capacity>v_cap then raise exception 'vehicle_capacity_exceeded'; end if;
  if (storage.foldername(p_profile_photo_path))[1]<>v_uid::text
     or (storage.foldername(p_vehicle_front_path))[1]<>v_uid::text
     or (storage.foldername(p_vehicle_side_path))[1]<>v_uid::text
     or (storage.foldername(p_vehicle_rear_path))[1]<>v_uid::text then
    raise exception 'invalid_media_owner';
  end if;

  select id,application_status,vehicle_id into v_app_id,v_app_status,v_vehicle_id
  from public.captain_applications where user_id=v_uid for update;
  if found and v_app_status in ('pending','approved','suspended') then
    raise exception 'application_already_pending';
  end if;

  if v_vehicle_id is not null then
    update public.vehicles set vehicle_type=p_vehicle_type,make=btrim(p_make),model=btrim(p_model),
      model_year=p_model_year,color=btrim(p_color),plate_number=btrim(p_plate_number),
      passenger_capacity=p_passenger_capacity,has_ac=coalesce(p_has_ac,false),
      has_large_trunk=coalesce(p_has_large_trunk,false),no_smoking=coalesce(p_no_smoking,true),
      pets_allowed=coalesce(p_pets_allowed,false),approval_status='pending',is_active=false,
      photo_front_path=p_vehicle_front_path,photo_side_path=p_vehicle_side_path,photo_rear_path=p_vehicle_rear_path
    where id=v_vehicle_id and captain_id=v_uid;
  else
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
    insert into public.captain_applications(user_id,national_id_last4,license_number,license_expiry,vehicle_id)
    values(v_uid,p_national_id_last4,btrim(p_license_number),p_license_expiry,v_vehicle_id)
    returning id into v_app_id;
  else
    update public.captain_applications set national_id_last4=p_national_id_last4,
      license_number=btrim(p_license_number),license_expiry=p_license_expiry,vehicle_id=v_vehicle_id,
      application_status='pending',admin_notes=null,reviewed_by=null,reviewed_at=null,created_at=now()
    where id=v_app_id;
  end if;
  return v_app_id;
end;
$$;

create or replace function public.review_captain_application_v2(
  p_application_id uuid,
  p_decision text,
  p_admin_notes text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.captain_applications%rowtype;
begin
  if v_uid is null or not public.is_admin() then raise exception 'admin_only'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  if p_admin_notes is not null and length(p_admin_notes)>1000 then raise exception 'admin_notes_too_long'; end if;
  select * into v_app from public.captain_applications where id=p_application_id for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.application_status<>'pending' then raise exception 'application_not_pending'; end if;
  if v_app.vehicle_id is null then raise exception 'application_vehicle_missing'; end if;

  update public.captain_applications set application_status=p_decision,
    admin_notes=nullif(btrim(p_admin_notes),''),reviewed_by=v_uid,reviewed_at=now()
  where id=p_application_id;
  update public.profiles set role=case when p_decision='approved' then 'captain' else 'passenger' end
  where id=v_app.user_id;
  update public.vehicles set approval_status=case when p_decision='approved' then 'approved' else 'rejected' end,
    is_active=(p_decision='approved')
  where id=v_app.vehicle_id and captain_id=v_app.user_id;
end;
$$;

revoke all on function public.submit_captain_application_v2(text,text,date,text,text,text,integer,text,text,integer,boolean,boolean,boolean,boolean,text,text,text,text) from public,anon;
grant execute on function public.submit_captain_application_v2(text,text,date,text,text,text,integer,text,text,integer,boolean,boolean,boolean,boolean,text,text,text,text) to authenticated;

revoke all on function public.review_captain_application_v2(uuid,text,text) from public,anon;
grant execute on function public.review_captain_application_v2(uuid,text,text) to authenticated;
