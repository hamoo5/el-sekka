-- El Sekka: fixed-trip pricing rules (additive migration)
-- Safe to run on the existing database; does not drop or recreate existing objects.

create table if not exists public.trip_pricing_rules (
  vehicle_type text primary key
    check (vehicle_type in ('scooter','motorcycle','private_car','taxi','suzuki','microbus')),
  base_fare_egp numeric(10,2) not null check (base_fare_egp >= 0),
  per_km_egp numeric(10,2) not null check (per_km_egp >= 0),
  minimum_fare_egp numeric(10,2) not null check (minimum_fare_egp >= 0),
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check (minimum_fare_egp >= base_fare_egp)
);

insert into public.trip_pricing_rules
  (vehicle_type, base_fare_egp, per_km_egp, minimum_fare_egp)
values
  ('scooter',     15,  6,   30),
  ('motorcycle',  15,  6.5, 30),
  ('private_car', 20,  9,   40),
  ('taxi',        20,  9,   40),
  ('suzuki',      25, 12,   55),
  ('microbus',    30, 14,   65)
on conflict (vehicle_type) do nothing;

alter table public.trip_pricing_rules enable row level security;

drop policy if exists trip_pricing_rules_read_authenticated
  on public.trip_pricing_rules;
create policy trip_pricing_rules_read_authenticated
  on public.trip_pricing_rules
  for select to authenticated
  using (true);

drop policy if exists trip_pricing_rules_admin_update
  on public.trip_pricing_rules;
create policy trip_pricing_rules_admin_update
  on public.trip_pricing_rules
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.trip_pricing_rules to authenticated;
grant update on public.trip_pricing_rules to authenticated;

create or replace function public.calculate_fixed_trip_fare(
  p_vehicle_type text,
  p_distance_km numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule public.trip_pricing_rules%rowtype;
  v_raw numeric;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if p_distance_km is null or p_distance_km <= 0 or p_distance_km > 500 then
    raise exception 'invalid_distance';
  end if;

  select * into v_rule
  from public.trip_pricing_rules
  where vehicle_type = p_vehicle_type
    and is_enabled = true;

  if not found then
    raise exception 'vehicle_type_not_priced';
  end if;

  v_raw := greatest(
    v_rule.minimum_fare_egp,
    v_rule.base_fare_egp + (p_distance_km * v_rule.per_km_egp)
  );

  -- Round to the nearest 5 EGP.
  return (round(v_raw / 5) * 5)::numeric(10,2);
end;
$$;

revoke all on function public.calculate_fixed_trip_fare(text, numeric) from public;
grant execute on function public.calculate_fixed_trip_fare(text, numeric) to authenticated;
