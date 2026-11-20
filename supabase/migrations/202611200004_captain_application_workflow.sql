-- El Sekka: secure captain application workflow.
-- Existing captain_applications table and its owner SELECT policy are preserved.

alter table public.captain_applications enable row level security;

drop policy if exists captain_applications_admin_read on public.captain_applications;
create policy captain_applications_admin_read
  on public.captain_applications
  for select to authenticated
  using (public.is_admin());

revoke all on public.captain_applications from anon, authenticated;
grant select on public.captain_applications to authenticated;

create or replace function public.submit_captain_application(
  p_national_id_last4 text,
  p_license_number text,
  p_license_expiry date
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
  v_application_id uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'login_required'; end if;

  select role, is_blocked into v_role, v_blocked
  from public.profiles where id = v_uid;

  if not found or v_role <> 'passenger' or coalesce(v_blocked, true) then
    raise exception 'account_not_allowed';
  end if;

  if p_national_id_last4 is null
     or p_national_id_last4 !~ '^[0-9]{4}$'
     or nullif(btrim(p_license_number), '') is null
     or length(btrim(p_license_number)) > 80
     or p_license_expiry is null
     or p_license_expiry <= current_date then
    raise exception 'invalid_application_data';
  end if;

  select id, application_status into v_application_id, v_status
  from public.captain_applications
  where user_id = v_uid
  for update;

  if found then
    if v_status in ('pending','approved','suspended') then
      raise exception 'application_already_pending';
    end if;

    update public.captain_applications
    set national_id_last4 = p_national_id_last4,
        license_number = btrim(p_license_number),
        license_expiry = p_license_expiry,
        application_status = 'pending',
        admin_notes = null,
        reviewed_by = null,
        reviewed_at = null,
        created_at = now()
    where id = v_application_id;
  else
    insert into public.captain_applications (
      user_id, national_id_last4, license_number, license_expiry
    ) values (
      v_uid, p_national_id_last4, btrim(p_license_number), p_license_expiry
    ) returning id into v_application_id;
  end if;

  return v_application_id;
end;
$$;

create or replace function public.review_captain_application(
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
  v_application public.captain_applications%rowtype;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'admin_only';
  end if;
  if p_decision not in ('approved','rejected','suspended') then
    raise exception 'invalid_decision';
  end if;
  if p_admin_notes is not null and length(p_admin_notes) > 1000 then
    raise exception 'admin_notes_too_long';
  end if;

  select * into v_application
  from public.captain_applications
  where id = p_application_id
  for update;

  if not found then raise exception 'application_not_found'; end if;
  if v_application.application_status <> 'pending' then
    raise exception 'application_not_pending';
  end if;

  update public.captain_applications
  set application_status = p_decision,
      admin_notes = nullif(btrim(p_admin_notes),''),
      reviewed_by = v_uid,
      reviewed_at = now()
  where id = p_application_id;

  update public.profiles
  set role = case when p_decision = 'approved' then 'captain' else 'passenger' end
  where id = v_application.user_id;
end;
$$;

revoke all on function public.submit_captain_application(text,text,date) from public, anon;
grant execute on function public.submit_captain_application(text,text,date) to authenticated;

revoke all on function public.review_captain_application(uuid,text,text) from public, anon;
grant execute on function public.review_captain_application(uuid,text,text) to authenticated;
