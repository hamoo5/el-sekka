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
    "Content-Type": "application/json; charset=utf-8",
  });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
const json = (status: number, body: Record<string, unknown>, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });

const capacities: Record<string, number> = {
  private_car: 3, taxi: 4, suzuki: 6, microbus: 13, scooter: 1, motorcycle: 1,
};

function serviceRoleKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const bundle = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (bundle) {
    try {
      const parsed = JSON.parse(bundle);
      if (typeof parsed?.default === "string") return parsed.default;
    } catch { /* Ignore malformed optional bundle. */ }
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
    if (!supabaseUrl || !anonKey) return json(500, { error: "server_configuration_error" }, origin);

    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json(401, { error: "login_required" }, origin);
    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: "invalid_or_expired_session" }, origin);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }, origin); }

    const vehicleType = String(body.vehicle_type ?? "");
    const originName = String(body.origin_name ?? "").trim();
    const destinationName = String(body.destination_name ?? "").trim();
    const originLat = Number(body.origin_lat), originLng = Number(body.origin_lng);
    const destinationLat = Number(body.destination_lat), destinationLng = Number(body.destination_lng);
    const passengerCount = Number(body.passenger_count);
    const scheduledAt = typeof body.scheduled_at === "string" ? body.scheduled_at : "";
    const initialOffer = Number(body.initial_offer_egp);

    if (!(vehicleType in capacities)) return json(400, { error: "invalid_vehicle_type" }, origin);
    if (!originName || !destinationName || originName.length > 300 || destinationName.length > 300)
      return json(400, { error: "invalid_location_names" }, origin);
    const coords = [originLat, originLng, destinationLat, destinationLng];
    if (!coords.every(Number.isFinite) || originLat < -90 || originLat > 90 || destinationLat < -90 || destinationLat > 90 ||
        originLng < -180 || originLng > 180 || destinationLng < -180 || destinationLng > 180)
      return json(400, { error: "invalid_coordinates" }, origin);
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > capacities[vehicleType])
      return json(400, { error: "invalid_passenger_count_for_vehicle" }, origin);
    if (!Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())
      return json(400, { error: "invalid_scheduled_at" }, origin);
    if (!Number.isFinite(initialOffer) || initialOffer <= 0 || initialOffer > 100000)
      return json(400, { error: "invalid_initial_offer" }, origin);

    const routeUrl = new URL(`https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destinationLng},${destinationLat}`);
    routeUrl.search = new URLSearchParams({ overview: "false", alternatives: "false", steps: "false" }).toString();
    const routeResponse = await fetch(routeUrl, { signal: AbortSignal.timeout(15000) });
    if (!routeResponse.ok) return json(502, { error: "route_service_unavailable" }, origin);
    const routeData = await routeResponse.json();
    const distanceMeters = Number(routeData?.routes?.[0]?.distance);
    if (routeData?.code !== "Ok" || !Number.isFinite(distanceMeters) || distanceMeters <= 0)
      return json(400, { error: "route_not_found" }, origin);
    const distanceKm = distanceMeters / 1000;
    if (distanceKm > 500) return json(400, { error: "trip_distance_exceeds_limit" }, origin);

    const adminClient = createClient(supabaseUrl, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await adminClient.from("profiles")
      .select("role,is_blocked").eq("id", authData.user.id).maybeSingle();
    if (profileError) {
      console.error("Scheduled passenger profile lookup failed:", profileError.message);
      return json(500, { error: "account_validation_failed" }, origin);
    }
    if (!profile || profile.role !== "passenger" || profile.is_blocked)
      return json(403, { error: "passenger_account_not_eligible" }, origin);

    const { data: requestId, error: createError } = await adminClient.rpc("server_create_scheduled_trip_request", {
      p_passenger_id: authData.user.id,
      p_vehicle_type: vehicleType,
      p_origin_name: originName,
      p_origin_lat: originLat,
      p_origin_lng: originLng,
      p_destination_name: destinationName,
      p_destination_lat: destinationLat,
      p_destination_lng: destinationLng,
      p_scheduled_at: scheduledAt,
      p_passenger_count: passengerCount,
      p_distance_km: distanceKm,
      p_initial_offer_egp: initialOffer,
    });
    if (createError || !requestId) {
      console.error("server_create_scheduled_trip_request failed:", createError?.message);
      return json(400, { error: "scheduled_trip_request_rejected" }, origin);
    }
    return json(200, {
      success: true,
      request_id: requestId,
      distance_km: Number(distanceKm.toFixed(2)),
      initial_offer_egp: initialOffer,
      status: "searching",
      pricing_mode: "negotiated",
    }, origin);
  } catch (error) {
    console.error("create-scheduled-trip unexpected error:", error);
    return json(500, { error: "internal_server_error" }, origin);
  }
});
