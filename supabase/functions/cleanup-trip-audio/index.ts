import { createClient } from "npm:@supabase/supabase-js@2";
function serviceRoleKey(): string {
  const direct=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(direct)return direct;
  const bundle=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(bundle){try{const parsed=JSON.parse(bundle);if(typeof parsed?.default==="string")return parsed.default;}catch{}}
  throw new Error("Missing server secret");
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("method_not_allowed",{status:405});
 try{
  const token=req.headers.get("x-cleanup-token")||"";
  if(!token)return new Response("unauthorized",{status:401});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,serviceRoleKey(),{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:valid,error:verifyError}=await admin.rpc("verify_trip_audio_cleanup_token",{p_token:token});
  if(verifyError||valid!==true)return new Response("unauthorized",{status:401});

  const now=new Date().toISOString();
  const {data:queue,error:queueError}=await admin.from("trip_chat_audio_cleanup")
   .select("id,message_id,trip_id,storage_path").is("cleaned_at",null).lte("delete_after",now).order("delete_after",{ascending:true}).limit(100);
  if(queueError)throw queueError;
  let removed=0;
  if(queue?.length){
   const tripIds=[...new Set(queue.map(item=>item.trip_id))];
   const {data:reports,error:reportError}=await admin.from("reports").select("trip_request_id").in("trip_request_id",tripIds);
   if(reportError)throw reportError;
   const protectedTrips=new Set((reports||[]).map(row=>row.trip_request_id));
   const eligible=queue.filter(item=>!protectedTrips.has(item.trip_id));
   if(eligible.length){
    const paths=eligible.map(item=>item.storage_path);
    const {error:storageError}=await admin.storage.from("trip-audio").remove(paths);
    if(storageError)throw storageError;
    const messageIds=eligible.map(item=>item.message_id),queueIds=eligible.map(item=>item.id);
    const {error:messageError}=await admin.from("trip_messages").delete().in("id",messageIds);
    if(messageError)throw messageError;
    const {error:deleteError}=await admin.from("trip_chat_audio_cleanup").delete().in("id",queueIds);
    if(deleteError)throw deleteError;
    removed=paths.length;
   }
  }

  // Keep chat history for 30 days; preserve all messages when a trip has a report.
  const cutoff=new Date(Date.now()-30*24*60*60*1000).toISOString();
  const {data:oldChats,error:chatError}=await admin.from("trip_conversations").select("trip_id").not("closed_at","is",null).lt("closed_at",cutoff).limit(500);
  if(chatError)throw chatError;
  const oldTripIds=(oldChats||[]).map(row=>row.trip_id);
  let purgedText=0;
  if(oldTripIds.length){
   const {data:reports,error:reportError}=await admin.from("reports").select("trip_request_id").in("trip_request_id",oldTripIds);
   if(reportError)throw reportError;
   const protectedTrips=new Set((reports||[]).map(row=>row.trip_request_id));
   const deletable=oldTripIds.filter(id=>!protectedTrips.has(id));
   if(deletable.length){
    const {data:deleted,error:deleteError}=await admin.from("trip_messages").delete().in("trip_id",deletable).eq("message_type","text").select("id");
    if(deleteError)throw deleteError;
    purgedText=deleted?.length||0;
   }
  }
  return Response.json({success:true,voice_files_removed:removed,old_text_messages_removed:purgedText});
 }catch(error){
  console.error("cleanup-trip-audio",error);
  return new Response("cleanup_failed",{status:500});
 }
});
