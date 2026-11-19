-- SUPERSEDED — DO NOT RUN.
-- This migration implemented negotiation for scheduled requests only.
-- The approved product rule is different: negotiation belongs to seat-sharing
-- and route listings, regardless of whether they are instant or scheduled.
-- Ordinary private bookings remain system-priced, instant or scheduled.
--
-- This file is intentionally blocked so it cannot accidentally create the
-- obsolete scheduled-only schema. A replacement migration will be authored
-- only after the existing rides/trip_offers/bookings schemas are reconciled.
do $$
begin
  raise exception 'obsolete_migration: use the unified seat-sharing design; do not apply this file';
end;
$$;
