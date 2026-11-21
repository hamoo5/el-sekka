import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pwrptcxytjhhkgvdqkvu.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_wYJqzk918T3lanmo7wuruA_jBTcTDoZ';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const root = document.querySelector('#app');
let session = null, profile = null, view = 'home', authRole = 'rider', authMode = 'signin', busy = false;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => Number(v || 0).toLocaleString('ar-EG') + ' ج.م';
const date = v => v ? new Date(v).toLocaleString('ar-EG',{dateStyle:'short',timeStyle:'short'}) : 'فوري';
const notice = (msg, type='info') => { const el=document.querySelector('#notice'); if(el){el.textContent=msg;el.className='notice '+type;} };
const busyButton = (button, yes) => { if(button){button.disabled=yes;button.dataset.old ||= button.textContent;button.textContent=yes?'جارٍ التنفيذ…':button.dataset.old;} };

function shell(content){
 root.innerHTML=`<header class="top"><a class="brand" href="#" data-view="home"><span class="mark">س</span><span><b>السكة</b><small>مشاركة الطريق.. على السكة</small></span></a><div class="top-actions">${session?'<span class="user-tag">'+esc(profile?.display_name||session.user.email)+'</span><button class="btn outline" id="logout">خروج</button>':''}</div></header>
 ${content}
 ${session?'<nav class="bottom"><button data-view="home">الرئيسية</button><button data-view="share">جاي في سكتك</button><button data-view="group">مشوارنا واحد</button><button data-view="lines">خطوط السكة</button><button data-view="trips">حجوزاتي</button><button data-view="account">حسابي</button></nav>':''}
 <footer>السكة · منصة تنقّل ومشاركة طريق</footer>`;
 root.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();view=b.dataset.view;render();}));
 document.querySelector('#logout')?.addEventListener('click',async()=>{await db.auth.signOut();session=null;profile=null;view='home';render();});
}
function card(title, body, extra=''){return `<section class="panel"><h2>${title}</h2>${body}${extra}</section>`;}
function input(label,name,type='text',required=true,placeholder=''){return `<label>${label}<input name="${name}" type="${type}" ${required?'required':''} placeholder="${placeholder}"></label>`;}
function select(label,name,opts,required=true){return `<label>${label}<select name="${name}" ${required?'required':''}>${opts.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label>`;}
function home(){
 if(profile?.account_type==='captain')return captainHome();
 if(profile?.account_type==='admin')return adminHome();
 shell(`<main class="wrap"><section class="hero"><span class="eyebrow">أهلاً بك في السكة</span><h1>كل مشوار له <em>سكة</em></h1><p>شارك الطريق مع كابتن رايح في نفس اتجاهك، واحجز مقعدًا على رحلة منشورة.</p><div class="actions"><button class="btn primary" data-view="share">جاي في سكتك</button><button class="btn outline" data-view="trips">حجوزاتي</button></div><div class="tiles"><button class="tile" data-view="share"><span>🛣️</span><b>جاي في سكتك</b><small>اعرض طريقك أو احجز مقعدًا</small></button><button class="tile" data-view="trips"><span>📋</span><b>حجوزاتي</b><small>تابع حجوزات المقاعد</small></button><button class="tile" data-view="group"><span>🤝</span><b>مشوارنا واحد</b><small>اطلب مشاركة طريق وتابع عروض الكباتن</small></button><button class="tile" data-view="lines"><span>🚏</span><b>خطوط السكة</b><small>خطوط ثابتة ومواعيد منتظمة</small></button></div></main>`);
}
function authPage(){
 shell(`<main class="wrap narrow"><section class="hero compact"><span class="eyebrow">السكة · تجربة تشغيل</span><h1>ابدأ مشوارك</h1><p>حساب مستقل للراكب أو الكابتن.</p></section>${card('تسجيل الدخول أو إنشاء حساب',`<div class="tabs"><button type="button" class="${authRole==='rider'?'selected':''}" data-role="rider">راكب</button><button type="button" class="${authRole==='captain'?'selected':''}" data-role="captain">كابتن</button><button type="button" class="${authRole==='admin'?'selected':''}" data-role="admin">إدارة</button></div><form id="authForm">${input('البريد الإلكتروني','email','email',true,'name@example.com')}${input('كلمة المرور','password','password',true,'6 أحرف على الأقل')}${authMode==='signup'?input('الاسم','name','text',true,'الاسم الظاهر'):''}<button class="btn primary full" type="submit">${authMode==='signup'?'إنشاء الحساب':'تسجيل الدخول'}</button><button class="text-btn" type="button" id="toggleAuth">${authMode==='signup'?'لديك حساب؟ تسجيل الدخول':'حساب جديد؟ أنشئ حسابًا'}</button><p id="notice" class="notice" role="status"></p></form>`)}<p class="muted center">النسخة التجريبية متصلة بقاعدة البيانات.</p></main>`);
 root.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{authRole=b.dataset.role;authPage();});
 document.querySelector('#toggleAuth').onclick=()=>{authMode=authMode==='signup'?'signin':'signup';authPage();};
 document.querySelector('#authForm').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),email=String(f.get('email')).trim().toLowerCase(),password=String(f.get('password'));
  const btn=e.currentTarget.querySelector('button[type=submit]');busyButton(btn,true);
  try{
   if(authMode==='signup'){
    if(authRole==='admin')throw Error('إنشاء حساب الإدارة غير متاح من التطبيق.');
    const {data,error}=await db.auth.signUp({email,password,options:{data:{account_role:authRole,display_name:String(f.get('name')||'').trim()}}});
    if(error)throw error;
    if(!data.session){notice('تم إنشاء الحساب. أكّد بريدك الإلكتروني ثم سجّل الدخول.','success');return;}
    session=data.session;
   }else{
    const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw error;session=data.session;
   }
   await loadProfile();
   const role=profile?.account_type;
   if(authRole==='admin'&&role!=='admin'){await db.auth.signOut();session=null;profile=null;throw Error('هذا الحساب ليس حساب إدارة معتمدًا.');}
   if(authRole!=='admin'&&role!==authRole){await db.auth.signOut();session=null;profile=null;throw Error('نوع الحساب لا يطابق اختيارك. استخدم نوع الحساب الصحيح.');}
   view=role==='captain'?'captain':role==='admin'?'admin':'home';render();
  }catch(err){notice(err.message||'تعذر إتمام العملية.','error');}
  finally{busyButton(btn,false);}
 };
}
async function loadProfile(){
 if(!session)return;
 const {data,error}=await db.from('profiles').select('id,display_name,role,account_type,is_blocked,is_vip').eq('id',session.user.id).maybeSingle();
 if(error)console.error(error);
 profile=data;
 if(profile?.is_blocked){await db.auth.signOut();session=null;profile=null;notice('الحساب موقوف. تواصل مع الإدارة.','error');}
}
async function sharePage(){
 if(profile?.account_type==='captain'){
  const {data:vehicles}=await db.from('vehicles').select('id,vehicle_type,make,model,plate_number,approval_status,is_active').eq('captain_id',session.user.id).eq('approval_status','approved').eq('is_active',true);
  shell(`<main class="wrap narrow"><div class="page-head"><span class="eyebrow">خطوطي ومقاعدي</span><h1>انشر طريقك</h1><p>أضف رحلة ليتمكن الركاب من طلب مقاعد على نفس الطريق.</p></div>${card('رحلة جديدة',`<form id="rideForm">${select('المركبة','vehicle_id',(vehicles||[]).map(v=>[v.id,v.make+' '+v.model+' · '+v.plate_number]))}${select('نوع الرحلة','ride_mode',[['scheduled_share','رحلة بميعاد']])}${input('من','origin_name','text',true,'نقطة البداية')}${input('إلى','destination_name','text',true,'الوجهة')}${input('خط عرض البداية','origin_lat','number',true,'30.01')}${input('خط طول البداية','origin_lng','number',true,'31.40')}${input('خط عرض الوجهة','destination_lat','number',true,'30.05')}${input('خط طول الوجهة','destination_lng','number',true,'31.35')}${input('وصف الطريق والمحطات','route_description','text',false,'اكتب المناطق التي تمر بها')}${input('ميعاد التحرك','departure_at','datetime-local',true)}${input('المقاعد المتاحة','seats','number',true,'1')}${input('سعر المقعد بالجنيه','seat_price','number',true,'السعر لكل مقعد')}<button class="btn primary full">نشر الرحلة</button><p id="notice" class="notice"></p></form>`)}${vehicles?.length?'':'<p class="notice">لا توجد مركبة معتمدة ونشطة. أكمل بيانات الكابتن وانتظر اعتماد المركبة.</p>'}</main>`);
  const form=document.querySelector('#rideForm');
  if(form)form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),v=n=>String(f.get(n)||'').trim(),b=form.querySelector('button[type=submit]');busyButton(b,true);try{const coords=[Number(v('origin_lng')),Number(v('origin_lat')),Number(v('destination_lng')),Number(v('destination_lat'))];if(coords.some(n=>!Number.isFinite(n)))throw Error('أدخل إحداثيات صحيحة للبداية والنهاية.');const routeRes=await fetch('https://router.project-osrm.org/route/v1/driving/'+coords[0]+','+coords[1]+';'+coords[2]+','+coords[3]+'?overview=full&geometries=geojson');if(!routeRes.ok)throw Error('تعذر حساب الطريق. حاول مرة أخرى.');const routeData=await routeRes.json();const route=routeData.routes?.[0];if(!route?.geometry||!route.distance||!route.duration)throw Error('لم يتم العثور على طريق قابل للحساب.');const {data,error}=await db.rpc('create_share_ride',{p_vehicle_id:v('vehicle_id'),p_ride_mode:'scheduled_share',p_origin_name:v('origin_name'),p_origin_lat:coords[1],p_origin_lng:coords[0],p_destination_name:v('destination_name'),p_destination_lat:coords[3],p_destination_lng:coords[2],p_route_description:v('route_description')||null,p_departure_at:new Date(v('departure_at')).toISOString(),p_seats:Number(v('seats')),p_seat_price:Number(v('seat_price')),p_route_geometry:route.geometry,p_route_distance_m:Math.round(route.distance),p_route_duration_seconds:Math.round(route.duration)});if(error)throw error;notice('تم نشر الرحلة بنجاح.','success');form.reset();}catch(err){notice(err.message||'تعذر نشر الرحلة.','error');}finally{busyButton(b,false);}};
  return;
 }
 shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">مشاركة الطريق</span><h1>رحلات منشورة على السكة</h1><p>احجز مقعدًا في رحلة متاحة.</p></div><div id="rides" class="stack"><section class="panel">جارٍ تحميل الرحلات…</section></div></main>`);
 const box=document.querySelector('#rides');
 const {data,error}=await db.from('rides').select('id,captain_id,vehicle_id,ride_mode,origin_name,destination_name,route_description,departure_at,available_seats,seat_price_egp,ride_status,seat_capacity').eq('ride_status','open').gt('available_seats',0).order('departure_at',{ascending:true}).limit(40);
 if(error){box.innerHTML='<section class="panel">تعذر تحميل الرحلات. '+esc(error.message)+'</section>';return;}
 if(!data?.length){box.innerHTML='<section class="panel empty">لا توجد رحلات منشورة متاحة حاليًا. ارجع لاحقًا.</section>';return;}
 box.innerHTML=data.map(r=>`<section class="panel ride"><div class="ride-top"><span class="pill">متاح · ${r.available_seats} مقعد</span><b>${money(r.seat_price_egp)} <small>/ مقعد</small></b></div><h3>${esc(r.origin_name)} ← ${esc(r.destination_name)}</h3><p>${esc(r.route_description||'مسار يحدده الكابتن')}</p><p class="muted">${date(r.departure_at)}</p><form data-book="${r.id}" data-price="${r.seat_price_egp}" class="book-form">${input('مكان الركوب','pickup_name','text',true,'اسم نقطة الركوب')}${input('خط عرض الركوب','pickup_lat','number',true,'30.01')}${input('خط طول الركوب','pickup_lng','number',true,'31.40')}${input('مكان النزول','dropoff_name','text',true,'اسم نقطة النزول')}${input('خط عرض النزول','dropoff_lat','number',true,'30.05')}${input('خط طول النزول','dropoff_lng','number',true,'31.35')}${select('عدد المقاعد','seats',Array.from({length:Math.min(6,r.available_seats)},(_,i)=>[String(i+1),String(i+1)]))}<button class="btn primary">طلب حجز</button></form></section>`).join('');
 box.querySelectorAll('[data-book]').forEach(form=>form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),n=Number(f.get('seats')),val=k=>String(f.get(k)||'').trim(),b=form.querySelector('button');busyButton(b,true);try{const {data,error}=await db.rpc('request_seats',{p_ride_id:form.dataset.book,p_pickup_name:val('pickup_name'),p_dropoff_name:val('dropoff_name'),p_pickup_order:0,p_dropoff_order:1,p_seats:n,p_offer:Number(form.dataset.price),p_pickup_lat:Number(val('pickup_lat')),p_pickup_lng:Number(val('pickup_lng')),p_dropoff_lat:Number(val('dropoff_lat')),p_dropoff_lng:Number(val('dropoff_lng'))});if(error)throw error;notice('تم إرسال طلب الحجز.','success');}catch(err){notice(err.message||'تعذر الحجز','error');}finally{busyButton(b,false);}});
}
async function groupPage(){
 if(profile?.account_type==='captain'){
  const [{data:vehicles,error:vehicleError},{data:requests,error:requestError}]=await Promise.all([
   db.from('vehicles').select('id,vehicle_type,make,model,plate_number').eq('captain_id',session.user.id).eq('approval_status','approved').eq('is_active',true),
   db.from('share_route_requests').select('id,requester_id,ride_mode,origin_name,destination_name,route_description,departure_at,preferred_vehicle_type,seats_requested,requester_seat_price_egp,request_status').eq('request_status','open').neq('requester_id',session.user.id).order('departure_at',{ascending:true}).limit(30)
  ]);
  shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">مشوارنا واحد · مساحة الكابتن</span><h1>طلبات مشاركة الطريق</h1><p>اختار الطلب المناسب لطريقك ومركبتك، واقبل السعر المقترح أو قدم عرضًا بديلًا.</p></div><div id="groupRequests" class="stack"></div></main>`);
  const box=document.querySelector('#groupRequests');
  if(vehicleError||requestError){box.innerHTML='<section class="panel notice error">'+esc((vehicleError||requestError).message)+'</section>';return;}
  if(!vehicles?.length){box.innerHTML='<section class="panel empty">لا توجد مركبة معتمدة ونشطة على حسابك.</section>';return;}
  if(!requests?.length){box.innerHTML='<section class="panel empty">لا توجد طلبات مشاركة طريق متاحة حاليًا.</section>';return;}
  box.innerHTML=requests.map(r=>`<section class="panel"><div class="ride-top"><span class="pill">طلب مفتوح</span><b>${r.seats_requested} مقعد</b></div><h3>${esc(r.origin_name)} ← ${esc(r.destination_name)}</h3><p>${esc(r.route_description||'بدون تفاصيل إضافية')}</p><p class="muted">${date(r.departure_at)} · النوع المفضل: ${esc(({private_car:'ملاكي',suzuki:'سوزوكي',microbus:'ميكروباص'})[r.preferred_vehicle_type]||'أي مركبة')}</p><p>السعر المقترح للمقعد: <b>${money(r.requester_seat_price_egp)}</b></p><label>المركبة المناسبة<select data-vehicle-for="${r.id}">${vehicles.map(v=>`<option value="${v.id}">${esc(v.make||'')} ${esc(v.model||'')} · ${esc(({private_car:'ملاكي',suzuki:'سوزوكي',microbus:'ميكروباص'})[v.vehicle_type]||v.vehicle_type)} · ${esc(v.plate_number||'')}</option>`).join('')}</select></label><div class="actions"><button class="btn primary" data-group-action="accept" data-request="${r.id}">قبول السعر</button><button class="btn outline" data-group-action="counter" data-request="${r.id}">تقديم سعر بديل</button></div></section>`).join('');
  box.querySelectorAll('[data-group-action]').forEach(btn=>btn.onclick=async()=>{
   const vehicle=box.querySelector('[data-vehicle-for="'+btn.dataset.request+'"]')?.value;
   if(!vehicle)return;
   let price=null;
   if(btn.dataset.groupAction==='counter'){const raw=prompt('اكتب السعر المقترح للمقعد بالجنيه:');if(raw===null)return;price=Number(raw);if(!Number.isFinite(price)||price<0){alert('أدخل سعرًا صحيحًا.');return;}}
   busyButton(btn,true);
   try{const {error}=await db.rpc('captain_reply_share_route_request',{p_request_id:btn.dataset.request,p_vehicle_id:vehicle,p_action:btn.dataset.groupAction,p_counter_price:price});if(error)throw error;await groupPage();}
   catch(err){alert(err.message||'تعذر إرسال الرد.');busyButton(btn,false);}
  });
  return;
 }
 shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">مشوارنا واحد</span><h1>شارك مشوارك مع ناس في نفس السكة</h1><p>انشر اتجاهك وميعادك وعدد المقاعد. الكباتن القريبون من نفس المسار يقدروا يردوا على طلبك بعرض مناسب.</p></div>
 ${card('طلب مشاركة طريق',`<form id="groupRequestForm">
 ${input('من','origin_name','text',true,'منطقة الانطلاق')}
 ${input('خط عرض البداية','origin_lat','number',true,'30.01')}
 ${input('خط طول البداية','origin_lng','number',true,'31.40')}
 ${input('إلى','destination_name','text',true,'الوجهة')}
 ${input('خط عرض الوجهة','destination_lat','number',true,'30.05')}
 ${input('خط طول الوجهة','destination_lng','number',true,'31.35')}
 ${input('تفاصيل الطريق أو مناطق المرور','route_description','text',false,'اختياري')}
 ${input('ميعاد التحرك','departure_at','datetime-local',true)}
 ${select('نوع المركبة المفضل','vehicle_type',[['','أي نوع متاح'],['private_car','ملاكي'],['suzuki','سوزوكي'],['microbus','ميكروباص']],false)}
 ${select('عدد المقاعد المطلوبة','seats',Array.from({length:6},(_,i)=>[String(i+1),String(i+1)]))}
 ${input('السعر المقترح للمقعد بالجنيه','seat_price','number',true,'مثال: 30')}
 <button class="btn primary full" type="submit">نشر طلب مشاركة الطريق</button><p id="notice" class="notice" role="status"></p></form>`)}
 <div class="page-head"><h2>طلباتي وعروض الكباتن</h2></div><div id="myGroupRequests" class="stack">جارٍ تحميل طلباتك…</div></main>`);
 const form=document.querySelector('#groupRequestForm');
 const dt=form.querySelector('[name="departure_at"]');
 dt.value=new Date(Date.now()+60*60*1000).toISOString().slice(0,16);
 form.onsubmit=async e=>{
  e.preventDefault();const fd=new FormData(form),v=k=>String(fd.get(k)||'').trim(),btn=form.querySelector('button[type="submit"]');busyButton(btn,true);
  try{
   const coords=['origin_lat','origin_lng','destination_lat','destination_lng'].map(k=>Number(v(k)));
   if(coords.some(n=>!Number.isFinite(n)))throw Error('راجع إحداثيات البداية والنهاية.');
   const price=Number(v('seat_price'));if(!Number.isFinite(price)||price<0)throw Error('أدخل سعرًا صحيحًا للمقعد.');
   const {error}=await db.rpc('create_share_route_request',{p_ride_mode:'scheduled_share',p_origin_name:v('origin_name'),p_origin_lat:coords[0],p_origin_lng:coords[1],p_destination_name:v('destination_name'),p_destination_lat:coords[2],p_destination_lng:coords[3],p_route_description:v('route_description')||null,p_departure_at:new Date(v('departure_at')).toISOString(),p_seats:Number(v('seats')),p_seat_price:price,p_vehicle_type:v('vehicle_type')||null});
   if(error)throw error;notice('تم نشر طلبك. سيظهر للكباتن المطابقين.','success');form.reset();dt.value=new Date(Date.now()+60*60*1000).toISOString().slice(0,16);await loadMyGroupRequests();
  }catch(err){notice(err.message||'تعذر نشر الطلب.','error');}
  finally{busyButton(btn,false);}
 };
 async function loadMyGroupRequests(){
  const box=document.querySelector('#myGroupRequests');if(!box)return;
  const [{data:requests,error:rErr},{data:negotiations,error:nErr}]=await Promise.all([
   db.from('share_route_requests').select('id,origin_name,destination_name,departure_at,seats_requested,requester_seat_price_egp,request_status,created_at').eq('requester_id',session.user.id).order('created_at',{ascending:false}).limit(30),
   db.from('share_route_negotiations').select('id,request_id,captain_id,requester_offer_egp,captain_counter_offer_egp,agreed_price_egp,negotiation_status,created_at').eq('requester_id',session.user.id).order('created_at',{ascending:false}).limit(50)
  ]);
  if(rErr||nErr){box.innerHTML='<section class="panel notice error">'+esc((rErr||nErr).message)+'</section>';return;}
  if(!requests?.length){box.innerHTML='<section class="panel empty">لم تنشر طلبات مشاركة طريق بعد.</section>';return;}
  const byRequest=new Map(requests.map(r=>[r.id,r]));
  const offers=(negotiations||[]).map(n=>{const r=byRequest.get(n.request_id);if(!r)return '';const status=({pending:'بانتظار رد الكابتن',counter_offer:'الكابتن قدم عرضًا بديلًا',accepted:'وافق الكابتن · في انتظار تأكيدك',confirmed:'تم تأكيد المشاركة',cancelled:'تم إلغاء التفاوض'})[n.negotiation_status]||n.negotiation_status;return `<article class="request"><b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b><p>${status}</p><p>عرضك: ${money(n.requester_offer_egp)} ${n.captain_counter_offer_egp!==null?' · عرض الكابتن: '+money(n.captain_counter_offer_egp):''} ${n.agreed_price_egp!==null?' · السعر المتفق عليه: '+money(n.agreed_price_egp):''}</p>${n.negotiation_status==='counter_offer'?'<button class="btn primary" data-rider-action="accept" data-negotiation="'+n.id+'">قبول عرض الكابتن</button> <button class="btn outline" data-rider-action="counter" data-negotiation="'+n.id+'">عرض سعر آخر</button>':''}${n.negotiation_status==='accepted'?'<button class="btn primary" data-rider-action="confirm" data-negotiation="'+n.id+'">تأكيد المشاركة</button>':''}</article>`;}).join('');
  const requestsHtml=requests.map(r=>`<article class="request"><b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b><p>${esc(r.request_status)} · ${r.seats_requested} مقعد · ${money(r.requester_seat_price_egp)} للمقعد</p><p class="muted">${date(r.departure_at)}</p></article>`).join('');
  box.innerHTML='<section class="panel"><h3>عروض الكباتن</h3>'+(offers||'<p>لا توجد عروض حتى الآن.</p>')+'</section><section class="panel"><h3>طلباتك المنشورة</h3>'+requestsHtml+'</section>';
  box.querySelectorAll('[data-rider-action]').forEach(btn=>btn.onclick=async()=>{
   let offer=null;if(btn.dataset.riderAction==='counter'){const raw=prompt('اكتب السعر الجديد للمقعد بالجنيه:');if(raw===null)return;offer=Number(raw);if(!Number.isFinite(offer)||offer<0){alert('أدخل سعرًا صحيحًا.');return;}}
   busyButton(btn,true);
   try{let result;if(btn.dataset.riderAction==='confirm')result=await db.rpc('confirm_share_route_match',{p_negotiation_id:btn.dataset.negotiation});else result=await db.rpc('requester_reply_share_route',{p_negotiation_id:btn.dataset.negotiation,p_action:btn.dataset.riderAction,p_new_offer:offer});if(result.error)throw result.error;await loadMyGroupRequests();}
   catch(err){alert(err.message||'تعذر تحديث العرض.');busyButton(btn,false);}
  });
 }
 await loadMyGroupRequests();
}
async function linesPage(){
 const dayNames=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
 if(profile?.account_type==='captain'){
  const [{data:vehicles,error:vehicleError},{data:lines,error:lineError}]=await Promise.all([
   db.from('vehicles').select('id,vehicle_type,make,model,plate_number,passenger_capacity').eq('captain_id',session.user.id).eq('approval_status','approved').eq('is_active',true),
   db.from('sekka_lines').select('id,title,origin_name,destination_name,approval_status,is_active,created_at').eq('captain_id',session.user.id).order('created_at',{ascending:false}).limit(30)
  ]);
  let captainLineBookingsHtml='<p>لا توجد حجوزات على خطوطك حتى الآن.</p>';
  const ownLineIds=(lines||[]).map(l=>l.id);
  if(ownLineIds.length){
   const {data:ownRuns}=await db.from('sekka_line_runs').select('id,line_id,departure_at').in('line_id',ownLineIds);
   const ownRunIds=(ownRuns||[]).map(r=>r.id);
   if(ownRunIds.length){
    const {data:ownBookings}=await db.from('sekka_line_bookings').select('id,run_id,pickup_stop_id,dropoff_stop_id,seats_requested,total_price_egp,booking_status').in('run_id',ownRunIds).order('created_at',{ascending:false}).limit(50);
    if(ownBookings?.length){
     const ownStopIds=[...new Set(ownBookings.flatMap(b=>[b.pickup_stop_id,b.dropoff_stop_id]))];
     const {data:ownStops}=await db.from('sekka_line_stops').select('id,stop_name').in('id',ownStopIds);
     const ownStopMap=new Map((ownStops||[]).map(s=>[s.id,s.stop_name]));
     const ownRunMap=new Map((ownRuns||[]).map(r=>[r.id,r.departure_at]));
     captainLineBookingsHtml=ownBookings.map(b=>'<article class="request"><b>'+esc(ownStopMap.get(b.pickup_stop_id)||'ركوب')+' ← '+esc(ownStopMap.get(b.dropoff_stop_id)||'نزول')+'</b><p>'+b.seats_requested+' مقعد · '+money(b.total_price_egp)+' · '+esc(b.booking_status)+'</p><p class="muted">'+date(ownRunMap.get(b.run_id))+'</p></article>').join('');
    }
   }
  }
  shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">خطوط السكة · مساحة الكابتن</span><h1>أنشئ خطًا ثابتًا</h1><p>حدد المحطات وأيام التشغيل وميعاد التحرك. بعد مراجعة الإدارة سيظهر الخط للركاب.</p></div>
  ${card('خط جديد',`<form id="lineCreateForm">
   ${input('اسم الخط','title','text',true,'مثال: التجمع – مدينة نصر')}
   ${select('المركبة','vehicle_id',(vehicles||[]).map(v=>[v.id,(v.make||'')+' '+(v.model||'')+' · '+v.plate_number+' · '+v.passenger_capacity+' مقعد']))}
   ${input('محطة البداية','origin_name','text',true,'اسم أول محطة')}
   ${input('محطة النهاية','destination_name','text',true,'اسم آخر محطة')}
   ${input('وصف الخط','description','text',false,'المناطق التي يمر بها الخط')}
   <label>المحطات بالترتيب (كل محطة في سطر: الاسم | خط العرض | خط الطول)<textarea name="stops" rows="5" required placeholder="محطة البداية | 30.01 | 31.40&#10;محطة وسطى | 30.03 | 31.42&#10;محطة النهاية | 30.05 | 31.45"></textarea></label>
   <fieldset class="days-field"><legend>أيام تشغيل الخط</legend>${dayNames.map((d,i)=>'<label class="check"><input type="checkbox" name="days" value="'+i+'" '+(i<5?'checked':'')+'> '+d+'</label>').join('')}</fieldset>
   ${input('ميعاد التحرك','departure_time','time',true)}
   ${input('عدد المقاعد في الرحلة','seats','number',true,'حسب سعة المركبة')}
   ${input('سعر المقعد بالجنيه','seat_price','number',true,'السعر الثابت للمقعد')}
   <button class="btn primary full" type="submit" ${vehicles?.length?'':'disabled'}>إرسال الخط للمراجعة</button><p id="notice" class="notice" role="status"></p>
  </form>`)}
  ${vehicleError?'<p class="notice error">'+esc(vehicleError.message)+'</p>':''}
  ${vehicles?.length?'':'<section class="panel notice">لا توجد مركبة معتمدة ونشطة لإنشاء الخط.</section>'}
  <div class="page-head"><h2>خطوطي</h2></div><div class="stack">${lineError?'<section class="panel notice error">'+esc(lineError.message)+'</section>':(lines||[]).map(l=>'<section class="panel"><b>'+esc(l.title)+'</b><p>'+esc(l.origin_name)+' ← '+esc(l.destination_name)+'</p><span class="pill">'+esc(l.approval_status==='approved'?'معتمد':l.approval_status==='rejected'?'مرفوض':'قيد المراجعة')+'</span></section>').join('')||'<section class="panel empty">لم تنشئ خطوطًا بعد.</section>'}</div>
  ${card('حجوزات الركاب على خطوطك',captainLineBookingsHtml)}
  </main>`);
  const form=document.querySelector('#lineCreateForm');
  if(form)form.onsubmit=async e=>{
   e.preventDefault();const fd=new FormData(form),v=k=>String(fd.get(k)||'').trim(),btn=form.querySelector('button[type="submit"]');busyButton(btn,true);
   try{
    const stops=v('stops').split(/\r?\n/).map(row=>row.split('|').map(x=>x.trim())).filter(parts=>parts.length>=3&&parts[0]);
    if(stops.length<2)throw Error('أضف محطتين على الأقل، بداية ونهاية.');
    const parsed=stops.map(([name,lat,lng])=>({name,lat:Number(lat),lng:Number(lng)}));
    if(parsed.some(s=>!Number.isFinite(s.lat)||!Number.isFinite(s.lng)))throw Error('إحداثيات كل محطة يجب أن تكون أرقامًا صحيحة.');
    if(parsed[0].name!==v('origin_name')||parsed[parsed.length-1].name!==v('destination_name'))throw Error('اسم أول محطة يجب أن يطابق البداية، وآخر محطة يجب أن تطابق النهاية.');
    const days=fd.getAll('days').map(Number);if(!days.length)throw Error('حدد يوم تشغيل واحدًا على الأقل.');
    const {error}=await db.rpc('create_sekka_line',{p_vehicle_id:v('vehicle_id'),p_title:v('title'),p_origin_name:v('origin_name'),p_destination_name:v('destination_name'),p_description:v('description')||null,p_stops:parsed,p_service_days:days,p_departure_time:v('departure_time'),p_seats:Number(v('seats')),p_seat_price:Number(v('seat_price'))});
    if(error)throw error;notice('تم إرسال الخط للمراجعة. سيظهر للركاب بعد اعتماد الإدارة.','success');await linesPage();
   }catch(err){notice(err.message||'تعذر إنشاء الخط.','error');}
   finally{busyButton(btn,false);}
  };
  return;
 }
 shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">خطوط السكة</span><h1>خطوط ثابتة ومواعيد منتظمة</h1><p>اختار الخط وميعاد الرحلة ومحطتي الركوب والنزول واحجز مقعدك.</p></div><div id="availableLines" class="stack">جارٍ تحميل الخطوط…</div></main>`);
 const box=document.querySelector('#availableLines');
 const {data:lines,error}=await db.from('sekka_lines').select('id,title,origin_name,destination_name,description').eq('approval_status','approved').eq('is_active',true).order('title').limit(50);
 if(error){box.innerHTML='<section class="panel notice error">'+esc(error.message)+'</section>';return;}
 if(!lines?.length){box.innerHTML='<section class="panel empty">لا توجد خطوط معتمدة متاحة حاليًا.</section>';return;}
 const ids=lines.map(l=>l.id);
 const [{data:schedules,error:sErr},{data:stops,error:stErr}]=await Promise.all([
  db.from('sekka_line_schedules').select('id,line_id,service_days,departure_time,seats_total,seat_price_egp').in('line_id',ids).eq('is_active',true),
  db.from('sekka_line_stops').select('id,line_id,stop_order,stop_name,can_pickup,can_dropoff').in('line_id',ids).order('stop_order')
 ]);
 if(sErr||stErr){box.innerHTML='<section class="panel notice error">'+esc((sErr||stErr).message)+'</section>';return;}
 box.innerHTML=lines.map(line=>{
  const lineSchedules=(schedules||[]).filter(s=>s.line_id===line.id),lineStops=(stops||[]).filter(s=>s.line_id===line.id);
  return `<section class="panel"><h2>${esc(line.title)}</h2><h3>${esc(line.origin_name)} ← ${esc(line.destination_name)}</h3><p>${esc(line.description||'خط معتمد من السكة')}</p><p class="muted">المحطات: ${lineStops.map(s=>esc(s.stop_name)).join(' ← ')}</p>${lineSchedules.map(s=>{
   const pickup=lineStops.filter(x=>x.can_pickup),dropoff=lineStops.filter(x=>x.can_dropoff);
   return `<form class="line-book-form" data-line-schedule="${s.id}" data-time="${String(s.departure_time).slice(0,5)}"><div class="ride-top"><b>ميعاد ${String(s.departure_time).slice(0,5)}</b><span class="pill">${s.seats_total} مقعد</span></div><p>أيام التشغيل: ${(s.service_days||[]).map(d=>dayNames[d]).join('، ')} · ${money(s.seat_price_egp)} للمقعد</p><label>تاريخ الرحلة<input type="date" name="run_date" min="${new Date().toISOString().slice(0,10)}" max="${new Date(Date.now()+90*86400000).toISOString().slice(0,10)}" required></label><label>محطة الركوب<select name="pickup_stop" required>${pickup.map(x=>'<option value="'+x.id+'">'+esc(x.stop_name)+'</option>').join('')}</select></label><label>محطة النزول<select name="dropoff_stop" required>${dropoff.map(x=>'<option value="'+x.id+'">'+esc(x.stop_name)+'</option>').join('')}</select></label><label>عدد المقاعد<select name="seats">${Array.from({length:Math.min(13,s.seats_total)},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'</option>').join('')}</select></label><button class="btn primary full" type="submit">احجز في الخط</button><p class="notice" role="status"></p></form>`;
  }).join('')||'<p class="muted">لا توجد مواعيد نشطة لهذا الخط.</p>'}</section>`;
 }).join('');
 box.querySelectorAll('[data-line-schedule]').forEach(form=>form.onsubmit=async e=>{
  e.preventDefault();const fd=new FormData(form),dateValue=String(fd.get('run_date')||''),time=form.dataset.time,btn=form.querySelector('button[type="submit"]');
  const departure=new Date(dateValue+'T'+time+':00');if(!dateValue||Number.isNaN(departure.getTime())){form.querySelector('.notice').textContent='اختر تاريخًا صحيحًا.';return;}
  busyButton(btn,true);
  try{const {error}=await db.rpc('request_sekka_line_seats',{p_schedule_id:form.dataset.lineSchedule,p_departure_at:departure.toISOString(),p_pickup_stop_id:String(fd.get('pickup_stop')),p_dropoff_stop_id:String(fd.get('dropoff_stop')),p_seats:Number(fd.get('seats'))});if(error)throw error;form.querySelector('.notice').textContent='تم حجز مقعدك بنجاح.';form.querySelector('.notice').className='notice success';}
  catch(err){form.querySelector('.notice').textContent=err.message||'تعذر إتمام الحجز.';form.querySelector('.notice').className='notice error';}
  finally{busyButton(btn,false);}
 });
}
async function tripsPage(){
  shell(`<main class="wrap"><div class="page-head"><h1>حجوزاتي</h1><p>تابع طلبات المقاعد على الرحلات المنشورة.</p></div><div id="myTrips" class="stack">جارٍ التحميل…</div></main>`);
  const box=document.querySelector('#myTrips');
  const {data,error}=await db.from('bookings').select('id,ride_id,pickup_name,dropoff_name,booking_status,agreed_price_egp,created_at').eq('passenger_id',session.user.id).order('created_at',{ascending:false}).limit(50);
  if(error){box.innerHTML='<section class="panel empty">تعذر تحميل الحجوزات. '+esc(error.message)+'</section>';return;}
  const rows=data||[];
  box.innerHTML=rows.length?rows.map(x=>`<section class="panel"><div class="ride-top"><b>${esc(x.pickup_name)} ← ${esc(x.dropoff_name)}</b><span class="pill">${esc(x.booking_status)}</span></div><p>${money(x.agreed_price_egp??x.passenger_offer_egp)} · ${date(x.created_at)}</p>${x.booking_status==='accepted'?'<button class="btn primary" data-confirm-booking="'+x.id+'">تأكيد الحجز</button>':''}${['pending','counter_offer','accepted','confirmed'].includes(x.booking_status)?'<button class="btn danger" data-cancel-booking="'+x.id+'">إلغاء الحجز</button>':''}</section>`).join(''):'<section class="panel empty">لا توجد حجوزات مسجلة حتى الآن.</section>';
  box.querySelectorAll('[data-confirm-booking]').forEach(btn=>btn.onclick=async()=>{busyButton(btn,true);try{const {error}=await db.rpc('confirm_seat_booking',{p_booking_id:btn.dataset.confirmBooking});if(error)throw error;await tripsPage();}catch(err){alert(err.message||'تعذر تأكيد الحجز.');busyButton(btn,false);}});
  box.querySelectorAll('[data-cancel-booking]').forEach(btn=>btn.onclick=async()=>{if(!confirm('تأكيد إلغاء الحجز؟'))return;busyButton(btn,true);try{const {error}=await db.rpc('passenger_cancel_shared_ride_booking',{p_booking_id:btn.dataset.cancelBooking});if(error)throw error;await tripsPage();}catch(err){alert(err.message||'تعذر إلغاء الحجز.');busyButton(btn,false);}});
  const {data:lineBookings}=await db.from('sekka_line_bookings').select('id,run_id,pickup_stop_id,dropoff_stop_id,seats_requested,total_price_egp,booking_status,created_at').eq('passenger_id',session.user.id).order('created_at',{ascending:false}).limit(30);
  if(lineBookings?.length){
   const stopIds=[...new Set(lineBookings.flatMap(b=>[b.pickup_stop_id,b.dropoff_stop_id]))],runIds=[...new Set(lineBookings.map(b=>b.run_id))];
   const [{data:stops},{data:runs}]=await Promise.all([db.from('sekka_line_stops').select('id,stop_name').in('id',stopIds),db.from('sekka_line_runs').select('id,departure_at').in('id',runIds)]);
   const stopMap=new Map((stops||[]).map(s=>[s.id,s.stop_name])),runMap=new Map((runs||[]).map(r=>[r.id,r.departure_at]));
   box.insertAdjacentHTML('beforeend','<section class="panel"><h2>حجوزات خطوط السكة</h2>'+lineBookings.map(b=>'<article class="request"><b>'+esc(stopMap.get(b.pickup_stop_id)||'محطة الركوب')+' ← '+esc(stopMap.get(b.dropoff_stop_id)||'محطة النزول')+'</b><p>'+esc(b.booking_status)+' · '+b.seats_requested+' مقعد · '+money(b.total_price_egp)+'</p><p class="muted">'+date(runMap.get(b.run_id))+'</p>'+(b.booking_status==='confirmed'?'<button class="btn danger" data-line-cancel="'+b.id+'">إلغاء الحجز</button>':'')+'</article>').join('')+'</section>');
   box.querySelectorAll('[data-line-cancel]').forEach(btn=>btn.onclick=async()=>{if(!confirm('تأكيد إلغاء حجز خط السكة؟'))return;busyButton(btn,true);try{const {error}=await db.rpc('cancel_sekka_line_booking',{p_booking_id:btn.dataset.lineCancel});if(error)throw error;await tripsPage();}catch(err){alert(err.message||'تعذر إلغاء الحجز.');busyButton(btn,false);}});
  }
 }
