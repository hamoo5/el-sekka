// OBSOLETE — DO NOT DEPLOY.
 // Negotiation is for seat-sharing and route listings, not scheduled private trips.
 // This endpoint is intentionally retired while the unified sharing API is built.
Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: "endpoint_retired_use_unified_seat_sharing" }),
  { status: 410, headers: { "Content-Type": "application/json; charset=utf-8" } },
));
