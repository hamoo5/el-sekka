CREATE OR REPLACE FUNCTION public.captain_accept_fixed_trip(p_request_id uuid,p_vehicle_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
 v_captain_id uuid := auth.uid();
 v_request public.trip_requests%ROWTYPE;
 v_vehicle public.vehicles%ROWTYPE;
 v_completed_trips integer := 0;
 v_has_active_subscription boolean := false;
BEGIN
 IF v_captain_id IS NULL THEN RAISE EXCEPTION 'login_required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_captain_id AND role='captain' AND is_blocked=false) THEN
   RAISE EXCEPTION 'captain_not_allowed';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.captain_applications
   WHERE user_id=v_captain_id AND application_status='approved'
     AND national_id_expiry>current_date AND license_expiry>current_date
     AND vehicle_license_expiry>current_date
 ) THEN RAISE EXCEPTION 'captain_not_approved_or_documents_invalid'; END IF;
 SELECT count(*)::integer INTO v_completed_trips FROM public.trip_requests
 WHERE accepted_captain_id=v_captain_id AND request_status='completed';
 SELECT EXISTS (
   SELECT 1 FROM public.captain_subscriptions
   WHERE captain_id=v_captain_id AND payment_status='approved'
     AND starts_at<=now() AND expires_at>now()
 ) INTO v_has_active_subscription;
 IF NOT v_has_active_subscription AND v_completed_trips>0 THEN
   RAISE EXCEPTION 'active_subscription_required';
 END IF;
 SELECT * INTO v_request FROM public.trip_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR v_request.request_status<>'searching' THEN RAISE EXCEPTION 'request_not_available'; END IF;
 IF v_request.passenger_id=v_captain_id THEN RAISE EXCEPTION 'own_request_not_allowed'; END IF;
 SELECT * INTO v_vehicle FROM public.vehicles
 WHERE id=p_vehicle_id AND captain_id=v_captain_id
   AND vehicle_type=v_request.vehicle_type AND approval_status='approved'
   AND (is_active=true OR (v_completed_trips=0 AND NOT v_has_active_subscription))
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'approved_active_vehicle_required'; END IF;
 IF v_vehicle.passenger_capacity<v_request.passenger_count THEN
   RAISE EXCEPTION 'vehicle_capacity_insufficient';
 END IF;
 UPDATE public.trip_requests SET request_status='accepted',
   accepted_captain_id=v_captain_id,accepted_vehicle_id=p_vehicle_id
 WHERE id=p_request_id AND request_status='searching'
   AND accepted_captain_id IS NULL AND accepted_vehicle_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_already_taken'; END IF;
 RETURN true;
END;
$function$;