async function accountPage(){
 if(profile.account_type==='captain'){captainHome();return;}
 shell(`<main class="wrap narrow"><div class="page-head"><h1>حسابي</h1></div>${card('بيانات الحساب',`<p><b>الاسم:</b> ${esc(profile.display_name||'—')}</p><p><b>البريد:</b> ${esc(session.user.email)}</p><p><b>نوع الحساب:</b> ${esc(profile.account_type)}</p><button class="btn outline" data-view="trips">حجوزاتي</button>`)}</main>`);
}
async function captainHome(){
  const [{data:appRow},{data:vehicles},{data:rides},{data:subscriptions}] = await Promise.all([
   db.from('captain_applications').select('application_status,admin_notes').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(1).maybeSingle(),
   db.from('vehicles').select('id,vehicle_type,make,model,plate_number,approval_status,is_active').eq('captain_id',session.user.id),
   db.from('rides').select('id,origin_name,destination_name,departure_at,available_seats,seat_price_egp,ride_status').eq('captain_id',session.user.id).order('departure_at',{ascending:false}).limit(20),
   db.from('captain_subscriptions').select('id,plan_days,amount_egp,payment_status,starts_at,expires_at,created_at').eq('captain_id',session.user.id).order('created_at',{ascending:false}).limit(10)
  ]);
  const ownRideIds=(rides||[]).map(r=>r.id);
  let captainBookings=[];
  if(ownRideIds.length){
   const {data:bookingRows}=await db.from('bookings').select('id,ride_id,passenger_id,pickup_name,dropoff_name,seats_requested,passenger_offer_egp,agreed_price_egp,booking_status,created_at').in('ride_id',ownRideIds).order('created_at',{ascending:false}).limit(60);
   captainBookings=bookingRows||[];
  }
  const captainBookingsHtml=captainBookings.map(b=>`<article class="request"><b>${esc(b.pickup_name)} ← ${esc(b.dropoff_name)}</b><p>${b.seats_requested} مقعد · عرض الراكب: ${money(b.passenger_offer_egp)} · ${esc(b.booking_status)}</p><p class="muted">${date(b.created_at)}</p>${b.booking_status==='pending'||b.booking_status==='counter_offer'?'<button class="btn primary" data-captain-booking="accept" data-booking="'+b.id+'">قبول الحجز</button> <button class="btn danger" data-captain-booking="reject" data-booking="'+b.id+'">رفض</button>':''}</article>`).join('')||'<p>لا توجد طلبات حجز جديدة على رحلاتك.</p>';
  const now=Date.now();
  const activeSubscription=(subscriptions||[]).find(s=>s.payment_status==='approved'&&s.starts_at&&new Date(s.starts_at).getTime()<=now&&s.expires_at&&new Date(s.expires_at).getTime()>now);
  const pendingSubscription=(subscriptions||[]).find(s=>s.payment_status==='submitted');
  const subscriptionForm=`<form id="subscriptionForm">
   <label>الباقة<select name="plan_days" required><option value="30">150 ج / 30 يوم</option><option value="90">400 ج / 90 يوم</option></select></label>
   <div class="payment-number"><b>حوّل قيمة الباقة عبر Vodafone Cash أو InstaPay</b><strong dir="ltr">01010530716</strong><button type="button" class="btn outline" id="copyPaymentNumber">نسخ الرقم</button></div>
   <label>رقم التحويل أو مرجع العملية<input name="payment_reference" required maxlength="120" placeholder="اكتب رقم العملية أو رقم المحوّل"></label>
   <label>صورة أو ملف إثبات الدفع<input name="payment_proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
   <small class="muted">الحد الأقصى لحجم الملف 5 ميجابايت. سيتم مراجعة التحويل وتفعيل الاشتراك بعد الاعتماد.</small>
   <button class="btn primary full" type="submit">إرسال طلب الاشتراك</button>
   <p id="subscriptionNotice" class="notice" role="status"></p>
  </form>`;
  let subscriptionPanel='';
  if(activeSubscription){
   subscriptionPanel=`<section class="panel subscription-panel">
    <div class="ride-top"><h2>اشتراكك نشط</h2><span class="pill">مفعّل</span></div>
    <p>الباقة: ${activeSubscription.plan_days===90?'3 شهور':'شهر واحد'} · ${money(activeSubscription.amount_egp)}</p>
    <p>ينتهي الاشتراك: <b>${date(activeSubscription.expires_at)}</b></p>
    ${pendingSubscription?'<p class="notice">يوجد طلب تجديد قيد المراجعة بالفعل.</p>':`<details class="subscription-details"><summary>تجديد الاشتراك</summary>${subscriptionForm}</details>`}
   </section>`;
  }else{
   subscriptionPanel=`<section class="panel subscription-panel">
    <h2>تفعيل الكابتن</h2>
    <p>يلزم اشتراك نشط لنشر الرحلات وإتاحة المقاعد للركاب.</p>
    <details class="subscription-details" ${pendingSubscription?'':'open'}><summary>تقديم / تجديد الاشتراك</summary>${pendingSubscription?'<p class="notice">طلب الاشتراك قيد المراجعة بالفعل. لن تحتاج إلى إرسال طلب آخر.</p>':subscriptionForm}</details>
   </section>`;
  }
  const ridesHtml=(rides||[]).map(r=>`<article class="request"><b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b><p>${r.available_seats} مقعد متاح · ${money(r.seat_price_egp)} للمقعد</p><p class="muted">${date(r.departure_at)} · ${esc(r.ride_status)}</p>${['open','full'].includes(r.ride_status)?'<button class="btn danger" data-cancel-ride="'+r.id+'">إلغاء الطريق</button>':''}</article>`).join('')||'<p>لم تنشر أي طريق حتى الآن.</p>';
  shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">مساحة الكابتن</span><h1>أهلاً ${esc(profile.display_name||'يا كابتن')}</h1><p>انشر طريقك ومقاعدك المتاحة، وتابع حجوزات الركاب.</p></div>
  ${subscriptionPanel}
  ${card('طلبات حجز المقاعد',captainBookingsHtml)}
  ${card('رحلاتي المنشورة',`<div class="stack">${ridesHtml}</div><button class="btn primary" data-view="share">انشر طريقًا جديدًا</button>`)}
  ${card('حالة طلب الانضمام',`<p class="pill">${esc(appRow?.application_status||'لم يتم التقديم')}</p><p>${esc(appRow?.admin_notes||'قدّم بياناتك ومستنداتك لاستكمال التفعيل.')}</p><button class="btn primary" data-view="apply">تقديم / تحديث بيانات الكابتن</button>`)}
  ${card('مركباتي',(vehicles||[]).map(v=>`<p>${esc(v.make)} ${esc(v.model)} · ${esc(v.plate_number)} — ${esc(v.approval_status)}</p>`).join('')||'<p>لا توجد مركبات مسجلة.</p>')}
  </main>`);
  document.querySelectorAll('[data-captain-booking]').forEach(btn=>btn.onclick=async()=>{busyButton(btn,true);try{const {error}=await db.rpc('captain_reply_booking',{p_booking_id:btn.dataset.booking,p_action:btn.dataset.captainBooking,p_counter_price:null});if(error)throw error;await captainHome();}catch(err){alert(err.message||'تعذر تحديث طلب الحجز.');busyButton(btn,false);}});
  document.querySelectorAll('[data-cancel-ride]').forEach(btn=>btn.onclick=async()=>{if(!confirm('إلغاء الطريق سيؤدي إلى إلغاء الحجوزات المرتبطة به. هل تريد المتابعة؟'))return;busyButton(btn,true);try{const {error}=await db.rpc('captain_cancel_shared_ride',{p_ride_id:btn.dataset.cancelRide});if(error)throw error;await captainHome();}catch(err){alert(err.message||'تعذر إلغاء الطريق.');busyButton(btn,false);}});
  document.querySelector('#copyPaymentNumber')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText('01010530716');const n=document.querySelector('#subscriptionNotice');if(n)n.textContent='تم نسخ الرقم.';}catch{alert('تعذر النسخ تلقائيًا. الرقم هو 01010530716');}});
  document.querySelector('#subscriptionForm')?.addEventListener('submit',async e=>{
   e.preventDefault();
   const form=e.currentTarget,fd=new FormData(form),file=fd.get('payment_proof'),btn=form.querySelector('button[type="submit"]');
   busyButton(btn,true);
   try{
    if(!(file instanceof File)||!file.size)throw Error('أرفق إثبات الدفع أولاً.');
    if(file.size>5*1024*1024)throw Error('حجم الملف يجب ألا يتجاوز 5 ميجابايت.');
    if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw Error('نوع الملف غير مدعوم. استخدم JPG أو PNG أو WEBP أو PDF.');
    const path=session.user.id+'/'+Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const {error:uploadError}=await db.storage.from('captain-payment-proofs').upload(path,file,{upsert:false,contentType:file.type});
    if(uploadError)throw uploadError;
    const {error}=await db.rpc('submit_subscription',{p_plan_days:Number(fd.get('plan_days')),p_payment_reference:String(fd.get('payment_reference')||'').trim(),p_proof_path:path});
    if(error)throw error;
    alert('تم إرسال طلب الاشتراك بنجاح، وسيتم مراجعته من الإدارة.');
    captainHome();
   }catch(err){
    const n=document.querySelector('#subscriptionNotice');
    if(n){n.textContent=err.message||'تعذر إرسال طلب الاشتراك.';n.className='notice error';}
    else alert(err.message||'تعذر إرسال طلب الاشتراك.');
   }finally{busyButton(btn,false);}
  });
 }
function applyPage(){
 shell(`<main class="wrap narrow"><div class="page-head"><h1>تقديم بيانات الكابتن والمركبة</h1></div>${card('بيانات التقديم',`<form id="applyForm">${input('آخر 4 أرقام من الرقم القومي','national_id_last4','text',true,'1234')}${input('رقم رخصة القيادة','license_number')}${input('تاريخ انتهاء رخصة القيادة','license_expiry','date')}${input('تاريخ انتهاء البطاقة','national_id_expiry','date')}${input('تاريخ انتهاء رخصة المركبة','vehicle_license_expiry','date')}${select('نوع المركبة','vehicle_type',[['private_car','ملاكي'],['suzuki','سوزوكي'],['microbus','ميكروباص']])}${input('الماركة','make')}${input('الموديل','model')}${input('سنة الصنع','model_year','number')}${input('اللون','color')}${input('رقم اللوحة','plate_number')}${input('عدد الركاب','passenger_capacity','number')}${['has_ac','has_large_trunk','no_smoking','pets_allowed'].map((n,i)=>`<label class="check"><input type="checkbox" name="${n}" ${i===2?'checked':''}> ${['تكييف','شنطة كبيرة','ممنوع التدخين','يسمح بالحيوانات الأليفة'][i]}</label>`).join('')}<div class="upload-group"><h3>مستندات مطلوبة</h3><label>البطاقة الشخصية — الوجه الأمامي<input type="file" name="national_id_front" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>البطاقة الشخصية — الوجه الخلفي<input type="file" name="national_id_back" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>رخصة القيادة — الوجه الأمامي<input type="file" name="driver_license_front" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>رخصة القيادة — الوجه الخلفي<input type="file" name="driver_license_back" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>رخصة المركبة — الوجه الأمامي<input type="file" name="vehicle_license_front" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>رخصة المركبة — الوجه الخلفي<input type="file" name="vehicle_license_back" accept="image/jpeg,image/png,image/webp,image/heic" required></label></div><div class="upload-group"><h3>صور الكابتن والمركبة</h3><label>صورة شخصية<input type="file" name="profile_photo" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>صورة أمامية للمركبة<input type="file" name="vehicle_front" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>صورة جانبية للمركبة<input type="file" name="vehicle_side" accept="image/jpeg,image/png,image/webp,image/heic" required></label><label>صورة خلفية للمركبة<input type="file" name="vehicle_rear" accept="image/jpeg,image/png,image/webp,image/heic" required></label></div><button class="btn primary full">إرسال الطلب</button><p id="notice" class="notice"></p></form>`)}<button class="btn outline" data-view="captain">رجوع للوحة الكابتن</button></main>`);
 document.querySelector('#applyForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),v=n=>String(f.get(n)||'').trim(),b=e.currentTarget.querySelector('button[type=submit]');busyButton(b,true);try{const upload=async(field,bucket)=>{const file=f.get(field);if(!(file instanceof File)||!file.size)throw Error('اختر كل المستندات والصور المطلوبة.');if(file.size>5*1024*1024)throw Error('حجم كل صورة يجب ألا يتجاوز 5 ميجابايت.');const path=session.user.id+'/'+Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const {error}=await db.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return path;};const paths={};for(const key of ['national_id_front','national_id_back','driver_license_front','driver_license_back','vehicle_license_front','vehicle_license_back'])paths[key]=await upload(key,'captain-documents');for(const key of ['profile_photo','vehicle_front','vehicle_side','vehicle_rear'])paths[key]=await upload(key,'captain-media');const args={p_national_id_last4:v('national_id_last4'),p_national_id_expiry:v('national_id_expiry'),p_license_number:v('license_number'),p_license_expiry:v('license_expiry'),p_vehicle_license_expiry:v('vehicle_license_expiry'),p_national_id_front_path:paths.national_id_front,p_national_id_back_path:paths.national_id_back,p_driver_license_front_path:paths.driver_license_front,p_driver_license_back_path:paths.driver_license_back,p_vehicle_license_front_path:paths.vehicle_license_front,p_vehicle_license_back_path:paths.vehicle_license_back,p_vehicle_type:v('vehicle_type'),p_make:v('make'),p_model:v('model'),p_model_year:Number(v('model_year')),p_color:v('color'),p_plate_number:v('plate_number'),p_passenger_capacity:Number(v('passenger_capacity')),p_has_ac:f.has('has_ac'),p_has_large_trunk:f.has('has_large_trunk'),p_no_smoking:f.has('no_smoking'),p_pets_allowed:f.has('pets_allowed'),p_profile_photo_path:paths.profile_photo,p_vehicle_front_path:paths.vehicle_front,p_vehicle_side_path:paths.vehicle_side,p_vehicle_rear_path:paths.vehicle_rear};const {error}=await db.rpc('submit_captain_application_v3',args);if(error)throw error;notice('تم إرسال طلبك بنجاح.','success');setTimeout(()=>{view='captain';render();},700);}catch(err){notice(err.message||'تعذر إرسال الطلب.','error');}finally{busyButton(b,false);}};
}
async function adminHome(){
 const [{data:apps,error:appsError},{data:subscriptions,error:subscriptionsError},{data:pendingLines,error:linesError}] = await Promise.all([
  db.from('captain_applications').select('id,user_id,application_status,national_id_last4,license_number,created_at').order('created_at',{ascending:false}).limit(50),
  db.from('captain_subscriptions').select('id,captain_id,plan_days,amount_egp,payment_reference,payment_proof_path,created_at').eq('payment_status','submitted').order('created_at',{ascending:true}).limit(50),
  db.from('sekka_lines').select('id,title,origin_name,destination_name,created_at').eq('approval_status','pending').order('created_at',{ascending:true}).limit(50)
 ]);
 const pendingRows=await Promise.all((subscriptions||[]).map(async s=>{
  const {data}=await db.storage.from('captain-payment-proofs').createSignedUrl(s.payment_proof_path,600);
  const proofUrl=data?.signedUrl;
  return `<article class="request"><b>طلب اشتراك · ${s.plan_days===90?'3 شهور':'شهر واحد'} · ${money(s.amount_egp)}</b><p>رقم الكابتن: ${esc(String(s.captain_id).slice(0,8))}…</p><p>مرجع التحويل: ${esc(s.payment_reference||'—')}</p><p class="muted">${date(s.created_at)}</p>${proofUrl?`<p><a href="${esc(proofUrl)}" target="_blank" rel="noopener">عرض إثبات الدفع</a></p>`:'<p class="notice error">تعذر إنشاء رابط إثبات الدفع. تحقق من صلاحية قراءة الملفات.</p>'}<button class="btn primary" data-subscription-review="${s.id}" data-decision="approve">اعتماد الاشتراك</button> <button class="btn danger" data-subscription-review="${s.id}" data-decision="reject">رفض الطلب</button></article>`;
 })).join('');
 shell(`<main class="wrap"><div class="page-head"><h1>لوحة الإدارة</h1><p>مراجعة طلبات الكباتن والاشتراكات.</p></div>
 ${card('خطوط السكة قيد المراجعة',linesError?esc(linesError.message):(pendingLines||[]).map(l=>`<article class="request"><b>${esc(l.title)}</b><p>${esc(l.origin_name)} ← ${esc(l.destination_name)}</p><button class="btn primary" data-line-review="${l.id}" data-approve="true">اعتماد الخط</button> <button class="btn danger" data-line-review="${l.id}" data-approve="false">رفض الخط</button></article>`).join('')||'<p>لا توجد خطوط جديدة.</p>')}
 ${card('طلبات الاشتراك',subscriptionsError?esc(subscriptionsError.message):(pendingRows||'<p>لا توجد طلبات اشتراك قيد المراجعة.</p>'))}
 ${card('طلبات انضمام الكباتن',appsError?esc(appsError.message):(apps||[]).map(a=>`<article class="request"><b>${esc(a.national_id_last4||'—')} · ${esc(a.license_number||'—')}</b><p>${esc(a.application_status)} · ${date(a.created_at)}</p><button class="btn outline" data-review="${a.id}" data-status="approved">اعتماد</button> <button class="btn danger" data-review="${a.id}" data-status="rejected">رفض</button></article>`).join('')||'<p>لا توجد طلبات.</p>')}</main>`);
 document.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{const {error}=await db.rpc('review_captain_application_v2',{p_application_id:b.dataset.review,p_decision:b.dataset.status,p_admin_notes:null});if(error)alert(error.message);else adminHome();});
 document.querySelectorAll('[data-line-review]').forEach(b=>b.onclick=async()=>{busyButton(b,true);try{const {error}=await db.rpc('admin_review_sekka_line',{p_line_id:b.dataset.lineReview,p_approve:b.dataset.approve==='true'});if(error)throw error;await adminHome();}catch(err){alert(err.message||'تعذر مراجعة الخط.');busyButton(b,false);}});
 document.querySelectorAll('[data-subscription-review]').forEach(b=>b.onclick=async()=>{
  const decision=b.dataset.decision;
  if(!confirm(decision==='approve'?'تأكيد اعتماد الاشتراك؟':'تأكيد رفض طلب الاشتراك؟'))return;
  busyButton(b,true);
  try{
   const {error}=await db.rpc(decision==='approve'?'admin_approve_subscription':'admin_reject_subscription',{p_subscription_id:b.dataset.subscriptionReview});
   if(error)throw error;
   await adminHome();
  }catch(err){alert(err.message||'تعذر تحديث حالة الاشتراك.');busyButton(b,false);}
 });
}
function render(){if(!session){authPage();return;}if(!profile){loadProfile().then(()=>{if(profile)render();else{authMode='signin';session=null;authPage();notice('تعذر تحميل ملف الحساب أو أن الحساب غير مفعّل. سجّل الدخول مرة أخرى.','error');}});return;}if(profile.account_type==='captain'&&view==='apply'){applyPage();return;}if(profile.account_type==='captain'&&view==='home')view='captain';if(profile.account_type==='admin'&&view==='home')view='admin';switch(view){case'home':home();break;case'share':sharePage();break;case'group':groupPage();break;case'lines':linesPage();break;case'trips':tripsPage();break;case'account':accountPage();break;case'captain':captainHome();break;case'admin':adminHome();break;case'apply':applyPage();break;default:home();}}
db.auth.getSession().then(({data})=>{session=data.session;render();});
db.auth.onAuthStateChange((_event,next)=>{session=next;profile=null;render();});
