-- Enforce vehicle categories by service type in El Sekka.
-- Ordinary fixed trips: private car, taxi, scooter, motorcycle.
-- Shared seats / route offers / seat bookings: private car, suzuki, microbus.
-- Existing rows are intentionally preserved; these guards apply to new writes and relevant updates.

CREATE OR REPLACE FUNCTION public.enforce_sekka_service_vehicle_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_vehicle_type text;
  v_vehicle_owner uuid;
  v_preferred_type text;
BEGIN
  IF TG_TABLE_NAME = 'trip_requests' THEN
    IF NEW.vehicle_type NOT IN ('private_car','taxi','scooter','motorcycle') THEN
      RAISE EXCEPTION 'vehicle_type_not_allowed_for_fixed_trip'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'share_route_requests' THEN
    IF NEW.preferred_vehicle_type IS NOT NULL
       AND NEW.preferred_vehicle_type NOT IN ('private_car','suzuki','microbus') THEN
      RAISE EXCEPTION 'vehicle_type_not_allowed_for_shared_trip'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'rides' THEN
    SELECT v.vehicle_type, v.captain_id
      INTO v_vehicle_type, v_vehicle_owner
    FROM public.vehicles v
    WHERE v.id = NEW.vehicle_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'shared_ride_vehicle_not_found'
        USING ERRCODE = '23503';
    END IF;
    IF v_vehicle_owner IS DISTINCT FROM NEW.captain_id THEN
      RAISE EXCEPTION 'shared_ride_vehicle_owner_mismatch'
        USING ERRCODE = '23514';
    END IF;
    IF v_vehicle_type NOT IN ('private_car','suzuki','microbus') THEN
      RAISE EXCEPTION 'vehicle_type_not_allowed_for_shared_trip'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'bookings' THEN
    SELECT v.vehicle_type
      INTO v_vehicle_type
    FROM public.rides r
    JOIN public.vehicles v ON v.id = r.vehicle_id
    WHERE r.id = NEW.ride_id;

    IF NOT FOUND OR v_vehicle_type NOT IN ('private_car','suzuki','microbus') THEN
      RAISE EXCEPTION 'seat_booking_requires_shared_vehicle'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'share_route_negotiations' THEN
    SELECT v.vehicle_type, sr.preferred_vehicle_type
      INTO v_vehicle_type, v_preferred_type
    FROM public.vehicles v
    JOIN public.share_route_requests sr ON sr.id = NEW.request_id
    WHERE v.id = NEW.vehicle_id;

    IF NOT FOUND
       OR v_vehicle_type NOT IN ('private_car','suzuki','microbus')
       OR (v_preferred_type IS NOT NULL AND v_vehicle_type <> v_preferred_type) THEN
      RAISE EXCEPTION 'negotiation_requires_matching_shared_vehicle'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_sekka_service_vehicle_types()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trip_requests_service_vehicle_type ON public.trip_requests;
CREATE TRIGGER trip_requests_service_vehicle_type
BEFORE INSERT OR UPDATE OF vehicle_type ON public.trip_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_sekka_service_vehicle_types();

DROP TRIGGER IF EXISTS share_route_requests_service_vehicle_type ON public.share_route_requests;
CREATE TRIGGER share_route_requests_service_vehicle_type
BEFORE INSERT OR UPDATE OF preferred_vehicle_type ON public.share_route_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_sekka_service_vehicle_types();

DROP TRIGGER IF EXISTS rides_service_vehicle_type ON public.rides;
CREATE TRIGGER rides_service_vehicle_type
BEFORE INSERT OR UPDATE OF vehicle_id, captain_id ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.enforce_sekka_service_vehicle_types();

DROP TRIGGER IF EXISTS bookings_service_vehicle_type ON public.bookings;
CREATE TRIGGER bookings_service_vehicle_type
BEFORE INSERT OR UPDATE OF ride_id ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_sekka_service_vehicle_types();

DROP TRIGGER IF EXISTS share_route_negotiations_service_vehicle_type ON public.share_route_negotiations;
CREATE TRIGGER share_route_negotiations_service_vehicle_type
BEFORE INSERT OR UPDATE OF request_id, vehicle_id ON public.share_route_negotiations
FOR EACH ROW EXECUTE FUNCTION public.enforce_sekka_service_vehicle_types();
