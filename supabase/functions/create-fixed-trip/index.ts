import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://el-sekka.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return headers;
}

const json = (status: number, body: Record<string, unknown>, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });

const vehicleCapacities: Record<string, number> = {
  private_car: 3,
  taxi: 4,
  suzuki: 6,
  microbus: 13,
  scooter: 1,
  motorcycle: 1,
};

function serviceRoleKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;

  // Supports the Supabase secret-key bundle used by some project setups.
  const bundle = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (bundle) {
    try {
      const parsed = JSON.parse(bundle);
      if (typeof parsed?.default === "string") return parsed.default;
    } catch {
      // A malformed optional bundle must not expose details to the caller.
    }
  }
  throw new Error("Missing server service-role secret.");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) return new Response("origin_not_allowed", { status: 403 });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return json(500, { error: "server_configuration_error" }, origin);
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json(401, { error: "login_required" }, origin);

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: "invalid_or_expired_session" }, origin);

    // Use the caller's JWT for row-scoped reads protected by RLS.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_json_body" }, origin);
    }

    const vehicleType = String(body.vehicle_type ?? "");
    const originName = String(body.origin_name ?? "").trim();
    const destinationName = String(body.destination_name ?? "").trim();
    const originLat = Number(body.origin_lat);
    const originLng = Number(body.origin_lng);
    const destinationLat = Number(body.destination_lat);
    const destinationLng = Number(body.destination_lng);
    const passengerCount = Number(body.passenger_count);
    const isScheduled = body.is_scheduled === true;
    const scheduledAt = body.scheduled_at == null ? null : String(body.scheduled_at);

    if (!(vehicleType in vehicleCapacities)) return json(400, { error: "invalid_vehicle_type" }, origin);
    if (!originName || !destinationName || originName.length > 300 || destinationName.length > 300) {
      return json(400, { error: "invalid_location_names" }, origin);
    }
    const coordinates = [originLat, originLng, destinationLat, destinationLng];
    if (!coordinates.every(Number.isFinite) ||
        originLat < -90 || originLat > 90 || destinationLat < -90 || destinationLat > 90 ||
        originLng < -180 || originLng > 180 || destinationLng < -180 || destinationLng > 180) {
      return json(400, { error: "invalid_coordinates" }, origin);
    }
    if (!Number.isInteger(passengerCount) || passengerCount < 1 ||
        passengerCount > vehicleCapacities[vehicleType]) {
      return json(400, { error: "invalid_passenger_count_for_vehicle" }, origin);
    }
    if (isScheduled) {
      const timestamp = scheduledAt ? Date.parse(scheduledAt) : NaN;
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
        return json(400, { error: "invalid_scheduled_at" }, origin);
      }
    } else if (scheduledAt !== null) {
      return json(400, { error: "scheduled_at_requires_is_scheduled" }, origin);
    }

    const routeUrl = new URL(
      `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destinationLng},${destinationLat}`,
    );
    routeUrl.search = new URLSearchParams({
      overview: "false",
      alternatives: "false",
      steps: "false",
    }).toString();

    const routeResponse = await fetch(routeUrl, { signal: AbortSignal.timeout(15000) });
    if (!routeResponse.ok) return json(502, { error: "route_service_unavailable" }, origin);
    const routeData = await routeResponse.json();
    const distanceMeters = Number(routeData?.routes?.[0]?.distance);
    if (routeData?.code !== "Ok" || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      return json(400, { error: "route_not_found" }, origin);
    }
    const distanceKm = distanceMeters / 1000;
    if (distanceKm > 500) return json(400, { error: "trip_distance_exceeds_limit" }, origin);

    const adminClient = createClient(supabaseUrl, serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Read only the signed-in user's profile through its self-read RLS policy.
    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role,is_blocked")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Passenger profile lookup failed:", profileError.message);
      return json(500, { error: "account_validation_failed" }, origin);
    }
    if (!profile || profile.role !== "passenger" || profile.is_blocked) {
      return json(403, { error: "passenger_account_not_eligible" }, origin);
    }

    const { data: requestId, error: createError } = await adminClient.rpc(
      "server_create_fixed_trip_request",
      {
        p_passenger_id: authData.user.id,
        p_vehicle_type: vehicleType,
        p_origin_name: originName,
        p_origin_lat: originLat,
        p_origin_lng: originLng,
        p_destination_name: destinationName,
        p_destination_lat: destinationLat,
        p_destination_lng: destinationLng,
        p_scheduled_at: isScheduled ? scheduledAt : null,
        p_is_scheduled: isScheduled,
        p_passenger_count: passengerCount,
        p_distance_km: distanceKm,
      },
    );

    if (createError || !requestId) {
      console.error("server_create_fixed_trip_request failed:", createError?.message);
      return json(400, { error: "trip_request_rejected" }, origin);
    }

    // Read the created request as its owner; do not grant the service role
    // broad SELECT access to application tables.
    const { data: savedRequest, error: readError } = await userClient
      .from("trip_requests")
      .select("id,fixed_fare_egp,request_status")
      .eq("id", requestId)
      .eq("passenger_id", authData.user.id)
      .maybeSingle();

    if (readError || !savedRequest) {
      console.error("Created trip request could not be read:", readError?.message);
      return json(500, {
        success: true,
        request_id: requestId,
        distance_km: Number(distanceKm.toFixed(2)),
        warning: "request_created_but_details_unavailable",
      }, origin);
    }

    return json(200, {
      success: true,
      request_id: savedRequest.id,
      distance_km: Number(distanceKm.toFixed(2)),
      fare_egp: savedRequest.fixed_fare_egp,
      status: savedRequest.request_status,
    }, origin);
  } catch (error) {
    console.error("create-fixed-trip unexpected error:", error);
    return json(500, { error: "internal_server_error" }, origin);
  }
});
