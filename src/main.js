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
 root.innerHTML=`<header class="top"><a class="brand" href="#" data-view="home"><span class="mark">س</span><span><b>السكة</b><small>مشوارك.. على طريقك</small></span></a><div class="top-actions">${session?'<span class="user-tag">'+esc(profile?.display_name||session.user.email)+'</span><button class="btn outline" id="logout">خروج</button>':''}</div></header>
 ${content}
 ${session?'<nav class="bottom"><button data-view="home">الرئيسية</button><button data-view="trip">اطلب مشوار</button><button data-view="share">مشاركة الطريق</button><button data-view="account">حسابي</button></nav>':''}
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
 shell(`<main class="wrap"><section class="hero"><span class="eyebrow">أهلاً بك في السكة</span><h1>كل مشوار له <em>سكة</em></h1><p>اطلب رحلة بسعر واضح، أو شارك الطريق مع كابتن رايح في نفس اتجاهك.</p><div class="actions"><button class="btn primary" data-view="trip">اطلب مشوار</button><button class="btn outline" data-view="share">شارك الطريق</button></div></section><div class="tiles"><button class="tile" data-view="trip"><span>🚕</span><b>مشوار عادي</b><small>اطلب كابتن لوجهتك</small></button><button class="tile" data-view="share"><span>🛣️</span><b>مشاركة الطريق</b><small>احجز مقعدًا على طريق منشور</small></button><button class="tile" data-view="trips"><span>📋</span><b>رحلاتي</b><small>تابع طلباتك وحجوزاتك</small></button></div></main>`);
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
function tripPage(){
 shell(`<main class="wrap narrow"><div class="page-head"><span class="eyebrow">طلب رحلة</span><h1>إلى أين تذهب؟</h1><p>أدخل بيانات المشوار وسيحسب النظام السعر المتاح.</p></div>${card('تفاصيل المشوار',`<form id="tripForm">${select('نوع المركبة','vehicle_type',[['private_car','ملاكي'],['taxi','تاكسي'],['suzuki','سوزوكي'],['microbus','ميكروباص'],['scooter','اسكوتر'],['motorcycle','دراجة نارية']])}${input('مكان الركوب','origin_name','text',true,'مثال: التجمع الخامس')}${input('الوجهة','destination_name','text',true,'مثال: مدينة نصر')}${input('عدد الركاب','passenger_count','number',true,'1')}${input('ميعاد الرحلة (اختياري)','scheduled_at','datetime-local',false)}${input('ملاحظات للكابتن (اختياري)','pickup_note','text',false)}<button class="btn primary full">إرسال طلب الرحلة</button><p id="notice" class="notice" role="status"></p></form>`)}<button class="btn outline" data-view="trips">متابعة طلباتي</button></main>`);
 document.querySelector('#tripForm').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),origin=String(f.get('origin_name')).trim(),dest=String(f.get('destination_name')).trim(),count=Number(f.get('passenger_count')||1),scheduled=String(f.get('scheduled_at')||'');
  if(!origin||!dest||count<1||count>13){notice('راجع مكان الركوب والوجهة وعدد الركاب (من 1 إلى 13).','error');return;}
  const btn=e.currentTarget.querySelector('button[type=submit]');busyButton(btn,true);
  try{
   const {data,error}=await db.rpc('server_create_fixed_trip_request',{p_passenger_id:session.user.id,p_vehicle_type:f.get('vehicle_type'),p_origin_name:origin,p_origin_lat:Number(f.get('origin_lat')),p_origin_lng:Number(f.get('origin_lng')),p_destination_name:dest,p_destination_lat:Number(f.get('destination_lat')),p_destination_lng:Number(f.get('destination_lng')),p_scheduled_at:scheduled?new Date(scheduled).toISOString():null,p_is_scheduled:!!scheduled,p_passenger_count:count,p_distance_km:Number(f.get('distance_km')),p_pickup_note:String(f.get('pickup_note')||'').trim()||null,p_ride_preferences:{source:'web-app'}});
   if(error)throw error;notice('تم إرسال طلبك. رقم الطلب: '+data,'success');setTimeout(()=>{view='trips';render();},900);
  }catch(err){notice(err.message||'تعذر إرسال الطلب. تحقق من اتصالك وحاول مجددًا.','error');}
  finally{busyButton(btn,false);}
 };
}
async function sharePage(){
 if(profile?.account_type==='captain'){
  const {data:vehicles}=await db.from('vehicles').select('id,vehicle_type,make,model,plate_number,approval_status,is_active').eq('captain_id',session.user.id).eq('approval_status','approved').eq('is_active',true);
  shell(`<main class="wrap narrow"><div class="page-head"><span class="eyebrow">خطوطي ومقاعدي</span><h1>انشر طريقك</h1><p>أضف رحلة ليتمكن الركاب من طلب مقاعد على نفس الطريق.</p></div>${card('رحلة جديدة',`<form id="rideForm">${select('المركبة','vehicle_id',(vehicles||[]).map(v=>[v.id,v.make+' '+v.model+' · '+v.plate_number]))}${select('نوع الرحلة','ride_mode',[['scheduled_share','رحلة بميعاد']])}${input('من','origin_name','text',true,'نقطة البداية')}${input('إلى','destination_name','text',true,'الوجهة')}${input('وصف الطريق والمحطات','route_description','text',false,'اكتب المناطق التي تمر بها')}${input('ميعاد التحرك','departure_at','datetime-local',true)}${input('المقاعد المتاحة','seats','number',true,'1')}${input('سعر المقعد بالجنيه','seat_price','number',true,'السعر لكل مقعد')}<button class="btn primary full">نشر الرحلة</button><p id="notice" class="notice"></p></form>`)}${vehicles?.length?'':'<p class="notice">لا توجد مركبة معتمدة ونشطة. أكمل بيانات الكابتن وانتظر اعتماد المركبة.</p>'}</main>`);
  const form=document.querySelector('#rideForm');
  if(form)form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),v=n=>String(f.get(n)||'').trim(),b=form.querySelector('button[type=submit]');busyButton(b,true);try{const {data,error}=await db.rpc('create_share_ride',{p_vehicle_id:v('vehicle_id'),p_ride_mode:'scheduled_share',p_origin_name:v('origin_name'),p_origin_lat:Number(v('origin_lat')),p_origin_lng:Number(v('origin_lng')),p_destination_name:v('destination_name'),p_destination_lat:Number(v('destination_lat')),p_destination_lng:Number(v('destination_lng')),p_route_description:v('route_description')||null,p_departure_at:new Date(v('departure_at')).toISOString(),p_seats:Number(v('seats')),p_seat_price:Number(v('seat_price'))});if(error)throw error;notice('تم نشر الرحلة بنجاح.','success');form.reset();}catch(err){notice(err.message||'تعذر نشر الرحلة.','error');}finally{busyButton(b,false);}};
  return;
 }
 shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">مشاركة الطريق</span><h1>رحلات منشورة على السكة</h1><p>احجز مقعدًا في رحلة متاحة.</p></div><div id="rides" class="stack"><section class="panel">جارٍ تحميل الرحلات…</section></div></main>`);
 const box=document.querySelector('#rides');
 const {data,error}=await db.from('rides').select('id,captain_id,vehicle_id,ride_mode,origin_name,destination_name,route_description,departure_at,available_seats,seat_price_egp,ride_status,seat_capacity').eq('ride_status','open').gt('available_seats',0).order('departure_at',{ascending:true}).limit(40);
 if(error){box.innerHTML='<section class="panel">تعذر تحميل الرحلات. '+esc(error.message)+'</section>';return;}
 if(!data?.length){box.innerHTML='<section class="panel empty">لا توجد رحلات متاحة حاليًا. ارجع لاحقًا أو جرّب طلب مشوار عادي.</section>';return;}
 box.innerHTML=data.map(r=>`<section class="panel ride"><div class="ride-top"><span class="pill">متاح · ${r.available_seats} مقعد</span><b>${money(r.seat_price_egp)} <small>/ مقعد</small></b></div><h3>${esc(r.origin_name)} ← ${esc(r.destination_name)}</h3><p>${esc(r.route_description||'مسار يحدده الكابتن')}</p><p class="muted">${date(r.departure_at)}</p><form data-book="${r.id}" class="book-form">${select('عدد المقاعد','seats',Array.from({length:Math.min(6,r.available_seats)},(_,i)=>[String(i+1),String(i+1)]))}<button class="btn primary">طلب حجز</button></form></section>`).join('');
 box.querySelectorAll('[data-book]').forEach(form=>form.onsubmit=async e=>{e.preventDefault();const n=Number(new FormData(form).get('seats'));const b=form.querySelector('button');busyButton(b,true);try{const {data,error}=await db.rpc('request_seats',{p_ride_id:form.dataset.book,p_pickup_name:'نقطة يحددها الراكب',p_dropoff_name:'نقطة يحددها الراكب',p_pickup_order:0,p_dropoff_order:1,p_seats:n,p_offer:null});if(error)throw error;notice('تم إرسال طلب الحجز.','success');}catch(err){notice(err.message||'تعذر الحجز','error');}finally{busyButton(b,false);}});
}
async function tripsPage(){
 shell(`<main class="wrap"><div class="page-head"><h1>رحلاتي</h1><p>طلبات المشاوير والحجوزات المرتبطة بحسابك.</p></div><div id="myTrips" class="stack">جارٍ التحميل…</div></main>`);
 const box=document.querySelector('#myTrips');
 const [requests,bookings]=await Promise.all([
  db.from('trip_requests').select('id,origin_name,destination_name,request_status,fixed_fare_egp,created_at,scheduled_at').eq('passenger_id',session.user.id).order('created_at',{ascending:false}).limit(30),
  db.from('bookings').select('id,ride_id,pickup_name,dropoff_name,booking_status,agreed_price_egp,created_at').eq('passenger_id',session.user.id).order('created_at',{ascending:false}).limit(30)
 ]);
 const rows=(requests.data||[]).map(x=>({title:x.origin_name+' ← '+x.destination_name,status:x.request_status,price:x.fixed_fare_egp,time:x.created_at})).concat((bookings.data||[]).map(x=>({title:x.pickup_name+' ← '+x.dropoff_name,status:x.booking_status,price:x.agreed_price_egp,time:x.created_at})));
 box.innerHTML=rows.length?rows.map(x=>`<section class="panel"><div class="ride-top"><b>${esc(x.title)}</b><span class="pill">${esc(x.status)}</span></div><p>${money(x.price)} · ${date(x.time)}</p></section>`).join(''):'<section class="panel empty">لا توجد رحلات مسجلة حتى الآن.</section>';
}
async function accountPage(){
 if(profile.account_type==='captain'){captainHome();return;}
 shell(`<main class="wrap narrow"><div class="page-head"><h1>حسابي</h1></div>${card('بيانات الحساب',`<p><b>الاسم:</b> ${esc(profile.display_name||'—')}</p><p><b>البريد:</b> ${esc(session.user.email)}</p><p><b>نوع الحساب:</b> ${esc(profile.account_type)}</p><button class="btn outline" data-view="trips">رحلاتي</button>`)}</main>`);
}
async function captainHome(){
 const {data:appRow}=await db.from('captain_applications').select('application_status,admin_notes').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
 const {data:vehicles}=await db.from('vehicles').select('id,vehicle_type,make,model,plate_number,approval_status,is_active').eq('captain_id',session.user.id);
 const {data:requests}=await db.from('trip_requests').select('id,vehicle_type,origin_name,destination_name,scheduled_at,passenger_count,fixed_fare_egp,request_status').eq('request_status','searching').limit(30);
 shell(`<main class="wrap"><div class="page-head"><span class="eyebrow">مساحة الكابتن</span><h1>أهلاً ${esc(profile.display_name||'يا كابتن')}</h1><p>إدارة بياناتك واستقبال الرحلات.</p></div>${card('حالة طلب الانضمام',`<p class="pill">${esc(appRow?.application_status||'لم يتم التقديم')}</p><p>${esc(appRow?.admin_notes||'قدّم بياناتك ومستنداتك لاستكمال التفعيل.')}</p><button class="btn primary" data-view="apply">تقديم / تحديث بيانات الكابتن</button>`)}${card('مركباتي',(vehicles||[]).map(v=>`<p>${esc(v.make)} ${esc(v.model)} · ${esc(v.plate_number)} — ${esc(v.approval_status)}</p>`).join('')||'<p>لا توجد مركبات مسجلة.</p>')}${card('طلبات الرحلات',`<div class="stack">${(requests||[]).map(r=>`<article class="request"><b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b><p>${r.passenger_count} ركاب · ${money(r.fixed_fare_egp)}</p><button class="btn primary" data-accept="${r.id}">قبول الرحلة</button></article>`).join('')||'<p>لا توجد طلبات مفتوحة حاليًا.</p>'}</div>`)}</main>`);
 document.querySelectorAll('[data-accept]').forEach(b=>b.onclick=async()=>{const vehicle=vehicles?.find(v=>v.approval_status==='approved'&&v.is_active);if(!vehicle){alert('لا توجد مركبة معتمدة ونشطة على حسابك.');return;}busyButton(b,true);const {error}=await db.rpc('captain_accept_fixed_trip',{p_request_id:b.dataset.accept,p_vehicle_id:vehicle.id});if(error)alert(error.message);else alert('تم قبول الرحلة.');captainHome();});
}
function applyPage(){
 shell(`<main class="wrap narrow"><div class="page-head"><h1>تقديم بيانات الكابتن والمركبة</h1></div>${card('بيانات التقديم',`<form id="applyForm">${input('آخر 4 أرقام من الرقم القومي','national_id_last4','text',true,'1234')}${input('رقم رخصة القيادة','license_number')}${input('تاريخ انتهاء رخصة القيادة','license_expiry','date')}${input('تاريخ انتهاء البطاقة','national_id_expiry','date')}${input('تاريخ انتهاء رخصة المركبة','vehicle_license_expiry','date')}${select('نوع المركبة','vehicle_type',[['car','ملاكي'],['taxi','تاكسي'],['suzuki','سوزوكي'],['microbus','ميكروباص'],['scooter','اسكوتر'],['motorcycle','دراجة نارية']])}${input('الماركة','make')}${input('الموديل','model')}${input('سنة الصنع','model_year','number')}${input('اللون','color')}${input('رقم اللوحة','plate_number')}${input('عدد الركاب','passenger_capacity','number')}${['has_ac','has_large_trunk','no_smoking','pets_allowed'].map((n,i)=>`<label class="check"><input type="checkbox" name="${n}" ${i===2?'checked':''}> ${['تكييف','شنطة كبيرة','ممنوع التدخين','يسمح بالحيوانات الأليفة'][i]}</label>`).join('')}${input('صورة شخصية (رابط ملف)','profile_photo_path','url',false)}${input('صورة أمامية للمركبة (رابط)','vehicle_front_path','url',false)}${input('صورة جانبية للمركبة (رابط)','vehicle_side_path','url',false)}${input('صورة خلفية للمركبة (رابط)','vehicle_rear_path','url',false)}<button class="btn primary full">إرسال الطلب</button><p id="notice" class="notice"></p></form>`)}<button class="btn outline" data-view="captain">رجوع للوحة الكابتن</button></main>`);
 document.querySelector('#applyForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),v=n=>String(f.get(n)||'').trim(),b=e.currentTarget.querySelector('button[type=submit]');busyButton(b,true);try{const args={p_national_id_last4:v('national_id_last4'),p_national_id_expiry:v('national_id_expiry'),p_license_number:v('license_number'),p_license_expiry:v('license_expiry'),p_vehicle_license_expiry:v('vehicle_license_expiry'),p_national_id_front_path:null,p_national_id_back_path:null,p_driver_license_front_path:null,p_driver_license_back_path:null,p_vehicle_license_front_path:null,p_vehicle_license_back_path:null,p_vehicle_type:v('vehicle_type'),p_make:v('make'),p_model:v('model'),p_model_year:Number(v('model_year')),p_color:v('color'),p_plate_number:v('plate_number'),p_passenger_capacity:Number(v('passenger_capacity')),p_has_ac:f.has('has_ac'),p_has_large_trunk:f.has('has_large_trunk'),p_no_smoking:f.has('no_smoking'),p_pets_allowed:f.has('pets_allowed'),p_profile_photo_path:v('profile_photo_path')||null,p_vehicle_front_path:v('vehicle_front_path')||null,p_vehicle_side_path:v('vehicle_side_path')||null,p_vehicle_rear_path:v('vehicle_rear_path')||null};const {error}=await db.rpc('submit_captain_application_v3',args);if(error)throw error;notice('تم إرسال طلبك بنجاح.','success');setTimeout(()=>{view='captain';render();},700);}catch(err){notice(err.message||'تعذر إرسال الطلب.','error');}finally{busyButton(b,false);}};
}
async function adminHome(){
 const {data:apps,error}=await db.from('captain_applications').select('id,user_id,application_status,national_id_last4,license_number,created_at').order('created_at',{ascending:false}).limit(50);
 shell(`<main class="wrap"><div class="page-head"><h1>لوحة الإدارة</h1><p>مراجعة طلبات انضمام الكباتن.</p></div>${card('طلبات الكباتن',error?esc(error.message):(apps||[]).map(a=>`<article class="request"><b>${esc(a.national_id_last4||'—')} · ${esc(a.license_number||'—')}</b><p>${esc(a.application_status)} · ${date(a.created_at)}</p><button class="btn outline" data-review="${a.id}" data-status="approved">اعتماد</button> <button class="btn danger" data-review="${a.id}" data-status="rejected">رفض</button></article>`).join('')||'<p>لا توجد طلبات.</p>')}</main>`);
 document.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{const {error}=await db.rpc('review_captain_application_v2',{p_application_id:b.dataset.review,p_decision:b.dataset.status,p_admin_notes:null});if(error)alert(error.message);else adminHome();});
}
function render(){if(!session){authPage();return;}if(!profile){loadProfile().then(()=>render());return;}if(profile.account_type==='captain'&&view==='apply'){applyPage();return;}if(profile.account_type==='captain'&&view==='home')view='captain';if(profile.account_type==='admin'&&view==='home')view='admin';switch(view){case'home':home();break;case'trip':tripPage();break;case'share':sharePage();break;case'trips':tripsPage();break;case'account':accountPage();break;case'captain':captainHome();break;case'admin':adminHome();break;case'apply':applyPage();break;default:home();}}
db.auth.getSession().then(({data})=>{session=data.session;render();});
db.auth.onAuthStateChange((_event,next)=>{session=next;profile=null;render();});
