import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://el-sekka.pages.dev","http://localhost:5173","http://127.0.0.1:5173"]);
function cors(origin: string | null) {
  const h = new Headers({"Content-Type":"application/json; charset=utf-8","Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"});
  if (origin && allowedOrigins.has(origin)) h.set("Access-Control-Allow-Origin",origin);
  return h;
}
function serviceRoleKey(): string {
  const direct=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(direct)return direct;
  const bundle=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(bundle){try{const parsed=JSON.parse(bundle);if(typeof parsed?.default==="string")return parsed.default;}catch{}}
  throw new Error("Missing server secret");
}
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(origin&&!allowedOrigins.has(origin))return new Response("origin_not_allowed",{status:403});
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:cors(origin)});
 try{
  const body=await req.json(),rawToken=String(body.token||"");
  if(!/^[a-f0-9]{64}$/i.test(rawToken))return new Response(JSON.stringify({error:"invalid_tracking_link"}),{status:400,headers:cors(origin)});
  const url=Deno.env.get("SUPABASE_URL")!,admin=createClient(url,serviceRoleKey(),{auth:{persistSession:false,autoRefreshToken:false}});
  const tokenHash=await sha256(rawToken);
  const {data:link,error:linkError}=await admin.from("trip_tracking_links")
   .select("id,trip_id,expires_at,revoked_at").eq("token_hash",tokenHash).maybeSingle();
  if(linkError||!link||link.revoked_at||new Date(link.expires_at).getTime()<=Date.now())
   return new Response(JSON.stringify({error:"tracking_link_expired"}),{status:410,headers:cors(origin)});
  const {data:trip,error:tripError}=await admin.from("trip_requests")
   .select("id,accepted_captain_id,accepted_vehicle_id,origin_name,destination_name,request_status,vehicle_type")
   .eq("id",link.trip_id).maybeSingle();
  if(tripError||!trip||!["accepted","in_progress"].includes(trip.request_status))
   return new Response(JSON.stringify({error:"trip_no_longer_active"}),{status:410,headers:cors(origin)});
  const [{data:captain},{data:vehicle},{data:location}]=await Promise.all([
   admin.from("profiles").select("display_name").eq("id",trip.accepted_captain_id).maybeSingle(),
   admin.from("vehicles").select("make,model,color,plate_number,vehicle_type").eq("id",trip.accepted_vehicle_id).maybeSingle(),
   admin.from("driver_locations").select("latitude,longitude,accuracy_meters,updated_at").eq("captain_id",trip.accepted_captain_id).eq("trip_id",trip.id).maybeSingle()
  ]);
  return new Response(JSON.stringify({
   active:true,trip_id:trip.id,status:trip.request_status,
   captain_name:captain?.display_name||"الكابتن",
   vehicle:vehicle?{make:vehicle.make,model:vehicle.model,color:vehicle.color,vehicle_type:vehicle.vehicle_type}:null,
   origin:trip.origin_name,destination:trip.destination_name,
   location:location?{latitude:location.latitude,longitude:location.longitude,accuracy_meters:location.accuracy_meters,updated_at:location.updated_at}:null,
   checked_at:new Date().toISOString()
  }),{status:200,headers:cors(origin)});
 }catch(error){
  console.error("get-trip-tracking",error);
  return new Response(JSON.stringify({error:"tracking_lookup_failed"}),{status:500,headers:cors(origin)});
 }
});
