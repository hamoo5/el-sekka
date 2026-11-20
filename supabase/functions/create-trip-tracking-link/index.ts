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
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!;
  const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return new Response(JSON.stringify({error:"login_required"}),{status:401,headers:cors(origin)});
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await authClient.auth.getUser(token);
  if(authError||!auth.user)return new Response(JSON.stringify({error:"invalid_session"}),{status:401,headers:cors(origin)});
  const userClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const body=await req.json(),tripId=String(body.trip_id||"");
  const {data:trip,error:tripError}=await userClient.from("trip_requests")
   .select("id,passenger_id,accepted_captain_id,request_status")
   .eq("id",tripId).maybeSingle();
  if(tripError||!trip)return new Response(JSON.stringify({error:"trip_not_found_or_not_allowed"}),{status:404,headers:cors(origin)});
  if(![trip.passenger_id,trip.accepted_captain_id].includes(auth.user.id))return new Response(JSON.stringify({error:"not_trip_participant"}),{status:403,headers:cors(origin)});
  if(!["accepted","in_progress"].includes(trip.request_status))return new Response(JSON.stringify({error:"trip_not_active"}),{status:409,headers:cors(origin)});
  const admin=createClient(url,serviceRoleKey(),{auth:{persistSession:false,autoRefreshToken:false}});
  await admin.from("trip_tracking_links").update({revoked_at:new Date().toISOString()}).eq("trip_id",tripId).is("revoked_at",null);
  const random=new Uint8Array(32);crypto.getRandomValues(random);
  const rawToken=[...random].map(x=>x.toString(16).padStart(2,"0")).join("");
  const tokenHash=await sha256(rawToken),expiresAt=new Date(Date.now()+12*60*60*1000).toISOString();
  const {error:insertError}=await admin.from("trip_tracking_links").insert({trip_id:tripId,token_hash:tokenHash,created_by:auth.user.id,expires_at:expiresAt});
  if(insertError)throw insertError;
  return new Response(JSON.stringify({success:true,token:rawToken,expires_at:expiresAt}),{status:200,headers:cors(origin)});
 }catch(error){
  console.error("create-trip-tracking-link",error);
  return new Response(JSON.stringify({error:"tracking_link_create_failed"}),{status:500,headers:cors(origin)});
 }
});
