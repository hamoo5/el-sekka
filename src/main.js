import { createClient } from '@supabase/supabase-js';
import './style.css';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = URL && KEY ? createClient(URL, KEY) : null;
const app = document.querySelector('#app');

let session = null;
let profile = null;
const PAGE_STORAGE_KEY = 'el-sekka-current-page';
const VALID_PAGES = new Set(['home','trip','trip-search','trip-options','share','apply-captain','captain','captain-account','admin','trip-status','track','rewards','trips','profile']);
const urlTrackingToken = new URLSearchParams(window.location.search).get('token') || '';
let publicTrackingToken = urlTrackingToken;
try {
  if (urlTrackingToken) sessionStorage.setItem('el-sekka-public-track-token',urlTrackingToken);
  else publicTrackingToken = sessionStorage.getItem('el-sekka-public-track-token') || '';
} catch (_) {}
if (urlTrackingToken && window.location.pathname === '/track') {
  window.history.replaceState({},'', '/track');
}
let currentTripId = null;
let activeChatChannels = [];
let activeTripChannels = [];
let passengerBookingChannel = null;
let publicTrackingTimer = null;
let publicTrackingMap = null;
let publicTrackingMarker = null;
let captainLocationWatchId = null;
let preserveCaptainSubscriptionPanel = true;
let appThemeTimer = null;
let selectedAuthRole = (()=>{try{return sessionStorage.getItem('el-sekka-auth-role')||'';}catch(_){return '';}})();
let page = (() => {
  try {
    const saved = sessionStorage.getItem(PAGE_STORAGE_KEY);
    if (window.location.pathname === '/track' && publicTrackingToken) return 'track';
    return VALID_PAGES.has(saved) && saved !== 'track' ? saved : 'home';
  } catch (_) {
    return 'home';
  }
})();

const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const passengerStoreKey = suffix => `el-sekka:${session?.user?.id || 'guest'}:${suffix}`;
function readPassengerStore(suffix, fallback = null) {
  try { const raw = localStorage.getItem(passengerStoreKey(suffix)); return raw ? JSON.parse(raw) : fallback; }
  catch (_) { return fallback; }
}
function writePassengerStore(suffix, value) {
  try { localStorage.setItem(passengerStoreKey(suffix), JSON.stringify(value)); return true; }
  catch (_) { return false; }
}
function savedPassengerPlaces() {
  const value = readPassengerStore('places', {});
  return value && typeof value === 'object' ? value : {};
}
function savedPassengerDestinations() {
  const value = readPassengerStore('destinations', {});
  return value && typeof value === 'object' ? value : {};
}

const APP_THEME_KEY='el-sekka-theme-mode';
function applyAppTheme(){let mode='auto';try{mode=localStorage.getItem(APP_THEME_KEY)||'auto';}catch(_){}const day=mode==='day'||(mode==='auto'&&new Date().getHours()>=6&&new Date().getHours()<18);document.documentElement.classList.toggle('trip-day',day);document.documentElement.classList.toggle('trip-night',!day);document.body.classList.toggle('trip-day',day);document.body.classList.toggle('trip-night',!day);}
window.setInterval(applyAppTheme,60_000);
function layout(body) {
  applyAppTheme();
  document.body.dataset.page=page;
  const captain=profile?.account_type==='captain'||profile?.role==='captain';
  const rider=profile?.account_type==='rider'||profile?.role==='passenger';
  app.innerHTML = `
    <header class="topbar">
      <div class="logo">س</div><div class="brand"><b>السكة</b><small>مشوارك.. على طريقك</small></div><div class="grow"></div>
      ${session ? '<button class="btn ghost" id="logout">خروج</button>' : ''}
    </header>
    ${body}
    ${session && profile && page !== 'track' ? captain ? `<nav class="app-bottom-nav captain-nav" aria-label="تنقل الكابتن">
      <button type="button" data-nav-page="share" class="${page==='share'?'active':''}"><span>🛣️</span><small>خطوطي ومقاعدي</small></button>
      <button type="button" data-nav-page="captain-account" class="${page==='captain-account'?'active':''}"><span>💳</span><small>اشتراكي ومستنداتي</small></button>
      <button type="button" data-nav-page="profile" class="${page==='profile'?'active':''}"><span>👤</span><small>حسابي</small></button>
    </nav>` : rider ? `<nav class="app-bottom-nav rider-nav" aria-label="تنقل الراكب">
      <button type="button" data-nav-page="trip" class="${['trip','trip-search','trip-options'].includes(page)?'active':''}"><span>🚖</span><small>اطلب مشوار</small></button>
      <button type="button" data-nav-page="trips" class="${page==='trips'||page==='trip-status'?'active':''}"><span>📋</span><small>مشاويري</small></button>
      <button type="button" data-nav-page="profile" class="${page==='profile'||page==='rewards'?'active':''}"><span>👤</span><small>حسابي</small></button>
    </nav>` : `<nav class="app-bottom-nav"><button type="button" data-nav-page="admin" class="${page==='admin'?'active':''}"><span>⚙️</span><small>الإدارة</small></button><button type="button" data-nav-page="profile"><span>👤</span><small>حسابي</small></button></nav>` : ''}
    <footer>السكة © 2026 · منصة تنقل ومشاركة طريق${!session && !selectedAuthRole ? '<a class="admin-entry-link" id="adminEntry" href="#">دخول الإدارة</a>' : ''}</footer>`;
  document.querySelectorAll('[data-nav-page]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const target=button.dataset.navPage;if(!target)return;page=target;try{sessionStorage.setItem(PAGE_STORAGE_KEY,page);}catch(_){}render();}));
  document.querySelector('#adminEntry')?.addEventListener('click',event=>{event.preventDefault();selectedAuthRole='admin';try{sessionStorage.setItem('el-sekka-auth-role','admin');}catch(_){}render();});
  document.querySelector('#logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();session=null;profile=null;page='home';selectedAuthRole='';
    try{sessionStorage.removeItem(PAGE_STORAGE_KEY);sessionStorage.removeItem('el-sekka-auth-role');}catch(_){}
    render();
  });
}

function setup() {
  layout(`
    <main class="wrap narrow">
      <section class="hero">
        <span class="tag">EL SEKKA · V2</span>
        <h1>كل الطرق <em>تبدأ من هنا</em></h1>
        <p>احجز مشواراً عادياً فورياً أو مجدولاً بسعر ثابت، أو شارك كرسياً بالسعر والتفاوض بين الطرفين.</p>
      </section>
      <section class="panel">
        <h2>الاتصال بقاعدة البيانات غير مضبوط</h2>
        <p class="muted">أضف متغيري VITE_SUPABASE_URL وVITE_SUPABASE_ANON_KEY في إعدادات النشر.</p>
        <div class="notice">استخدم المفتاح Publishable فقط. لا تضع service_role أو أي Secret Key في الموقع.</div>
      </section>
    </main>`);
}

function auth() {
  if(!selectedAuthRole){
    layout(`<main class="wrap narrow role-choice-screen">
      <section class="hero compact"><span class="tag">أهلاً بك في السكة</span><h1>اختار نوع حسابك</h1><p>اختيارك ثابت لهذا الحساب، وكل نوع له تطبيقه ومساحته الخاصة.</p></section>
      <section class="role-choice-grid">
        <button type="button" class="role-choice-card rider-choice" data-select-role="rider"><span>👤</span><b>دخول / تسجيل كـ راكب</b><small>اطلب مشوارك وتابع رحلاتك بسهولة.</small></button>
        <button type="button" class="role-choice-card captain-choice" data-select-role="captain"><span>🚗</span><b>دخول / تسجيل كـ كابتن</b><small>استقبل الطلبات وأدر مركبتك واشتراكك.</small></button>
      </section>
    </main>`);
    document.querySelectorAll('[data-select-role]').forEach(btn=>btn.addEventListener('click',()=>{
      selectedAuthRole=btn.dataset.selectRole;
      try{sessionStorage.setItem('el-sekka-auth-role',selectedAuthRole);}catch(_){}
      render();
    }));
    return;
  }
  const adminLogin=selectedAuthRole==='admin';
  const roleLabel=adminLogin?'الإدارة':selectedAuthRole==='captain'?'كابتن':'راكب';
  layout(`<main class="wrap narrow">
    <button type="button" class="back" id="changeAuthRole">← ${adminLogin?'العودة لاختيار الحساب':'تغيير نوع الحساب'}</button>
    <section class="hero compact"><span class="tag">السكة · حساب ${roleLabel}</span><h1>${adminLogin?'دخول الإدارة':selectedAuthRole==='captain'?'مساحة الكابتن':'مساحة الراكب'}</h1><p>${adminLogin?'سجّل الدخول بالبريد الإلكتروني المصرح له بالإدارة.':'سجّل الدخول أو أنشئ حساباً مستقلاً لهذا الدور.'}</p></section>
    <form class="panel form" id="authForm">
      <label>البريد الإلكتروني<input name="email" type="email" required autocomplete="email" placeholder="name@example.com"></label>
      <label id="referralCodeField" hidden>كود دعوة (اختياري)<input name="referral_code" maxlength="10" value="${esc(new URLSearchParams(window.location.search).get('ref') || '')}" placeholder="SEKKA-XXXX" autocomplete="off"></label>
      <label>كلمة المرور<input name="password" type="password" minlength="6" required autocomplete="current-password" placeholder="••••••••"></label>
      <button class="btn primary" type="submit" id="authSubmit">تسجيل الدخول</button>
      <button class="btn outline" type="button" id="authModeToggle" ${adminLogin?'hidden':''}>إنشاء حساب جديد</button>
      <p id="msg" class="message" role="status" aria-live="polite"></p>
    </form>
  </main>`);
  let signupMode=false;
  const form=document.querySelector('#authForm'),referralField=document.querySelector('#referralCodeField');
  const submitButton=document.querySelector('#authSubmit'),modeToggle=document.querySelector('#authModeToggle');
  document.getElementById('changeAuthRole')?.addEventListener('click',()=>{
    selectedAuthRole='';try{sessionStorage.removeItem('el-sekka-auth-role');}catch(_){}render();
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();const d=new FormData(form);
    await authAction(signupMode?'signup':'signin',d.get('email'),d.get('password'),signupMode?d.get('referral_code'):'');
  });
  if(!adminLogin)modeToggle.addEventListener('click',()=>{
    signupMode=!signupMode;referralField.hidden=!signupMode;
    submitButton.textContent=signupMode?'إنشاء الحساب':'تسجيل الدخول';
    modeToggle.textContent=signupMode?'لديك حساب؟ تسجيل الدخول':'إنشاء حساب جديد';
    form.querySelector('[name="password"]').autocomplete=signupMode?'new-password':'current-password';
    document.querySelector('#msg').textContent='';
  });
}

async function authAction(mode,email,password,referralCode='') {
  const msg=document.querySelector('#msg'),cleanEmail=String(email||'').trim().toLowerCase();
  if(!cleanEmail||!password){msg.textContent='أدخل البريد الإلكتروني وكلمة المرور.';return;}
  if(selectedAuthRole==='admin'&&mode!=='signin'){msg.textContent='دخول الإدارة متاح للحسابات المعتمدة فقط.';return;}
  if(selectedAuthRole!=='admin'){
  msg.textContent='جارٍ التحقق من نوع الحساب...';
  const {data:mismatch,error:roleCheckError}=await supabase.rpc('check_signup_email_role',{p_email:cleanEmail,p_expected_role:selectedAuthRole});
  if(roleCheckError){msg.textContent='تعذر التحقق من نوع الحساب حالياً. حاول مرة أخرى.';return;}
  if(mismatch){
    msg.textContent=selectedAuthRole==='rider'
      ?'هذا البريد الإلكتروني مسجل كحساب كابتن ولا يمكن استخدامه كراكب، يرجى التسجيل ببريد إلكتروني منفصل.'
      :'هذا البريد الإلكتروني مسجل كحساب راكب ولا يمكن استخدامه ككابتن، يرجى التسجيل ببريد إلكتروني منفصل.';
    return;
  }
  }
  msg.textContent='جارٍ التنفيذ...';
  const result=mode==='signup'
    ?await supabase.auth.signUp({email:cleanEmail,password,options:{data:{account_role:selectedAuthRole,referral_code:String(referralCode||'').trim().toUpperCase()||null}}})
    :await supabase.auth.signInWithPassword({email:cleanEmail,password});
  if(result.error){msg.textContent=result.error.message.includes('already registered')?'هذا البريد الإلكتروني مستخدم بالفعل. سجّل الدخول أو استخدم بريداً آخر.':result.error.message;return;}
  if(mode==='signup'&&!result.data.session){msg.textContent='تم إنشاء حساب '+(selectedAuthRole==='captain'?'الكابتن':'الراكب')+'. راجع بريدك لتأكيد التسجيل، ثم ارجع لنفس نوع الحساب لتسجيل الدخول.';return;}
  session=result.data.session;
  await loadProfile();
}

function stopPassengerBookingUpdates(){
  if(passengerBookingChannel){try{supabase?.removeChannel(passengerBookingChannel);}catch(_){}passengerBookingChannel=null;}
}
function showBookingCancellationNotice(){
  let toast=document.getElementById('sekkaBookingNotice');
  if(!toast){
    toast=document.createElement('div');
    toast.id='sekkaBookingNotice';
    toast.setAttribute('role','status');
    toast.setAttribute('aria-live','polite');
    toast.style.cssText='position:fixed;z-index:10000;top:calc(env(safe-area-inset-top,0px) + 14px);left:16px;right:16px;max-width:520px;margin:0 auto;padding:14px 16px;border-radius:14px;background:#183b31;color:#fff;box-shadow:0 8px 28px #0003;font-size:14px;line-height:1.6;text-align:right;direction:rtl';
    document.body.appendChild(toast);
  }
  toast.textContent='تنبيه من السكة: تم إلغاء أحد حجوزات مشاركة الطريق المرتبطة بحسابك. افتح «مشاركة الطريق» لمراجعة التفاصيل.';
  clearTimeout(window.__sekkaBookingNoticeTimer);
  window.__sekkaBookingNoticeTimer=window.setTimeout(()=>toast?.remove(),7000);
  if(document.visibilityState==='hidden'&&'Notification' in window&&Notification.permission==='granted'){
    try{new Notification('السكة: تم إلغاء حجزك',{body:'تم إلغاء أحد حجوزات مشاركة الطريق المرتبطة بحسابك. افتح التطبيق لمراجعة التفاصيل.',tag:'sekka-booking-cancelled'});}catch(_){}
  }
}
function startPassengerBookingUpdates(){
  stopPassengerBookingUpdates();
  if(!supabase||!profile||profile.account_type!=='rider'||!profile.id)return;
  passengerBookingChannel=supabase.channel('sekka-booking-updates-'+profile.id)
    .on('postgres_changes',{
      event:'UPDATE',schema:'public',table:'bookings',filter:'passenger_id=eq.'+profile.id
    },payload=>{
      if(payload.new?.booking_status!=='cancelled')return;
      showBookingCancellationNotice();
      if(typeof window.__sekkaReloadShareBookings==='function')window.__sekkaReloadShareBookings();
    })
    .subscribe((status,error)=>{
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Passenger booking realtime unavailable:',error?.message||status);
    });
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles')
    .select('id,display_name,role,account_type,is_blocked,is_vip,referral_code,points,captain_reward_days_balance,captain_referral_progress,referred_by,referral_discount_trips_used,referral_discount_trips_reserved,discounted_trips_count')
    .eq('id', session.user.id).maybeSingle();
  if (error) console.error(error);
  profile = data;
  if(!profile){stopPassengerBookingUpdates();await supabase.auth.signOut();session=null;render();return;}
  const actualRole=profile.account_type||(profile.role==='captain'?'captain':profile.role==='admin'?'admin':'rider');
  if(selectedAuthRole&&actualRole!=='admin'&&actualRole!==selectedAuthRole){stopPassengerBookingUpdates();await supabase.auth.signOut();session=null;profile=null;document.getElementById('msg')?.replaceChildren(document.createTextNode(selectedAuthRole==='admin'?'هذا الحساب لا يملك صلاحية دخول الإدارة.':'هذا البريد الإلكتروني مسجل كحساب '+(selectedAuthRole==='rider'?'كابتن ولا يمكن استخدامه كراكب، يرجى التسجيل ببريد إلكتروني منفصل.':'راكب ولا يمكن استخدامه ككابتن، يرجى التسجيل ببريد إلكتروني منفصل.')));return;}
  profile.account_type=actualRole;
  startPassengerBookingUpdates();
  page=actualRole==='captain'?'captain':actualRole==='admin'?'admin':'trip';
  if (profile?.role === 'captain') {
    const {error: statusError} = await supabase.rpc('process_my_captain_document_status');
    if (statusError) console.warn('Captain status refresh failed:',statusError.message);
  }
  render();
}

async function home() {
  if (!profile) {
    layout('<main class="wrap"><section class="panel">جاري تحميل الحساب...</section></main>');
    return;
  }
  if (profile.is_blocked) {
    layout('<main class="wrap narrow"><section class="panel"><h2>الحساب موقوف</h2><p>يرجى مراجعة الإدارة.</p></section></main>');
    return;
  }
  const role = profile.role === 'admin' ? 'الإدارة' : profile.role === 'captain' ? 'الكابتن' : 'الراكب';
  let activePassengerTrip=null;
  if(profile.role==='passenger'){
    const {data}=await supabase.from('trip_requests')
      .select('id,origin_name,destination_name,request_status,fixed_fare_egp,created_at')
      .eq('passenger_id',profile.id).in('request_status',['searching','accepted','in_progress'])
      .order('created_at',{ascending:false}).limit(1).maybeSingle();
    activePassengerTrip=data;
  }
  layout(`
    <main class="wrap">
      <section class="welcome">
        <div><span class="tag">مساحة الراكب</span><h1>أهلاً ${esc(profile.display_name || 'بك')} 👋</h1><p>اختار مشوارك أو شارك طريقك بسهولة وأمان.</p></div>
        <div class="avatar">${esc((profile.display_name || 'س').slice(0,1))}</div>
      </section>
      <section class="cards">
        <button class="service" data-page="rewards"><span>🎁</span><b>الدعوات والمكافآت</b><small>كودك ونقاطك وأيام الاشتراك المجانية</small><strong>افتح المكافآت ←</strong></button>
        <button class="service" data-page="trip"><span>🚕</span><b>مشوار عادي</b><small>السعر يحسبه النظام تلقائياً</small><strong>اطلب مشوار ←</strong></button>
        <button class="service" data-page="share"><span>🛣️</span><b>مشاركة السكة</b><small>احجز كرسي أو انشر طريقك</small><strong>اكتشف الرحلات ←</strong></button>
      </section>
      ${activePassengerTrip?'<section class="panel active-trip-home"><h3>رحلتك الحالية</h3><p>'+esc(activePassengerTrip.origin_name)+' ← '+esc(activePassengerTrip.destination_name)+'</p><p class="muted">'+(activePassengerTrip.request_status==='searching'?'جارٍ البحث عن كابتن':activePassengerTrip.request_status==='accepted'?'تم قبول الرحلة': 'الرحلة جارية')+'</p><button type="button" class="btn primary" id="openActivePassengerTrip">متابعة الرحلة</button></section>':''}
      <section class="panel passenger-shortcuts">
        <div class="section-head"><div><h3>مشاويرك السريعة</h3><p class="muted">أماكنك المحفوظة وآخر مشوار في متناول إيدك.</p></div></div>
        <div id="homeSavedPlaces" class="saved-place-list"></div>
        <div id="repeatLastTrip"></div>
      </section>
      <section class="panel"><h3>اختار طريقك</h3><p class="muted">في المشوار العادي السعر يحدده النظام. وفي مشاركة الكرسي السعر بالتفاوض وموافقة الطرفين.</p></section>
    </main>`);
  const saved = savedPassengerDestinations();
  const placesBox = document.getElementById('homeSavedPlaces');
  const placeLabels = {home:'البيت',work:'الشغل',metro:'أقرب مترو'};
  const placeEntries = Object.entries(saved).filter(([key,p]) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  placesBox.innerHTML = placeEntries.length
    ? placeEntries.map(([key,p]) => `<button class="saved-place-chip" type="button" data-quick-place="${esc(key)}"><span>${key==='home'?'⌂':key==='work'?'▣':'🚇'}</span><b>${esc(placeLabels[key] || p.label || 'مكان محفوظ')}</b><small>${esc(p.name || '')}</small></button>`).join('')
    : '<p class="muted">احفظ البيت والشغل وأقرب مترو كوجهات لتطلب مشاويرك أسرع.</p>';
  placesBox.querySelectorAll('[data-quick-place]').forEach(button => button.addEventListener('click', () => {
    sessionStorage.setItem('el-sekka-pending-trip', JSON.stringify({destination:saved[button.dataset.quickPlace]}));
    page='trip'; render();
  }));
  const lastTrip = readPassengerStore('last-trip');
  const repeatBox = document.getElementById('repeatLastTrip');
  if (lastTrip?.origin && lastTrip?.destination) {
    repeatBox.innerHTML = `<button class="repeat-trip-card" type="button" id="repeatLastTripButton"><span>↻</span><b>كرر آخر مشوار</b><small>${esc(lastTrip.origin.name)} ← ${esc(lastTrip.destination.name)}</small></button>`;
    document.getElementById('repeatLastTripButton').addEventListener('click', () => {
      sessionStorage.setItem('el-sekka-pending-trip', JSON.stringify(lastTrip));
      page='trip'; render();
    });
  }
  document.getElementById('openActivePassengerTrip')?.addEventListener('click',()=>{currentTripId=activePassengerTrip.id;page='trip-status';render();});
  app.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { page = b.dataset.page; render(); }));
}

let nominatimLastRequestAt = 0;
let nominatimQueue = Promise.resolve();
async function waitForNominatimSlot() {
  const next = nominatimQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - nominatimLastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    nominatimLastRequestAt = Date.now();
  });
  nominatimQueue = next.catch(() => {});
  await next;
}

async function searchPlaces(query) {
  try {
    await waitForNominatimSlot();
    const url = new globalThis.URL('https://nominatim.openstreetmap.org/search');
    const params={ q: query, format: 'jsonv2', limit: '5', countrycodes: 'eg', 'accept-language': 'ar', addressdetails: '1' };
    const selectedPickup=readRiderDraft()?.origin;
    const center=selectedPickup&&Number.isFinite(Number(selectedPickup.lat))&&Number.isFinite(Number(selectedPickup.lng))?selectedPickup:null;
    if(center){
      const lat=Number(center.lat),lng=Number(center.lng),deltaLat=0.18,deltaLng=0.2;
      params.viewbox=[lng-deltaLng,lat+deltaLat,lng+deltaLng,lat-deltaLat].join(',');
    }
    url.search = new URLSearchParams(params);
    const response = await fetch(url, { headers: { 'Accept-Language': 'ar' } });
    if (!response.ok) throw new Error(`خدمة البحث غير متاحة الآن (HTTP ${response.status}).`);
    const rows = await response.json();
    return rows.map(row => ({ name: row.display_name, lat: Number(row.lat), lng: Number(row.lon) }));
  } catch (error) {
    console.warn('Nominatim address search failed:',error);
    throw new Error(error?.name === 'TypeError' ? 'تعذر الاتصال بخدمة العناوين. تحقق من الإنترنت وحاول مرة أخرى.' : (error.message || 'تعذر البحث عن العناوين حالياً.'));
  }
}

async function reversePlace(lat, lng) {
  try {
    await waitForNominatimSlot();
    const url = new globalThis.URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({lat:String(lat),lon:String(lng),format:'jsonv2',addressdetails:'1'});
    const response = await fetch(url, { headers: { 'Accept-Language': 'ar' } });
    if (response.ok) {
      const data = await response.json();
      if (data.display_name) return data.display_name;
    }
  } catch (_) {}
  return 'نقطة محددة على الخريطة';
}

const RIDER_DRAFT_KEY='el-sekka-rider-trip-draft';
function readRiderDraft(){try{return JSON.parse(sessionStorage.getItem(RIDER_DRAFT_KEY)||'{}')||{};}catch(_){return {};}}
function saveRiderDraft(value){try{sessionStorage.setItem(RIDER_DRAFT_KEY,JSON.stringify(value));}catch(_){}}
function riderStartPage(){
 const draft=readRiderDraft(),places=savedPassengerDestinations(),icons={home:'🏠',work:'💼',metro:'🚇'},labels={home:'البيت',work:'الشغل',metro:'المترو'};
 layout(`<main class="rider-start-screen"><section class="rider-search-hero"><div class="sekka-hero-top"><span class="sekka-live"><i></i> طريقك يبدأ من هنا</span><span class="sekka-wordmark">السكة <b>↗</b></span></div><div class="sekka-hero-copy"><small>أقرب .. أسهل .. أوفر</small><h1>القاهرة على<br><em>طريقك</em></h1><p>اختار وجهتك، وإحنا نوصلك بالطريقة اللي تناسبك.</p></div><div class="sekka-city-art" aria-hidden="true"><span class="city-sun"></span><span class="city-tower tower-a"></span><span class="city-tower tower-b"></span><span class="city-tower tower-c"></span><span class="city-road"></span><span class="city-car">🚘</span><span class="city-pin">●</span></div><button type="button" class="rider-search-box" id="openRiderSearch"><span>🔎</span><b>إلى أين تتجه؟</b><small>اضغط لاختيار مكان الركوب والوجهة</small></button><button type="button" class="rider-mode-mini" id="riderModeMini">${draft.mode==='shared'?'👥 مشترك':'🚖 عادي'} <span>⌄</span></button><div class="rider-mode-menu" id="riderModeMenu" hidden><button type="button" data-mode="normal">🚖 مشوار عادي</button><button type="button" data-mode="shared">👥 مشوار مشترك</button></div></section><section class="sekka-mode-section"><div class="sekka-section-head"><div><small>اختار أسلوب مشوارك</small><h2>تتحرك إزاي النهارده؟</h2></div><span>01 / 02</span></div><div class="sekka-mode-cards"><button type="button" data-mode="normal" class="sekka-mode-card"><span class="sekka-mode-icon">↗</span><span><b>مشوار عادي</b><small>خصوصية وسعر واضح من البداية</small></span><i>←</i></button><button type="button" data-mode="shared" class="sekka-mode-card"><span class="sekka-mode-icon shared">⇄</span><span><b>مشاركة الطريق</b><small>كرسي فاضي؟ وفّر في تكلفة رحلتك</small></span><i>←</i></button></div></section><section class="rider-saved-section"><div class="sekka-section-head"><div><small>اختصاراتك اليومية</small><h2>أماكنك المحفوظة</h2></div><span>⌖</span></div><div class="rider-saved-places">${['home','work','metro'].map(k=>`<button type="button" data-saved-place="${k}" class="rider-saved-place ${places[k]?'saved':'empty'}"><span>${icons[k]}</span><b>${labels[k]}</b><small>${places[k]?.name?esc(places[k].name):'إضافة مكان'}</small></button>`).join('')}</div></section><section class="sekka-value-strip"><div><small>ميزة السكة</small><b>المشوار مش لازم يكون لوحدك</b><span>شارك الطريق مع حد رايح في نفس اتجاهك ووفروا سوا.</span></div><strong>⇄</strong></section>${draft.destination?.name?`<section class="rider-recent-place"><small>آخر وجهة اخترتها</small><b>${esc(draft.destination.name)}</b><button type="button" id="continueLastTrip">متابعة الاختيار ←</button></section>`:''}</main>`);
 document.getElementById('openRiderSearch')?.addEventListener('click',()=>{page='trip-search';render();});
 document.getElementById('riderModeMini')?.addEventListener('click',()=>{document.getElementById('riderModeMenu').hidden=!document.getElementById('riderModeMenu').hidden;});
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{const d=readRiderDraft();d.mode=b.dataset.mode;saveRiderDraft(d);render();}));
 document.querySelectorAll('[data-saved-place]').forEach(b=>b.addEventListener('click',()=>{const place=places[b.dataset.savedPlace];if(!place){page='trip-search';render();return;}const d=readRiderDraft();d.destination=place;d.mode=d.mode||'normal';saveRiderDraft(d);page=readRiderDraft().mode==='shared'?'share':'trip-options';render();}));
 document.getElementById('continueLastTrip')?.addEventListener('click',()=>{page='trip-options';render();});
}
function riderSearchPage(){
 const draft=readRiderDraft(),places=savedPassengerDestinations();
 layout(`<main class="rider-search-screen"><header class="rider-search-header"><button type="button" id="searchBack" aria-label="رجوع">←</button><h1>حدد مشوارك</h1></header><section class="rider-search-fields"><label class="rider-pickup-field"><span class="pickup-dot"></span>مكان الركوب<div class="rider-pickup-input-row"><input id="searchOrigin" autocomplete="off" placeholder="حدد مكان الركوب" value="${esc(draft.origin?.name||'')}" /><button type="button" id="searchUseLocation" class="rider-use-location" aria-label="استخدام موقعي الحالي">📍 موقعي</button></div><div class="rider-search-suggestions" id="searchOriginSuggestions"></div></label><label><span class="destination-dot"></span>الوجهة<input id="searchDestination" autocomplete="off" placeholder="إلى أين تتجه؟" value="${esc(draft.destination?.name||'')}" /><div class="rider-search-suggestions" id="searchDestinationSuggestions"></div></label></section><div class="rider-save-current" id="riderSaveCurrent" hidden><small>احفظ الوجهة دي للوصول السريع</small><button type="button" data-save-current="home">🏠 البيت</button><button type="button" data-save-current="work">💼 الشغل</button><button type="button" data-save-current="metro">🚇 المترو</button></div><section class="rider-search-saved"><h2>أماكن محفوظة</h2><div>${['home','work','metro'].map(k=>`<button type="button" data-search-place="${k}">${({home:'🏠 البيت',work:'💼 الشغل',metro:'🚇 المترو'})[k]}</button>`).join('')}</div></section><p id="riderSearchMessage" class="message" aria-live="polite"></p></main>`);
 const originInput=document.getElementById('searchOrigin'),destInput=document.getElementById('searchDestination');
 const setDraftPoint=(key,p)=>{const d=readRiderDraft();d[key]=p;saveRiderDraft(d);};
 const bind=(key,input,box)=>{let timer=null,seq=0;input.addEventListener('input',()=>{const d=readRiderDraft();delete d[key];saveRiderDraft(d);const q=input.value.trim(),n=++seq;clearTimeout(timer);if(q.length<3){box.hidden=true;box.innerHTML='';return;}box.hidden=false;box.innerHTML='<div class="suggestion-loading">جارٍ البحث عن العناوين...</div>';timer=setTimeout(async()=>{try{const rows=await searchPlaces(q);if(n!==seq)return;box.innerHTML=rows.map((p,i)=>`<button type="button" data-result="${i}">${esc(p.name)}</button>`).join('')||'<p>لا توجد نتائج مناسبة.</p>';box.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',()=>{const p=rows[Number(b.dataset.result)];setDraftPoint(key,p);input.value=p.name;box.hidden=true;if(key==='destination'){document.getElementById('riderSaveCurrent').hidden=false;const d=readRiderDraft();if(!d.origin){document.getElementById('riderSearchMessage').textContent='حدد مكان الركوب أولاً.';return;}page=d.mode==='shared'?'share':'trip-options';render();}}));}catch(e){box.innerHTML='<p>تعذر البحث الآن، حاول مرة أخرى.</p>';}} ,650);});};
 bind('origin',originInput,document.getElementById('searchOriginSuggestions'));bind('destination',destInput,document.getElementById('searchDestinationSuggestions'));
 document.getElementById('searchBack').addEventListener('click',()=>{page='trip';render();});
 document.querySelectorAll('[data-save-current]').forEach(b=>b.addEventListener('click',()=>{const d=readRiderDraft(),p=d.destination;if(!p){return;}const all=savedPassengerDestinations();all[b.dataset.saveCurrent]={...p,label:({home:'البيت',work:'الشغل',metro:'المترو'})[b.dataset.saveCurrent]};if(writePassengerStore('destinations',all)){document.getElementById('riderSearchMessage').textContent='تم حفظ المكان على جهازك.';}else{document.getElementById('riderSearchMessage').textContent='تعذر حفظ المكان.';}}));
 document.getElementById('searchUseLocation').addEventListener('click',()=>{if(!navigator.geolocation)return;const m=document.getElementById('riderSearchMessage');m.textContent='جارٍ تحديد موقعك...';navigator.geolocation.getCurrentPosition(async pos=>{const name=await reversePlace(pos.coords.latitude,pos.coords.longitude);const p={lat:pos.coords.latitude,lng:pos.coords.longitude,name};setDraftPoint('origin',p);originInput.value=name;m.textContent='تم تحديد مكان الركوب.';},()=>m.textContent='تعذر تحديد الموقع. اكتب العنوان يدويًا.');});
 document.querySelectorAll('[data-search-place]').forEach(b=>b.addEventListener('click',()=>{const p=places[b.dataset.searchPlace];if(!p){document.getElementById('riderSearchMessage').textContent='المكان غير محفوظ بعد.';return;}setDraftPoint('destination',p);destInput.value=p.name;page=readRiderDraft().mode==='shared'?'share':'trip-options';render();}));
}

function tripForm() {
  const types = [['private_car','🚘','ملاكي','حتى 3 ركاب'],['taxi','🚕','تاكسي','حتى 4 ركاب'],['suzuki','🚐','سوزوكي','حتى 6 ركاب'],['microbus','🚌','ميكروباص','حتى 13 راكب'],['scooter','🛵','اسكوتر','راكب واحد'],['motorcycle','🏍️','دراجة نارية','راكب واحد']];
  layout(`
    <main class="passenger-map-first"><section class="passenger-map-stage"><div id="tripMap" class="trip-map" role="application" aria-label="خريطة تحديد مكان الركوب والوجهة"></div><div class="map-floating-status" id="mapHint">حدد مكان الركوب والوجهة لعرض المسار</div><button type="button" class="map-locate-button" id="useLocation" aria-label="تحديد موقعي الحالي">◎</button></section>
      <form class="panel form trip-panel passenger-bottom-sheet" id="tripForm"><div class="bottom-sheet-handle"></div><div class="trip-options-scroll"><div class="trip-options-heading"><b>اختار المركبة المناسبة</b><small id="selectedRouteNames"></small></div>
        <button type="button" class="trip-step-back" id="tripOptionsBack">← تعديل العناوين</button>
        <section class="location-card" hidden>
          <label>مكان الركوب<input id="originName" autocomplete="off"><div class="suggestions" id="originSuggestions" role="listbox"></div><div class="pickup-marker-row"><button type="button" data-pickup-note="قدام البوابة">قدام البوابة</button><button type="button" data-pickup-note="عند الصيدلية">عند الصيدلية</button><button type="button" data-pickup-note="على الناصية">على الناصية</button></div><input id="pickupNote" maxlength="160" autocomplete="off"></label>
          <label>الوجهة<input id="destinationName" autocomplete="off"><div class="suggestions" id="destinationSuggestions" role="listbox"></div><div id="destinationQuickPlaceRow"></div><div class="save-place-actions destination-save-actions" hidden><button type="button" data-save-destination="home">البيت</button><button type="button" data-save-destination="work">الشغل</button><button type="button" data-save-destination="metro">المترو</button></div></label>
        </section>
        <div class="map-legend passenger-map-legend"><span>🟢 الركوب</span><span>🔴 الوجهة</span></div>
        <fieldset class="vehicle-field">
          <legend>اختار نوع المركبة</legend>
          <div class="vehicle-grid">
            ${types.map(([value,icon,name,desc]) => `
              <button class="vehicle-card" type="button" data-vehicle="${value}">
                <span class="vehicle-icon">${icon}</span><span class="vehicle-meta"><b>${name}</b><small class="vehicle-capacity">${desc}</small></span><small class="vehicle-price" data-vehicle-price="${value}">السعر —</small>
              </button>`).join('')}
          </div>
          <input type="hidden" name="vehicle_type" id="vehicleType" value="private_car">
        </fieldset>
        <details class="trip-extra-options"><summary>تفاصيل إضافية للرحلة</summary>
        <fieldset class="passenger-count-field" id="passengerCountField">
          <legend>عدد الركاب</legend>
          <div class="passenger-count-options">
            <button type="button" data-passengers="1">1</button>
            <button type="button" data-passengers="2">2</button>
            <button type="button" data-passengers="3">3</button>
            <button type="button" data-passengers="4">4+</button>
          </div>
          <div class="passenger-count-stepper" id="passengerCountStepper" hidden>
            <button type="button" id="passengerCountMinus" aria-label="تقليل عدد الركاب">−</button>
            <b id="passengerCountValue">4</b>
            <button type="button" id="passengerCountPlus" aria-label="زيادة عدد الركاب">+</button>
            <small>يمكنك تحديد العدد حتى سعة المركبة</small>
          </div>
          <input type="hidden" name="passenger_count" id="passengerCount" value="1">
        </fieldset>
        <fieldset class="ride-preferences">
          <legend>تفضيلات الرحلة</legend>
          <div class="ride-preference-options">
            <button type="button" data-preference="quiet" aria-pressed="false">🤫 رحلة هادية</button>
            <button type="button" data-preference="ac" aria-pressed="false">❄️ تكييف</button>
            <button type="button" data-preference="luggage" aria-pressed="false">🧳 شنط</button>
          </div>
        </fieldset>
        <label class="schedule-toggle"><input type="checkbox" id="scheduleToggle"> حجز المشوار في موعد لاحق</label>
        <label id="scheduleField" hidden>موعد المشوار
          <input type="datetime-local" id="scheduledAt">
        </label>
        <section class="points-use-panel"><label><input type="checkbox" id="usePoints" ${Number(profile.points||0)>=100?'':'disabled'}> اسمح باستخدام 100 نقطة إذا لم يتوفر خصم الدعوة <small>رصيدك الحالي: ${Number(profile.points||0)} نقطة · الخصم لا يجتمع مع خصم الدعوة، والنظام يختار الأفضل تلقائيًا.</small></label></section><div class="notice">إذا كان حسابك مدعوًا، يُطبّق خصم الدعوة تلقائيًا لأول 3 رحلات مؤهلة (15% بحد أقصى 15 جنيهًا).</div>
        </details>
        <section class="trip-summary" id="tripSummary"><div><small>المسافة</small><b id="summaryDistance">—</b></div><div><small>الوقت المتوقع</small><b id="summaryDuration">—</b></div><div><small>السعر النهائي</small><b id="summaryFare">—</b></div></section>
        <div class="notice" id="pricingNotice" hidden></div>
        </div><div class="trip-options-action-bar"><button class="btn primary trip-submit-button" type="submit" id="sendTrip">
          <span id="sendTripLabel">اطلب السكة الآن</span>
          <small id="trafficBadge" class="traffic-badge"></small>
        </button>
        <p class="map-first-saving-note">وفّرت 15% تلقائياً بدون عمولة</p></div>
        <p class="message" id="tripMessage" aria-live="polite"></p>
        <section id="tripResult" class="trip-result" hidden></section>
      </form>    </main>`);

  let origin = null, destination = null, activePoint = 'origin';
  const $ = id => document.getElementById(id);
  let pendingTrip = null;
  try { pendingTrip=JSON.parse(sessionStorage.getItem('el-sekka-pending-trip') || 'null'); sessionStorage.removeItem('el-sekka-pending-trip'); } catch (_) {}

  let routeDistanceKm = null, routeDurationMinutes = null, summarySequence = 0, vehiclePriceSequence = 0;
  applyAppTheme();
  $('tripMap')?.classList.toggle('trip-map-night',document.documentElement.classList.contains('trip-night'));
  $('tripMap')?.classList.toggle('trip-map-day',document.documentElement.classList.contains('trip-day'));
  let map = null, originMarker = null, destinationMarker = null, routeLine = null;
  const searchTimers = {origin:null,destination:null};
  const searchSequence = {origin:0,destination:0};
  let mapHintTimer=null;
  const statusHint = message => {
    const hint=$('mapHint');
    if(!hint)return;
    hint.textContent=message;
    hint.classList.add('is-visible');
    if(mapHintTimer)clearTimeout(mapHintTimer);
    mapHintTimer=setTimeout(()=>hint.classList.remove('is-visible'),4200);
  };
  const riderDraft = readRiderDraft();
  const rememberedTrip = pendingTrip || riderDraft || readPassengerStore('last-trip');
  const routeNames=document.getElementById('selectedRouteNames');if(routeNames)routeNames.textContent=[riderDraft.origin?.name,riderDraft.destination?.name].filter(Boolean).join(' ← ');

  const destinationLabels = {home:'البيت',work:'الشغل',metro:'أقرب مترو'};
  const renderDestinationShortcuts = () => {
    const current=savedPassengerDestinations(), row=$('destinationQuickPlaceRow');
    row.innerHTML=['home','work','metro'].map(key=>{
      const icons={home:'🏠',work:'💼',metro:'🚇'};
      return `<button type="button" class="destination-chip ${current[key]?'is-saved':'is-empty'}" data-destination-key="${key}">${icons[key]} ${destinationLabels[key]}${current[key]?'':' · حفظ'}</button>`;
    }).join('');
    row.querySelectorAll('[data-destination-key]').forEach(button=>button.addEventListener('click',async()=>{
      const key=button.dataset.destinationKey, places=savedPassengerDestinations();
      if(places[key]){await setPoint('destination',places[key].lat,places[key].lng,places[key].name,true);$('tripMessage').textContent=`تم اختيار وجهة ${destinationLabels[key]}.`;return;}
      if(key==='metro'&&origin){
        button.disabled=true;$('tripMessage').textContent='بندور على أقرب محطة مترو من مكان الركوب...';
        try{
          const query=`[out:json][timeout:12];(nwr(around:5000,${origin.lat},${origin.lng})["station"="subway"];nwr(around:5000,${origin.lat},${origin.lng})["railway"="station"]["subway"="yes"];);out center tags;`;
          const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(15000)});
          if(!response.ok)throw new Error('خدمة محطات المترو غير متاحة الآن.');
          const payload=await response.json();
          const candidates=(payload.elements||[]).map(item=>{const point=item.center||item;return{lat:Number(point.lat),lng:Number(point.lon),name:item.tags?.['name:ar']||item.tags?.name||'محطة مترو'};}).filter(item=>Number.isFinite(item.lat)&&Number.isFinite(item.lng));
          if(!candidates.length)throw new Error('ملقيناش محطة مترو مسجلة قريبة. ابحث عن المحطة واحفظها.');
          const distance=item=>Math.hypot((item.lat-origin.lat)*111,(item.lng-origin.lng)*96);
          candidates.sort((a,b)=>distance(a)-distance(b));
          await setPoint('destination',candidates[0].lat,candidates[0].lng,candidates[0].name,true);
          $('tripMessage').textContent=`أقرب محطة مترو حسب بيانات OpenStreetMap: ${candidates[0].name}.`;
        }catch(error){$('tripMessage').textContent=error.message||'تعذر تحديد أقرب محطة. ابحث عنها واحفظها.';}
        finally{button.disabled=false;}
        return;
      }
      if(destination){
        const current=savedPassengerDestinations();current[key]={lat:destination.lat,lng:destination.lng,name:destination.name,label:destinationLabels[key]};
        if(writePassengerStore('destinations',current)){renderDestinationShortcuts();$('tripMessage').textContent=`تم حفظ ${destinationLabels[key]} كوجهة على هذا الجهاز.`;}
        else $('tripMessage').textContent='تعذر الحفظ على الجهاز.';
      }else{$('tripMessage').textContent=`حدد الوجهة أولاً، ثم اضغط ${destinationLabels[key]} لحفظها.`;$('destinationName').focus();}
    }));
  };
  const saveDestination=key=>{
    if(!destination){$('tripMessage').textContent='حدد الوجهة من البحث أو الخريطة أولاً.';return;}
    const current=savedPassengerDestinations();current[key]={lat:destination.lat,lng:destination.lng,name:destination.name,label:destinationLabels[key]};
    if(writePassengerStore('destinations',current)){renderDestinationShortcuts();$('tripMessage').textContent=`تم حفظ ${destinationLabels[key]} كوجهة على هذا الجهاز.`;}
    else $('tripMessage').textContent='تعذر الحفظ على الجهاز.';
  };
  document.querySelectorAll('[data-save-destination]').forEach(button=>button.addEventListener('click',()=>saveDestination(button.dataset.saveDestination)));
  renderDestinationShortcuts();
  document.querySelectorAll('[data-pickup-note]').forEach(button=>button.addEventListener('click',()=>{
    const note=$('pickupNote'),value=button.dataset.pickupNote;
    const parts=note.value.split('،').map(part=>part.trim()).filter(Boolean);
    if(!parts.includes(value))parts.push(value);
    note.value=parts.join('، ').slice(0,160);button.classList.add('selected');
  }));
  $('back')?.addEventListener('click', () => { page = 'home'; render(); });

  const updateFarePreview = async () => {
    const seq = ++summarySequence;
    if (!origin || !destination || !routeDistanceKm) {
      $('summaryDistance').textContent = '—'; $('summaryDuration').textContent = '—'; $('summaryFare').textContent = '—'; return;
    }
    $('summaryDistance').textContent = `${routeDistanceKm.toFixed(1)} كم`;
    $('summaryDuration').textContent = routeDurationMinutes ? `${Math.max(1,Math.round(routeDurationMinutes))} دقيقة` : '—';
    
    $('summaryFare').textContent = 'جارٍ الحساب…';
    try {
      const {data,error}=await supabase.rpc('calculate_fixed_trip_fare',{p_vehicle_type:$('vehicleType').value,p_distance_km:routeDistanceKm});
      if(error) throw error;
      if(seq!==summarySequence) return;
      const fare = typeof data === 'number' ? data : Number(data);
      const referralAvailable=(Number(profile.referral_discount_trips_used||0)+Number(profile.referral_discount_trips_reserved||0))<3 && Boolean(profile.referred_by);
      const pointsAvailable=$('usePoints')?.checked===true && Number(profile.points||0)>=100;
      const previewDiscount=(referralAvailable||pointsAvailable)?Math.min(Math.round(fare*0.15*100)/100,15):0;
      const previewFinal=Math.max(0,fare-previewDiscount);
      $('summaryFare').textContent = Number.isFinite(fare) ? `${previewFinal.toLocaleString('ar-EG')} جنيه${previewDiscount>0?' بعد الخصم':''}` : 'يظهر عند الطلب';
    } catch (_) {
      if(seq===summarySequence) $('summaryFare').textContent = 'يظهر عند الطلب';
    }
  };

  $('usePoints')?.addEventListener('change',()=>updateFarePreview());

  const updateVehiclePrices = async () => {
    const seq = ++vehiclePriceSequence;
    const labels = [...document.querySelectorAll('[data-vehicle-price]')];
    if (!routeDistanceKm) {
      labels.forEach(label => { label.textContent='السعر —'; label.removeAttribute('data-cheapest'); });
      return;
    }
    labels.forEach(label => { label.textContent='جارٍ الحساب'; label.removeAttribute('data-cheapest'); });
    const types = labels.map(label => label.dataset.vehiclePrice);
    const results = await Promise.all(types.map(async type => {
      const {data,error}=await supabase.rpc('calculate_fixed_trip_fare',{p_vehicle_type:type,p_distance_km:routeDistanceKm});
      const fare=Number(data);
      return {type,fare:Number.isFinite(fare)&&!error?fare:null};
    }));
    if (seq!==vehiclePriceSequence) return;
    const valid=results.filter(item=>item.fare!==null);
    const cheapest=valid.length?Math.min(...valid.map(item=>item.fare)):null;
    results.forEach(item=>{
      const label=document.querySelector(`[data-vehicle-price="${item.type}"]`);
      if(!label)return;
      label.textContent=item.fare===null?'السعر غير متاح':`${item.fare.toLocaleString('ar-EG')} ج`;
      if(cheapest!==null&&item.fare===cheapest)label.dataset.cheapest='true';
    });
  };

  const vehicleCapacities={private_car:3,taxi:4,suzuki:6,microbus:13,scooter:1,motorcycle:1};
  let currentPassengerMax=3, selectedPassengerCount=Math.max(1,Number(rememberedTrip?.passenger_count)||1);
  const updatePassengerCountUI=()=>{
    $('passengerCount').value=String(selectedPassengerCount);
    document.querySelectorAll('[data-passengers]').forEach(button=>{
      const value=Number(button.dataset.passengers);
      button.classList.toggle('selected',value===selectedPassengerCount||(value===4&&selectedPassengerCount>=4));
      button.disabled=value>currentPassengerMax;
    });
    $('passengerCountStepper').hidden=selectedPassengerCount<4;
    $('passengerCountValue').textContent=String(selectedPassengerCount);
    $('passengerCountMinus').disabled=selectedPassengerCount<=4;
    $('passengerCountPlus').disabled=selectedPassengerCount>=currentPassengerMax;
  };
  const setPassengerCount=value=>{selectedPassengerCount=Math.min(currentPassengerMax,Math.max(1,Number(value)||1));updatePassengerCountUI();};
  document.querySelectorAll('[data-passengers]').forEach(button=>button.addEventListener('click',()=>setPassengerCount(Number(button.dataset.passengers))));
  $('passengerCountMinus').addEventListener('click',()=>setPassengerCount(selectedPassengerCount-1));
  $('passengerCountPlus').addEventListener('click',()=>setPassengerCount(selectedPassengerCount+1));
  const selectedPreferences=new Set();
  document.querySelectorAll('[data-preference]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.preference;if(selectedPreferences.has(key))selectedPreferences.delete(key);else selectedPreferences.add(key);
    button.classList.toggle('selected',selectedPreferences.has(key));button.setAttribute('aria-pressed',String(selectedPreferences.has(key)));
  }));
  const setVehicle=value=>{
    $('vehicleType').value=value;
    document.querySelectorAll('.vehicle-card').forEach(card=>{const selected=card.dataset.vehicle===value;card.classList.toggle('selected',selected);card.setAttribute('aria-pressed',String(selected));});
    currentPassengerMax=vehicleCapacities[value]||1;$('passengerCountField').hidden=currentPassengerMax===1;
    if(selectedPassengerCount>currentPassengerMax)selectedPassengerCount=currentPassengerMax;
    updatePassengerCountUI();updateFarePreview();
  };
  document.querySelectorAll('.vehicle-card').forEach(card=>card.addEventListener('click',()=>setVehicle(card.dataset.vehicle)));
  setVehicle(['private_car','taxi','suzuki','microbus','scooter','motorcycle'].includes(rememberedTrip?.vehicle_type)?rememberedTrip.vehicle_type:'private_car');

  const fitPoints = () => {
    if (!map) return;
    const points = [];
    if (origin) points.push([origin.lat,origin.lng]);
    if (destination) points.push([destination.lat,destination.lng]);
    if (points.length === 1) map.setView(points[0],15);
    if (points.length === 2 && !routeLine) map.fitBounds(points,{padding:[35,35]});
  };

  let routeSequence = 0;
  const drawRoute = async () => {
    if (!origin || !destination || !map) return;
    const seq = ++routeSequence;
    const start = origin, end = destination;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=false`;
      const response = await fetch(url, {signal:AbortSignal.timeout(12000)});
      const data = await response.json();
      if (seq !== routeSequence || origin !== start || destination !== end) return;
      if (!response.ok || data.code !== 'Ok' || !data.routes?.length) throw new Error('تعذر إيجاد مسار قيادة بين النقطتين.');
      if (routeLine) map.removeLayer(routeLine);
      routeLine = window.L.geoJSON(data.routes[0].geometry,{style:{color:'#10B981',weight:6,opacity:0.95}}).addTo(map);
      routeDistanceKm = data.routes[0].distance / 1000;
      routeDurationMinutes = data.routes[0].duration / 60;
      map.fitBounds(routeLine.getBounds(),{padding:[35,35]});
      statusHint('تم تحديد المسار على الخريطة.');
      await updateFarePreview();
      await updateVehiclePrices();
    } catch (error) {
      if (seq !== routeSequence) return;
      routeDistanceKm=null; routeDurationMinutes=null;
      await updateFarePreview();
      await updateVehiclePrices();
      statusHint(error.name === 'TimeoutError' ? 'خدمة المسارات تأخرت. حاول مرة أخرى بعد لحظات.' : (error.message || 'تعذر رسم المسار حالياً.'));
    }
  };

  const setPoint = async (point, lat, lng, knownName = null, moveMap = false) => {
    const place = {lat:Number(lat),lng:Number(lng),name:knownName || 'جارٍ تحديد العنوان...'};
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    const isOrigin = point === 'origin';
    if (isOrigin) origin = place; else destination = place;
    const draftNow=readRiderDraft();draftNow[isOrigin?'origin':'destination']=place;saveRiderDraft(draftNow);
    // Keep the selected address even if Leaflet is still loading.
    if (map && window.L && typeof window.L.marker === 'function') {
      const marker = isOrigin ? originMarker : destinationMarker;
      const pinIcon = window.L.divIcon({className:'sekka-pin-wrap',html:`<span class="sekka-pin ${isOrigin?'pickup-pin':'dropoff-pin'}"></span>`,iconSize:[24,24],iconAnchor:[12,22]});
      if (marker) { marker.setLatLng([place.lat,place.lng]); marker.setIcon(pinIcon); }
      else {
        const created = window.L.marker([place.lat,place.lng],{draggable:true,icon:pinIcon}).addTo(map);
        created.bindPopup(isOrigin ? 'مكان الركوب' : 'الوجهة');
        if (isOrigin) originMarker = created; else destinationMarker = created;
        created.on('dragend', async event => {
          const p = event.target.getLatLng();
          await setPoint(point,p.lat,p.lng,null,false);
        });
      }
    } else {
      statusHint('تم حفظ العنوان، جارٍ تجهيز الخريطة لإظهار الموقع.');
    }
    if (knownName) {
      place.name = knownName;
      $(isOrigin ? 'originName' : 'destinationName').value = knownName;
    } else {
      const label = await reversePlace(place.lat,place.lng);
      if ((isOrigin ? origin : destination) === place) {
        place.name = label;
        $(isOrigin ? 'originName' : 'destinationName').value = label;
      }
    }
    const savedDraft=readRiderDraft();savedDraft[isOrigin?'origin':'destination']=place;saveRiderDraft(savedDraft);
    if (moveMap && map) map.setView([place.lat,place.lng],15);
    if (!map) return;
    if (origin && destination) await drawRoute();
    else { routeDistanceKm=null; routeDurationMinutes=null; await updateFarePreview(); statusHint('حدد النقطة الثانية لعرض المسار.'); }
  };

  let leafletWaitAttempts = 0;
  const initializeTripMap = () => {
    try {
      const mapElement = $('tripMap');
      if (!mapElement) throw new Error('لم يتم العثور على مساحة الخريطة.');
      if (!window.L || typeof window.L.map !== 'function') {
        if (leafletWaitAttempts < 40) {
          leafletWaitAttempts += 1;
          statusHint('جارٍ تحميل مكتبة الخريطة، لحظات...');
          window.setTimeout(initializeTripMap,150);
          return;
        }
        throw new Error('تعذر تحميل مكتبة الخريطة. تحقق من الاتصال ثم أعد تحميل الصفحة.');
      }
      map = window.L.map(mapElement,{zoomControl:true,preferCanvas:true}).setView([30.0444,31.2357],11);
      const lightTiles=window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        maxZoom:19,
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
        crossOrigin:true
      });
      lightTiles.addTo(map);
      let activeTiles=lightTiles;
      const syncBaseTiles=()=>{
        const night=document.documentElement.classList.contains('trip-night');
        mapElement.classList.toggle('trip-map-night',night);
        mapElement.classList.toggle('trip-map-day',!night);
      };
      syncBaseTiles();
      // Restore both selected coordinates in order, then calculate route and fares.
      (async()=>{
        const saved=readRiderDraft();
        if(saved.origin&&Number.isFinite(Number(saved.origin.lat))&&Number.isFinite(Number(saved.origin.lng))) await setPoint('origin',saved.origin.lat,saved.origin.lng,saved.origin.name||null,true);
        if(saved.destination&&Number.isFinite(Number(saved.destination.lat))&&Number.isFinite(Number(saved.destination.lng))) await setPoint('destination',saved.destination.lat,saved.destination.lng,saved.destination.name||null,true);
        if(origin&&destination) await drawRoute();
      })().catch(error=>statusHint(error.message||'تعذر استعادة إحداثيات المشوار.'));

      const applyMapTheme=()=>{applyAppTheme();syncBaseTiles();};
      applyMapTheme();
      if(appThemeTimer)clearInterval(appThemeTimer);appThemeTimer=window.setInterval(applyMapTheme,60_000);
      if(!origin&&navigator.geolocation){navigator.geolocation.getCurrentPosition(pos=>{if(!origin)setPoint('origin',pos.coords.latitude,pos.coords.longitude,null,true).catch(()=>{});},()=>{}, {enableHighAccuracy:false,timeout:8000,maximumAge:120000});}
      map.on('click',event => {
        try { setPoint(activePoint,event.latlng.lat,event.latlng.lng).catch(error => statusHint(error.message || 'تعذر تحديد النقطة.')); }
        catch(error) { statusHint(error.message || 'تعذر تحديد النقطة.'); }
      });
      const refreshSize = () => {
        if (!map) return;
        try { map.invalidateSize({pan:false,animate:false}); }
        catch(error) { console.warn('Leaflet invalidateSize:',error); }
      };
      window.requestAnimationFrame(() => {
        refreshSize();
        window.setTimeout(refreshSize,250);
        window.setTimeout(refreshSize,800);
      });
      window.addEventListener('resize',refreshSize,{passive:true});
      window.addEventListener('orientationchange',()=>window.setTimeout(refreshSize,300),{passive:true});
      map.on('tileerror',() => statusHint('تعذر تحميل بعض بلاطات الخريطة. تحقق من اتصال الإنترنت.'));
      map.on('tileload',() => { if ($('mapHint')?.textContent.includes('بلاطات')) statusHint('الخريطة جاهزة. حدد مكان الركوب والوجهة.'); });
    } catch (error) {
      console.error('Trip map initialization failed:',error);
      $('tripMap').innerHTML = '<p class="map-error">تعذر تهيئة الخريطة حالياً. يمكنك تجربة إعادة تحميل الصفحة أو تحديد العناوين من البحث.</p>';
      statusHint(error.message || 'تعذر تحميل الخريطة.');
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',initializeTripMap,{once:true});
  } else {
    window.requestAnimationFrame(initializeTripMap);
  }

  const showSuggestions = (point, rows) => {
    const box = $(point === 'origin' ? 'originSuggestions' : 'destinationSuggestions');
    box.innerHTML = rows.map((row,index)=>`<button type="button" class="suggestion-item" data-index="${index}">${esc(row.name)}</button>`).join('');
    box.hidden = !rows.length;
    box.querySelectorAll('.suggestion-item').forEach((button,index)=>button.addEventListener('click',async()=>{
      box.hidden = true;
      await setPoint(point,rows[index].lat,rows[index].lng,rows[index].name,true);
      if(point==='destination') document.querySelector('.destination-save-actions').hidden=false;
    }));
  };

  const bindAutocomplete = point => {
    const field = $(point === 'origin' ? 'originName' : 'destinationName');
    const box = $(point === 'origin' ? 'originSuggestions' : 'destinationSuggestions');
    field.addEventListener('focus',()=>{activePoint=point;});
    field.addEventListener('input',()=>{
      activePoint=point;
      if (point === 'origin') origin=null; else destination=null;
      if (routeLine && map) map.removeLayer(routeLine);
      routeLine=null; routeDistanceKm=null; routeDurationMinutes=null; updateFarePreview();
      const query=field.value.trim();
      if(point==='destination') document.querySelector('.destination-save-actions').hidden=!query;
      clearTimeout(searchTimers[point]);
      const seq=++searchSequence[point];
      if(query.length<3){box.hidden=true;box.innerHTML='';return;}
      box.hidden=false;box.innerHTML='<div class="suggestion-loading">جارٍ البحث عن عناوين في مصر...</div>';
      searchTimers[point]=setTimeout(async()=>{
        try {
          const rows=await searchPlaces(query);
          if(seq!==searchSequence[point]) return;
          showSuggestions(point,rows);
          if(!rows.length) box.innerHTML='<div class="suggestion-loading">لا توجد اقتراحات. جرّب اسم شارع أو منطقة أوضح.</div>';
        } catch(error) {
          if(seq===searchSequence[point]) box.innerHTML=`<div class="suggestion-loading">${esc(error.message || 'تعذر تحميل الاقتراحات حالياً.')} جرّب تعديل البحث بعد قليل.</div>`;
        }
      },1100);
    });
    field.addEventListener('keydown',event=>{if(event.key==='Escape')box.hidden=true;});
  };
  bindAutocomplete('origin');
  bindAutocomplete('destination');
  document.addEventListener('click',event=>{
    if(!event.target.closest('.location-card')) {
      $('originSuggestions').hidden=true;
      $('destinationSuggestions').hidden=true;
    }
  });

  $('useLocation').addEventListener('click',()=>{
    activePoint='origin';
    if(!navigator.geolocation){statusHint('تحديد الموقع غير مدعوم على هذا الجهاز.');return;}
    statusHint('جارٍ تحديد موقعك الحالي...');
    navigator.geolocation.getCurrentPosition(async pos=>{
      await setPoint('origin',pos.coords.latitude,pos.coords.longitude,null,true);
    },err=>statusHint(err.code===1?'اسمح للمتصفح بالوصول إلى موقعك.':'تعذر تحديد موقعك؛ يمكنك كتابة العنوان.'),{enableHighAccuracy:true,timeout:15000});
  });

  const updateTrafficBadge=()=>{
    const now=new Date(),day=now.getDay(),hour=now.getHours(),weekday=day>=0&&day<=4;
    const peak=weekday&&((hour>=7&&hour<10)||(hour>=15&&hour<19));
    const moderate=weekday&&((hour>=10&&hour<12)||(hour>=13&&hour<15)||(hour>=19&&hour<21));
    const badge=$('trafficBadge');
    badge.textContent=peak?'🟠 وقت ذروة تقديري':moderate?'🟡 حركة متوسطة تقديريًا':'🟢 خارج أوقات الذروة';
    badge.dataset.level=peak?'peak':moderate?'moderate':'calm';
  };
  updateTrafficBadge();
  const updateTripSubmitLabel=()=>{$('sendTripLabel').textContent=$('scheduleToggle').checked?'احجز السكة في موعدك':'اطلب السكة الآن';};
  $('scheduleToggle').addEventListener('change',e=>{
    const scheduled=e.target.checked;
    $('scheduleField').hidden=!scheduled;
    $('scheduledAt').required=scheduled;
    updateTripSubmitLabel();
    $('pricingNotice').textContent=scheduled
      ? 'المشوار المجدول بسعر ثابت يحسبه النظام تلقائياً، مثل المشوار الفوري. لا يوجد تفاوض على السعر.'
      : 'المشوار الفوري بسعر ثابت يحسبه النظام تلقائياً. لا توجد عمولة، والدفع للكابتن نقداً.';
    if(!scheduled) $('scheduledAt').value='';
    updateFarePreview();
  });

  $('tripOptionsBack')?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();page='trip-search';render();});
  $('tripForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const msg=$('tripMessage'),button=$('sendTrip');
    msg.textContent='';$('tripResult').hidden=true;
    if(!origin){msg.textContent='اختار مكان الركوب من الاقتراحات أو الخريطة.';return;}
    if(!destination){msg.textContent='اختار الوجهة من الاقتراحات أو الخريطة.';return;}
    if(origin.lat===destination.lat&&origin.lng===destination.lng){msg.textContent='مكان الركوب والوجهة متطابقان.';return;}
    const scheduled=$('scheduleToggle').checked;
    let scheduledAt=null;
    if(scheduled){
      const raw=$('scheduledAt').value;
      if(!raw||new Date(raw).getTime()<=Date.now()){msg.textContent='اختر موعداً مستقبلياً صحيحاً.';return;}      scheduledAt=new Date(raw).toISOString();
    }
    button.disabled=true;$('sendTripLabel').textContent=scheduled?'جارٍ إرسال الحجز المجدول...':'جارٍ إرسال طلبك...';
    msg.textContent='بنحسب المسافة والسعر الثابت على الخادم.';
    try{
      const commonBody={
        vehicle_type:$('vehicleType').value,
        origin_name:origin.name,origin_lat:origin.lat,origin_lng:origin.lng,
        destination_name:destination.name,destination_lat:destination.lat,destination_lng:destination.lng,
        passenger_count:Number($('passengerCount').value)
      };
      const result=await supabase.functions.invoke('create-fixed-trip',{
        body:{
          ...commonBody,
          pickup_note:$('pickupNote').value.trim()||null,
          ride_preferences:{quiet:selectedPreferences.has('quiet'),ac:selectedPreferences.has('ac'),luggage:selectedPreferences.has('luggage')},
          use_points:$('usePoints')?.checked===true,
          is_scheduled:scheduled,
          scheduled_at:scheduledAt
        }
      });
      const {data,error}=result;
      if(error){
        let details=error.message||'تعذر إرسال الطلب.';
        try{const body=await error.context?.json();if(body?.error)details=body.error;}catch(_){}
        throw new Error(details);
      }
      const requestId=data?.request_id||data?.requestId;
      if(!requestId)throw new Error(data?.error||'الخادم لم يرجع تأكيداً بإنشاء الطلب.');
      const fareRaw=data.fixed_fare_egp??data.fixedFareEgp??data.fare_egp??data.fare;
      const distanceRaw=data.distance_km??data.distanceKm??routeDistanceKm;
      const fare=Number(fareRaw), distance=Number(distanceRaw);
      const fareLabel=Number.isFinite(fare)?`${fare.toLocaleString('ar-EG')} جنيه`:'—';
      const beforeFare=Number(data.fare_before_discount_egp??fare);
      const discount=Number(data.discount_amount_egp||0);
      const discountSource=data.discount_source==='points'?'خصم النقاط':data.discount_source==='referral'?'خصم الدعوة':'';
      const savingsHtml=discount>0?`<div class="fare-line"><span>السعر قبل الخصم</span><strong>${beforeFare.toLocaleString('ar-EG')} جنيه</strong></div><div class="fare-line discount"><span>${discountSource} (15%)</span><strong>−${discount.toLocaleString('ar-EG')} جنيه</strong></div><p class="discount-explainer">وفّرت 15% تلقائيًا لأن السكة بدون عمولة على الكباتن. قيمة الخصم تُخصم من المبلغ النقدي الذي تدفعه للكابتن.</p>`:'';
      const distanceLabel=Number.isFinite(distance)?`${distance.toFixed(1)} كم`:'غير متاحة';
      writePassengerStore('last-trip',{
        origin:{lat:origin.lat,lng:origin.lng,name:origin.name},
        destination:{lat:destination.lat,lng:destination.lng,name:destination.name},
        vehicle_type:$('vehicleType').value,
        passenger_count:Number($('passengerCount').value)
      });
      const nextStep=scheduled?'تم تسجيل حجزك بالموعد المحدد.':'بنبحث لك عن كابتن قريب منك الآن.';
      currentTripId=requestId;
      $('tripResult').innerHTML=`<div class="trip-success-icon">✓</div><h3>طلبك وصل بنجاح</h3>${savingsHtml}<div class="fare-line"><span>المبلغ النقدي للكابتن</span><strong>${fareLabel}</strong></div><p>${nextStep}</p><button type="button" class="btn primary" id="openCreatedTrip">متابعة الطلب</button>`;
      $('tripResult').hidden=false;
      $('openCreatedTrip').addEventListener('click',()=>{page='trip-status';render();});
      msg.textContent='تم إنشاء الطلب بنجاح.';$('sendTripLabel').textContent='تم إرسال الطلب';
    }catch(error){
      msg.textContent=error.message||'حصل خطأ غير متوقع. حاول مرة أخرى.';
      button.disabled=false;updateTripSubmitLabel();
    }
  });
}


function tripStatusLabel(status){
  return ({searching:'جارٍ البحث عن كابتن',accepted:'تم قبول الرحلة',in_progress:'الرحلة جارية',completed:'اكتملت الرحلة',cancelled:'تم إلغاء الرحلة'})[status]||'حالة الرحلة';
}

async function setupTripChat(tripId,partnerName){
  const root=document.getElementById('tripChatPanel');
  if(!root)return;
  const {data:conversation,error:conversationError}=await supabase.from('trip_conversations')
    .select('trip_id,closed_at').eq('trip_id',tripId).maybeSingle();
  if(conversationError||!conversation){
    root.innerHTML='<div class="notice">المحادثة هتظهر هنا بعد قبول الرحلة.</div>';
    return;
  }
  const closed=Boolean(conversation.closed_at)||['completed','cancelled'].includes((await supabase.from('trip_requests').select('request_status').eq('id',tripId).maybeSingle()).data?.request_status);
  root.innerHTML=`
    <div class="trip-chat-head"><div><h3>محادثة الرحلة</h3><small>التواصل داخل السكة فقط · لا تظهر أرقام الهواتف</small></div></div>
    <div id="tripChatMessages" class="trip-chat-messages">جارٍ تحميل المحادثة...</div>
    ${closed?'<div class="notice">انتهت المحادثة بعد انتهاء الرحلة. يمكنك مراجعة الرسائل السابقة.</div>':`
      <div class="chat-quick-replies">
        <button type="button" data-chat-quick="أنا وصلت">أنا وصلت</button>
        <button type="button" data-chat-quick="${profile.role==='captain'?'في طريقي إليك':'فين مكانك؟'}">${profile.role==='captain'?'في طريقي إليك':'فين مكانك؟'}</button>
        <button type="button" data-chat-quick="دقيقة وهنزل">دقيقة وهنزل</button>
      </div>
      <form id="tripChatForm" class="trip-chat-form">
        <textarea id="tripChatInput" rows="2" maxlength="1200" placeholder="اكتب رسالة للكابتن..." required></textarea>
        <div class="chat-compose-actions">
          <button class="btn primary" type="submit">إرسال</button>
          <button class="btn outline" type="button" id="recordTripAudio">🎙️ تسجيل صوت (10 ثوانٍ)</button>
        </div>
        <small id="tripChatMessage" class="muted"></small>
      </form>`}
  `;
  const messagesBox=document.getElementById('tripChatMessages');
  const refreshMessages=async()=>{
    const {data:messages,error}=await supabase.from('trip_messages')
      .select('id,sender_id,message_type,body,storage_path,created_at')
      .eq('trip_id',tripId).order('created_at',{ascending:true}).limit(100);
    if(error){messagesBox.innerHTML='<p class="muted">تعذر تحميل الرسائل.</p>';return;}
    if(!messages?.length){messagesBox.innerHTML='<p class="muted">ابدأ المحادثة برسالة قصيرة.</p>';return;}
    const html=[];
    for(const message of messages){
      const mine=message.sender_id===profile.id;
      const time=new Date(message.created_at).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
      let content=message.message_type==='text'?esc(message.body||''):'رسالة صوتية';
      if(message.message_type==='audio'&&message.storage_path){
        const {data:signed}=await supabase.storage.from('trip-audio').createSignedUrl(message.storage_path,120);
        content=signed?.signedUrl?'<audio controls preload="none" src="'+esc(signed.signedUrl)+'"></audio>':'<small>الرسالة الصوتية غير متاحة.</small>';
      }
      html.push('<div class="chat-message '+(mine?'mine':'theirs')+'"><b>'+(mine?'أنت':esc(partnerName||'الطرف الآخر'))+'</b><div>'+content+'</div><small>'+esc(time)+'</small></div>');
    }
    messagesBox.innerHTML=html.join('');
    messagesBox.scrollTop=messagesBox.scrollHeight;
  };
  await refreshMessages();
  const channel=supabase.channel('trip-chat-'+tripId+'-'+profile.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'trip_messages',filter:'trip_id=eq.'+tripId},()=>refreshMessages())
    .subscribe();
  activeChatChannels.push(channel);
  if(closed)return;
  document.querySelectorAll('[data-chat-quick]').forEach(button=>button.addEventListener('click',()=>{
    const input=document.getElementById('tripChatInput');input.value=button.dataset.chatQuick;input.focus();
  }));
  document.getElementById('tripChatForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const input=document.getElementById('tripChatInput'),message=input.value.trim(),status=document.getElementById('tripChatMessage');
    if(!message)return;
    const submit=event.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;status.textContent='جارٍ الإرسال...';
    const {error}=await supabase.from('trip_messages').insert({trip_id:tripId,sender_id:profile.id,message_type:'text',body:message});
    submit.disabled=false;
    if(error){status.textContent=error.message?.includes('phone_numbers_not_allowed')?'ممنوع مشاركة أرقام الهواتف داخل محادثة السكة.':'تعذر إرسال الرسالة.';return;}
    input.value='';status.textContent='تم إرسال الرسالة.';await refreshMessages();
  });
  const recordButton=document.getElementById('recordTripAudio');
  let activeRecorder=null,activeStream=null,recordStopTimer=null;
  recordButton?.addEventListener('click',async()=>{
    const status=document.getElementById('tripChatMessage');
    if(activeRecorder?.state==='recording'){
      if(recordStopTimer)clearTimeout(recordStopTimer);
      activeRecorder.stop();recordButton.disabled=true;recordButton.textContent='جارٍ تجهيز التسجيل...';return;
    }
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status.textContent='تسجيل الصوت غير مدعوم على هذا الجهاز.';return;}
    recordButton.disabled=true;status.textContent='اسمح باستخدام الميكروفون...';
    try{
      activeStream=await navigator.mediaDevices.getUserMedia({audio:true});
      const preferred=['audio/webm;codecs=opus','audio/webm','audio/ogg','audio/mp4'];
      const mime=preferred.find(type=>MediaRecorder.isTypeSupported(type));
      activeRecorder=mime?new MediaRecorder(activeStream,{mimeType:mime}):new MediaRecorder(activeStream);
      const chunks=[];
      activeRecorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
      activeRecorder.onstop=async()=>{
        activeStream?.getTracks().forEach(track=>track.stop());activeStream=null;
        const blob=new Blob(chunks,{type:activeRecorder?.mimeType||'audio/webm'});
        if(blob.size>1024*1024){status.textContent='الرسالة الصوتية أكبر من الحد المسموح.';recordButton.disabled=false;recordButton.textContent='🎙️ تسجيل صوت (10 ثوانٍ)';activeRecorder=null;return;}
        status.textContent='جارٍ رفع الرسالة الصوتية...';
        const type=(blob.type||'audio/webm').split(';')[0],ext=type==='audio/ogg'?'ogg':type==='audio/mp4'?'mp4':'webm';
        const path=tripId+'/'+profile.id+'/'+crypto.randomUUID()+'.'+ext;
        const {error:uploadError}=await supabase.storage.from('trip-audio').upload(path,blob,{contentType:type,upsert:false});
        if(uploadError){status.textContent='تعذر رفع الرسالة الصوتية.';recordButton.disabled=false;recordButton.textContent='🎙️ تسجيل صوت (10 ثوانٍ)';activeRecorder=null;return;}
        const {error:messageError}=await supabase.from('trip_messages').insert({trip_id:tripId,sender_id:profile.id,message_type:'audio',storage_path:path});
        if(messageError){await supabase.storage.from('trip-audio').remove([path]);status.textContent='تعذر إرسال الرسالة الصوتية.';}
        else{status.textContent='تم إرسال الرسالة الصوتية.';await refreshMessages();}
        activeRecorder=null;recordButton.disabled=false;recordButton.textContent='🎙️ تسجيل صوت (10 ثوانٍ)';
      };
      activeRecorder.start();recordButton.disabled=false;recordButton.textContent='إيقاف التسجيل';status.textContent='جارٍ التسجيل... الحد الأقصى 10 ثوانٍ.';
      recordStopTimer=window.setTimeout(()=>{if(activeRecorder?.state==='recording'){status.textContent='اكتملت 10 ثوانٍ، جارٍ إرسال التسجيل.';activeRecorder.stop();recordButton.disabled=true;}},10000);
    }catch(error){
      activeStream?.getTracks().forEach(track=>track.stop());activeStream=null;activeRecorder=null;
      status.textContent='تعذر تشغيل الميكروفون. راجع إذن المتصفح.';
      recordButton.disabled=false;recordButton.textContent='🎙️ تسجيل صوت (10 ثوانٍ)';
    }
  });
}

async function startCaptainLocationShare(tripId,button){
  if(!navigator.geolocation){alert('تحديد الموقع غير مدعوم على هذا الجهاز.');return;}
  if(captainLocationWatchId!==null)navigator.geolocation.clearWatch(captainLocationWatchId);
  button.disabled=true;button.textContent='جارٍ تفعيل مشاركة الموقع...';
  captainLocationWatchId=navigator.geolocation.watchPosition(async position=>{
    const {latitude,longitude,accuracy}=position.coords;
    const {error}=await supabase.rpc('captain_update_fixed_trip_location',{
      p_request_id:tripId,p_latitude:latitude,p_longitude:longitude,p_accuracy_meters:accuracy
    });
    if(error){button.textContent='تعذر تحديث الموقع';button.disabled=false;return;}
    button.textContent='مشاركة الموقع مفعّلة ✓';button.disabled=false;
  },error=>{
    button.disabled=false;button.textContent='تفعيل مشاركة الموقع';
    alert(error.code===1?'اسمح بمشاركة موقعك أثناء الرحلة.':'تعذر تحديد الموقع. حاول مرة أخرى.');
  },{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
}

async function tripStatusPage(tripId){
  disposeLiveUi();
  if(!tripId){page='trip';return tripForm();}
  const {data:trip,error}=await supabase.from('trip_requests')
    .select('id,passenger_id,accepted_captain_id,accepted_vehicle_id,vehicle_type,origin_name,origin_lat,origin_lng,destination_name,destination_lat,destination_lng,passenger_count,fixed_fare_egp,request_status,is_scheduled,scheduled_at,pickup_note,ride_preferences,created_at')
    .eq('id',tripId).maybeSingle();
  if(error||!trip){layout('<main class="wrap narrow"><section class="panel"><h2>مش لاقيين الرحلة</h2><p class="muted">قد تكون غير متاحة أو لا تملك صلاحية عرضها.</p><button class="btn primary" id="tripStatusHome">الرئيسية</button></section></main>');document.getElementById('tripStatusHome')?.addEventListener('click',()=>{page='trip';render();});return;}
  const isCaptain=trip.accepted_captain_id===profile.id;
  const isPassenger=trip.passenger_id===profile.id;
  const active=['accepted','in_progress'].includes(trip.request_status);
  const [{data:counterpartyName},{data:vehicle},{data:location}]=await Promise.all([
    trip.accepted_captain_id?supabase.rpc('get_trip_counterparty_name',{p_trip_id:trip.id}):Promise.resolve({data:null}),
    trip.accepted_vehicle_id?supabase.from('vehicles').select('make,model,color').eq('id',trip.accepted_vehicle_id).maybeSingle():Promise.resolve({data:null}),
    active&&trip.accepted_captain_id?supabase.from('driver_locations').select('latitude,longitude,accuracy_meters,updated_at').eq('captain_id',trip.accepted_captain_id).eq('trip_id',trip.id).maybeSingle():Promise.resolve({data:null})
  ]);
  const partnerName=counterpartyName||'الطرف الآخر';
  const captainName=isCaptain?(profile.display_name||'أنت'):partnerName;
  const preferences=trip.ride_preferences||{};
  const preferenceLabels=[preferences.quiet?'🤫 رحلة هادية':null,preferences.ac?'❄️ تكييف':null,preferences.luggage?'🧳 شنط':null].filter(Boolean);
  const statusText=tripStatusLabel(trip.request_status);
  layout(`
    <main class="wrap narrow">
      <button type="button" class="back" id="tripStatusBack">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">متابعة الرحلة</span><h1>${statusText}</h1><p>كل التعامل والتواصل داخل السكة. أرقام الهواتف غير ظاهرة.</p></section>
      <section class="panel active-trip-panel">
        <div class="trip-route-line"><b>من</b><span>${esc(trip.origin_name)}</span></div>
        <div class="trip-route-line"><b>إلى</b><span>${esc(trip.destination_name)}</span></div>
        <div class="fare-line"><span>السعر الثابت</span><strong>${Number(trip.fixed_fare_egp||0).toLocaleString('ar-EG')} جنيه</strong></div>
        <p class="muted">عدد الركاب: ${esc(trip.passenger_count)} · المركبة: ${esc(({private_car:'ملاكي',taxi:'تاكسي',suzuki:'سوزوكي',microbus:'ميكروباص',scooter:'اسكوتر',motorcycle:'دراجة نارية'})[trip.vehicle_type]||trip.vehicle_type)}</p>
        ${trip.pickup_note?'<p><b>ملاحظة الركوب:</b> '+esc(trip.pickup_note)+'</p>':''}
        ${preferenceLabels.length?'<div class="fixed-trip-preferences">'+preferenceLabels.map(x=>'<span>'+x+'</span>').join('')+'</div>':''}
        ${active?'<div class="driver-summary"><b>الكابتن: '+esc(captainName||'بانتظار بيانات الكابتن')+'</b><small>المركبة: '+esc([vehicle?.make,vehicle?.model,vehicle?.color].filter(Boolean).join(' ')||'—')+'</small></div>':''}
        ${trip.request_status==='searching'?'<div class="notice">طلبك ظاهر للكباتن المعتمدين. هنحدث الحالة هنا عند قبول كابتن.</div>':''}
        ${trip.request_status==='completed'?'<div class="notice">وصلت بالسلامة. انتهت مشاركة الموقع والمحادثة.</div>':''}
        ${trip.request_status==='cancelled'?'<div class="notice">تم إلغاء الرحلة.</div>':''}
        ${active?'<div id="activeTripMap" class="trip-map" aria-label="موقع الكابتن على الخريطة"></div>':''}
        ${active?'<div class="trip-status-actions"><button type="button" class="btn outline" id="copyTripTracking">نسخ رابط متابعة الرحلة</button>'+(isCaptain?'<button type="button" class="btn outline" id="enableCaptainLocation">تفعيل مشاركة موقعي</button>':'')+'</div>':''}
        ${isCaptain&&trip.request_status==='accepted'?'<button type="button" class="btn primary" id="startFixedTrip">بدء الرحلة</button>':''}
        ${isCaptain&&trip.request_status==='in_progress'?'<button type="button" class="btn primary" id="completeFixedTrip">إنهاء الرحلة</button>':''}
        ${isPassenger&&['searching','accepted'].includes(trip.request_status)?'<button type="button" class="btn outline" id="cancelFixedTrip">إلغاء الرحلة</button>':''}
        <p id="tripStatusMessage" class="message" aria-live="polite"></p>
      </section>
      <section class="panel" id="tripChatPanel"><h3>محادثة الرحلة</h3><p class="muted">تظهر المحادثة بعد قبول الكابتن.</p></section>
    </main>`);
  document.getElementById('tripStatusBack')?.addEventListener('click',()=>{page='home';render();});
  document.getElementById('cancelFixedTrip')?.addEventListener('click',async()=>{
    const button=document.getElementById('cancelFixedTrip');button.disabled=true;
    const {error}=await supabase.rpc('passenger_cancel_fixed_trip',{p_request_id:trip.id});
    if(error){button.disabled=false;document.getElementById('tripStatusMessage').textContent='تعذر إلغاء الرحلة. ربما بدأت بالفعل.';return;}
    await tripStatusPage(trip.id);
  });
  document.getElementById('startFixedTrip')?.addEventListener('click',async()=>{
    const button=document.getElementById('startFixedTrip');button.disabled=true;
    const {error}=await supabase.rpc('captain_start_fixed_trip',{p_request_id:trip.id});
    if(error){button.disabled=false;document.getElementById('tripStatusMessage').textContent='تعذر بدء الرحلة.';return;}
    await tripStatusPage(trip.id);
  });
  document.getElementById('completeFixedTrip')?.addEventListener('click',async()=>{
    const button=document.getElementById('completeFixedTrip');button.disabled=true;
    const {error}=await supabase.rpc('captain_complete_fixed_trip',{p_request_id:trip.id});
    if(error){button.disabled=false;document.getElementById('tripStatusMessage').textContent='تعذر إنهاء الرحلة.';return;}
    await tripStatusPage(trip.id);
  });
  document.getElementById('enableCaptainLocation')?.addEventListener('click',event=>startCaptainLocationShare(trip.id,event.currentTarget));
  document.getElementById('copyTripTracking')?.addEventListener('click',async()=>{
    const button=document.getElementById('copyTripTracking');button.disabled=true;button.textContent='جارٍ إنشاء الرابط...';
    const {data,error}=await supabase.functions.invoke('create-trip-tracking-link',{body:{trip_id:trip.id}});
    button.disabled=false;
    if(error||!data?.token){button.textContent='تعذر إنشاء الرابط';document.getElementById('tripStatusMessage').textContent='تأكد أن الرحلة مقبولة ولم تنتهِ.';return;}
    const link=window.location.origin+'/track?token='+encodeURIComponent(data.token);
    try{await navigator.clipboard.writeText(link);button.textContent='تم نسخ رابط المتابعة ✓';}
    catch(_){window.prompt('انسخ رابط المتابعة الآمن:',link);button.textContent='رابط المتابعة جاهز';}
  });
  if(active&&window.L&&document.getElementById('activeTripMap')){
    publicTrackingMap=window.L.map('activeTripMap').setView(location?[location.latitude,location.longitude]:[trip.origin_lat,trip.origin_lng],location?15:12);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(publicTrackingMap);
    if(location)publicTrackingMarker=window.L.marker([location.latitude,location.longitude]).addTo(publicTrackingMap).bindPopup('موقع الكابتن');
    window.setTimeout(()=>publicTrackingMap?.invalidateSize(),200);
    const locationChannel=supabase.channel('trip-location-'+trip.id+'-'+profile.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'driver_locations',filter:'trip_id=eq.'+trip.id},payload=>{
        const row=payload.new;if(!row?.latitude||!row?.longitude||!publicTrackingMap)return;
        if(publicTrackingMarker)publicTrackingMarker.setLatLng([row.latitude,row.longitude]);
        else publicTrackingMarker=window.L.marker([row.latitude,row.longitude]).addTo(publicTrackingMap).bindPopup('موقع الكابتن');
        publicTrackingMap.panTo([row.latitude,row.longitude]);
      }).subscribe();
    activeTripChannels.push(locationChannel);
  }
  if(['accepted','in_progress','completed','cancelled'].includes(trip.request_status))await setupTripChat(trip.id,partnerName);
  const statusChannel=supabase.channel('trip-status-'+trip.id+'-'+profile.id)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'trip_requests',filter:'id=eq.'+trip.id},()=>tripStatusPage(trip.id))
    .subscribe();
  activeTripChannels.push(statusChannel);
}

async function publicTrackingPage(token){
  layout(`
    <main class="wrap narrow">
      <section class="hero compact"><span class="tag">رابط متابعة آمن · السكة</span><h1>متابعة الرحلة</h1><p>يعرض هذا الرابط معلومات الرحلة وموقع المركبة أثناء الرحلة فقط.</p></section>
      <section class="panel">
        <div id="publicTrackStatus" class="notice">جارٍ تحميل بيانات الرحلة...</div>
        <div id="publicTrackDetails" hidden></div>
        <div id="publicTrackMap" class="trip-map" hidden></div>
      </section>
    </main>`);
  const status=document.getElementById('publicTrackStatus'),details=document.getElementById('publicTrackDetails'),mapBox=document.getElementById('publicTrackMap');
  const refresh=async()=>{
    const {data,error}=await supabase.functions.invoke('get-trip-tracking',{body:{token}});
    if(error||!data?.active){
      status.textContent='انتهت صلاحية رابط المتابعة أو انتهت الرحلة.';
      details.hidden=true;mapBox.hidden=true;
      if(publicTrackingTimer){clearInterval(publicTrackingTimer);publicTrackingTimer=null;}
  if(appThemeTimer){clearInterval(appThemeTimer);appThemeTimer=null;}
      return;
    }
    status.textContent=data.status==='in_progress'?'الرحلة جارية الآن':'تم قبول الرحلة والكابتن في الطريق';
    details.hidden=false;
    const vehicle=data.vehicle||{};
    details.innerHTML='<div class="driver-summary"><b>الكابتن: '+esc(data.captain_name)+'</b><small>المركبة: '+esc([vehicle.make,vehicle.model,vehicle.color].filter(Boolean).join(' ')||'—')+'</small></div><p><b>من:</b> '+esc(data.origin)+'</p><p><b>إلى:</b> '+esc(data.destination)+'</p><small class="muted">آخر تحديث: '+esc(new Date(data.checked_at).toLocaleTimeString('ar-EG'))+'</small>';
    if(data.location&&window.L){
      mapBox.hidden=false;
      if(!publicTrackingMap){
        publicTrackingMap=window.L.map('publicTrackMap').setView([data.location.latitude,data.location.longitude],15);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(publicTrackingMap);
      }
      if(publicTrackingMarker)publicTrackingMarker.setLatLng([data.location.latitude,data.location.longitude]);
      else publicTrackingMarker=window.L.marker([data.location.latitude,data.location.longitude]).addTo(publicTrackingMap).bindPopup('موقع المركبة');
      publicTrackingMap.panTo([data.location.latitude,data.location.longitude]);
      window.setTimeout(()=>publicTrackingMap?.invalidateSize(),100);
    }
  };
  await refresh();
  publicTrackingTimer=window.setInterval(refresh,10000);
}

function shareHome() {
  const isCaptain = profile?.role === 'captain';
  const sharedVehicleTypes=['private_car'];
  const types = [['private_car','ملاكي']];
  layout(`
    <main class="wrap narrow">
      <button type="button" class="back" id="back">→ الرئيسية</button>
      <section class="hero compact share-hero ${isCaptain?"captain-share-hero":"rider-share-hero"}">
        <span class="tag">${isCaptain?"مساحة الكابتن · إدارة خطوطك":"مساحة الراكب · اكتشف طريقك"}</span>
        <h1>${isCaptain?"انشر خطك واستقبل الحجوزات":"اختار خط سير يناسب مشوارك"}</h1>
        <p>${isCaptain?"حدد طريقك ومواعيدك وعدد المقاعد، وتابع طلبات الركاب من مكان واحد.":"شوف الخطوط المتاحة على الخريطة، واختار مكان ركوب ونزول على نفس الطريق."}</p>
        <div class="share-hero-points"><span>🗺️ خريطة فعلية</span><span>🚗 ملاكي فقط</span><span>🛡️ حجز آمن داخل التطبيق</span></div>
      </section>
      <details class="panel share-rule">
        <summary><b>كيف تعمل مشاركة الطريق؟</b></summary>
        <p>الكابتن ينشر خط سير وموعدًا وعدد كراسي. الراكب يختار نقطة ركوب ونزول على نفس الخط، ولازم كل نقطة تكون على بُعد 500 متر أو أقل من المسار.</p>
        <p>السعر الظاهر قبل إرسال الطلب، والكابتن يراجع الطلب ويقبله أو يرفضه. الكرسي يتحجز عند القبول، ويُحسب إشغال المقاعد على الجزء المشترك من الطريق.</p>
      </details>
      <section class="panel" hidden>
        <h2>انشر طلب مشاركة طريق</h2>
        <form id="shareRequestForm" class="form">
          <label>نوع المشاركة
            <select id="shareMode"><option value="live_share">فوري</option><option value="scheduled_share">مجدول</option></select>
          </label>
          <label id="shareDateField" hidden>موعد التحرك<input id="shareDeparture" type="datetime-local"></label>
          <section class="location-card">
            <label>مكان البداية
              <input id="shareOrigin" required maxlength="180" placeholder="اكتب اسم الشارع أو المنطقة" autocomplete="off">
              <div class="suggestions" id="shareOriginSuggestions" role="listbox" hidden></div>
            </label>
            <div class="location-divider"></div>
            <label>الوجهة
              <input id="shareDestination" required maxlength="180" placeholder="اكتب وجهتك" autocomplete="off">
              <div class="suggestions" id="shareDestinationSuggestions" role="listbox" hidden></div>
            </label>
          </section>
          <div class="map-heading"><b>حدد الطريق على الخريطة</b><small>اختار الحقل ثم اضغط على الخريطة أو حرّك الدبوس.</small></div>
          <div id="shareMap" class="trip-map" role="application" aria-label="خريطة تحديد بداية ونهاية المشاركة"></div>
          <div class="map-legend"><span>🟢 البداية</span><span>🔴 الوجهة</span><span id="shareMapHint">حدد النقطتين لعرض المسار.</span></div>
          <label>عدد الكراسي المطلوبة<input id="shareSeats" type="number" min="1" max="3" value="1" required></label>
          <label>السعر المبدئي للكرسي (جنيه)<input id="sharePrice" type="number" min="0" step="0.5" required placeholder="اكتب السعر الذي تقترحه"></label>
          <label>نوع المركبة المفضل (اختياري)
            <select id="shareVehicle"><option value="">أي مركبة مناسبة</option>${types.map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select>
            <small class="muted"></small>
          </label>
          <button class="btn primary" type="submit">نشر طلب المشاركة</button>
          <p id="shareCreateMessage" class="message" aria-live="polite"></p>
        </form>
      </section>
      ${isCaptain ? `
      <section class="panel">
        <h2>انشر كراسي متاحة بمركبتك</h2>
        <p class="muted">انشر خطًا من مكان لمكان. النظام يحسب مسار قيادة تقريبيًا ويحفظه، ثم يطابق طلبات الركاب على الخط بحد انحراف 500 متر.</p>
        <form id="captainSeatOfferForm" class="form">
          <input id="seatOfferVehicle" type="hidden" value=""><div class="vehicle-summary" id="seatOfferVehicleSummary"><b>مركبتك المسجلة</b><span id="seatOfferVehicleStatus" class="notice" role="status">جارٍ تحميل بيانات مركبتك...</span></div>
          <label>نوع العرض<select id="seatOfferMode"><option value="live_share">فوري</option><option value="scheduled_share">مجدول</option></select></label>
          <label>بداية الخط (شارع أو معلم واضح)<input id="seatOfferOrigin" required maxlength="180" placeholder="مثال: حدائق المعادي"></label>
          <label>نهاية الخط (شارع أو معلم واضح)<input id="seatOfferDestination" required maxlength="180" placeholder="مثال: التجمع الخامس"></label>
          <div class="map-heading"><b>حدد خط سيرك على الخريطة</b><small>اختار البداية أو النهاية ثم اضغط على الخريطة. تقدر تحرك العلامات.</small></div>
          <div class="map-pick-mode"><button type="button" class="map-mode active" id="seatPickOrigin">📍 تحديد البداية</button><button type="button" class="map-mode" id="seatPickDestination">🏁 تحديد النهاية</button></div>
          <div id="seatOfferMap" class="trip-map trip-map-dark" role="application" aria-label="خريطة خط السير"></div>
          <div class="map-legend"><span>🟢 البداية</span><span>🔴 النهاية</span><span>⛽ بنزينة</span><span>🏦 بنك</span><span>🛒 سوبر ماركت</span><span>💊 صيدلية</span><span id="seatOfferMapHint">اضغط على الخريطة لتحديد البداية والنهاية.</span></div>
          <label id="seatOfferDateField" hidden>موعد التحرك<input id="seatOfferDeparture" type="datetime-local"></label>
          <label>عدد الكراسي المتاحة<input id="seatOfferSeats" type="number" min="1" max="3" value="1" required></label>
          <label>سعر الكرسي (جنيه)<input id="seatOfferPrice" type="number" min="0" step="0.5" required></label>
          <button class="btn primary" type="submit">نشر عرض الكراسي</button>
          <p id="seatOfferMessage" class="message" aria-live="polite"></p>
        </form>
      </section>
      <section class="panel" hidden>
        <h2>طلبات مشاركة متاحة على الطريق</h2>
        <p class="muted">طلبات الركاب والكباتن الذين يستخدمون الخدمة كطالبي مقاعد.</p>
        <div id="shareOpenRequests" class="share-list">جارٍ تحميل الطلبات...</div>
      </section>` : ''}
      ${isCaptain ? '<section class="panel" hidden><h2>متابعة تفاوضاتك ككابتن</h2><div id="shareCaptainNegotiations" class="share-list">جارٍ تحميل التفاوضات...</div></section>' : ''}
      <section class="panel"><h2>حجوزات الكراسي الحالية</h2><div id="legacyShareBookings" class="share-list">جارٍ تحميل الحجوزات...</div></section>
      ${isCaptain?'<section class="panel captain-own-routes-panel"><div class="share-section-heading"><div><span class="tag">لوحة الكابتن</span><h2>خطوطي المنشورة</h2><p class="muted">تابع العروض التي نشرتها والمقاعد المتاحة فيها.</p></div><span class="share-section-icon">🛣️</span></div><div id="captainOwnShareRides" class="share-list">جارٍ تحميل خطوطك...</div></section>':'<section class="panel rider-route-discovery"><div class="share-section-heading"><div><span class="tag">اكتشف الطريق</span><h2>الخطوط المتاحة حولك</h2><p class="muted">المسارات الحقيقية المنشورة من الكباتن، مع نقاط البداية والنهاية.</p></div><span class="share-section-icon">🧭</span></div><div id="riderShareMap" class="trip-map rider-share-map" role="application" aria-label="خريطة خطوط مشاركة الطريق"></div><div class="map-legend"><span>🟢 بداية الخط</span><span>🔴 نهاية الخط</span><span>🟩 مسار الكابتن</span></div><div id="shareAvailableRides" class="share-list rider-share-list">جارٍ تحميل الخطوط المتاحة...</div></section>'}
      <section class="panel" hidden>        <h2>طلباتي وردود الكباتن</h2>
        <div id="shareMyRequests" class="share-list">جارٍ تحميل طلباتك...</div>
      </section>
    </main>`);
  const $ = id => document.getElementById(id);
  let shareOriginPoint=null, shareDestinationPoint=null, shareActivePoint='origin';
  let shareMap=null, shareOriginMarker=null, shareDestinationMarker=null, shareRouteLine=null;
  let shareRouteSequence=0, shareLeafletAttempts=0;
  const shareSearchTimers={origin:null,destination:null};
  const shareSearchSequence={origin:0,destination:0};
  const shareMapHint=message=>{if($('shareMapHint'))$('shareMapHint').textContent=message;};
  const setSharePoint=async(point,lat,lng,knownName=null,moveMap=false)=>{
    const place={lat:Number(lat),lng:Number(lng),name:knownName||'جارٍ تحديد العنوان...'};
    if(!Number.isFinite(place.lat)||!Number.isFinite(place.lng))return;
    const isOrigin=point==='origin';
    if(isOrigin)shareOriginPoint=place;else shareDestinationPoint=place;
    const marker=isOrigin?shareOriginMarker:shareDestinationMarker;
    const pinIcon=window.L?.divIcon({className:'sekka-pin-wrap',html:`<span class="sekka-pin ${isOrigin?'pickup-pin':'dropoff-pin'}"></span>`,iconSize:[24,24],iconAnchor:[12,22]});
    if(shareMap&&window.L){
      if(marker){marker.setLatLng([place.lat,place.lng]);marker.setIcon(pinIcon);}
      else{
        const created=window.L.marker([place.lat,place.lng],{draggable:true,icon:pinIcon}).addTo(shareMap);
        created.bindPopup(isOrigin?'بداية المشاركة':'وجهة المشاركة');
        if(isOrigin)shareOriginMarker=created;else shareDestinationMarker=created;
        created.on('dragend',event=>{const p=event.target.getLatLng();setSharePoint(point,p.lat,p.lng,null,false);});
      }
    }
    const field=$(isOrigin?'shareOrigin':'shareDestination');
    if(knownName){place.name=knownName;field.value=knownName;}
    else{
      const label=await reversePlace(place.lat,place.lng);
      if((isOrigin?shareOriginPoint:shareDestinationPoint)===place){place.name=label;field.value=label;}
    }
    if(moveMap&&shareMap)shareMap.setView([place.lat,place.lng],15);
    if(shareOriginPoint&&shareDestinationPoint&&shareMap){
      const seq=++shareRouteSequence,start=shareOriginPoint,end=shareDestinationPoint;
      shareMapHint('جارٍ رسم مسار القيادة...');
      try{
        const url=`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=false`;
        const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
        const data=await response.json();
        if(seq!==shareRouteSequence||shareOriginPoint!==start||shareDestinationPoint!==end)return;
        if(!response.ok||data.code!=='Ok'||!data.routes?.length)throw new Error('تعذر إيجاد مسار قيادة بين النقطتين.');
        if(shareRouteLine)shareMap.removeLayer(shareRouteLine);
        shareRouteLine=window.L.geoJSON(data.routes[0].geometry,{style:{color:'#a8ff45',weight:6,opacity:1}}).addTo(shareMap);
        shareMap.fitBounds(shareRouteLine.getBounds(),{padding:[35,35]});
        shareMapHint('تم تحديد المسار على الخريطة.');
      }catch(error){if(seq===shareRouteSequence)shareMapHint(error.message||'تعذر رسم المسار حالياً.');}
    }else shareMapHint('حدد النقطة الثانية لعرض المسار.');
  };
  const showShareSuggestions=(point,rows)=>{
    const box=$(point==='origin'?'shareOriginSuggestions':'shareDestinationSuggestions');
    box.innerHTML=rows.map((row,index)=>`<button type="button" class="suggestion-item" data-index="${index}">${esc(row.name)}</button>`).join('');
    box.hidden=!rows.length;
    box.querySelectorAll('.suggestion-item').forEach((button,index)=>button.addEventListener('click',async()=>{
      box.hidden=true;await setSharePoint(point,rows[index].lat,rows[index].lng,rows[index].name,true);
    }));
  };
  const bindShareAutocomplete=point=>{
    const field=$(point==='origin'?'shareOrigin':'shareDestination');
    const box=$(point==='origin'?'shareOriginSuggestions':'shareDestinationSuggestions');
    field.addEventListener('focus',()=>{shareActivePoint=point;});
    field.addEventListener('input',()=>{
      shareActivePoint=point;
      if(point==='origin')shareOriginPoint=null;else shareDestinationPoint=null;
      if(shareRouteLine&&shareMap)shareMap.removeLayer(shareRouteLine);
      shareRouteLine=null;++shareRouteSequence;
      const query=field.value.trim();clearTimeout(shareSearchTimers[point]);
      const seq=++shareSearchSequence[point];
      if(query.length<3){box.hidden=true;box.innerHTML='';return;}
      box.hidden=false;box.innerHTML='<div class="suggestion-loading">جارٍ البحث عن عناوين في مصر...</div>';
      shareSearchTimers[point]=setTimeout(async()=>{
        try{
          const rows=await searchPlaces(query);
          if(seq!==shareSearchSequence[point])return;
          showShareSuggestions(point,rows);
          if(!rows.length)box.innerHTML='<div class="suggestion-loading">لا توجد اقتراحات. جرّب اسم شارع أو منطقة أوضح.</div>';
        }catch(error){if(seq===shareSearchSequence[point])box.innerHTML=`<div class="suggestion-loading">${esc(error.message||'تعذر تحميل الاقتراحات حالياً.')}</div>`;}
      },1100);
    });
    field.addEventListener('keydown',event=>{if(event.key==='Escape')box.hidden=true;});
  };
  bindShareAutocomplete('origin');bindShareAutocomplete('destination');
  document.addEventListener('click',event=>{
    if(!event.target.closest('#shareRequestForm .location-card')){
      $('shareOriginSuggestions').hidden=true;$('shareDestinationSuggestions').hidden=true;
    }
  });
  const initializeShareMap=()=>{
    const el=$('shareMap');if(!el)return;
    if(!window.L||typeof window.L.map!=='function'){
      if(shareLeafletAttempts++<40){window.setTimeout(initializeShareMap,150);return;}
      shareMapHint('تعذر تحميل الخريطة. يمكنك استخدام البحث عن العناوين.');return;
    }
    shareMap=window.L.map(el,{zoomControl:true,preferCanvas:true}).setView([30.0444,31.2357],11);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',crossOrigin:true
    }).addTo(shareMap);
    shareMap.on('click',event=>setSharePoint(shareActivePoint,event.latlng.lat,event.latlng.lng,null,false));
    const refresh=()=>shareMap?.invalidateSize({pan:false,animate:false});
    window.requestAnimationFrame(()=>{refresh();window.setTimeout(refresh,250);window.setTimeout(refresh,800);});
    window.addEventListener('resize',refresh,{passive:true});
    window.addEventListener('orientationchange',()=>window.setTimeout(refresh,300),{passive:true});
    if(shareOriginPoint)setSharePoint('origin',shareOriginPoint.lat,shareOriginPoint.lng,shareOriginPoint.name,true);
    if(shareDestinationPoint)setSharePoint('destination',shareDestinationPoint.lat,shareDestinationPoint.lng,shareDestinationPoint.name,true);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initializeShareMap,{once:true});
  else window.requestAnimationFrame(initializeShareMap);
  const shareVehicleCapacity = {private_car:3};
  const updateShareVehicleOptions = () => {
    const select = $('shareVehicle');
    const seats = Math.max(1, Number.parseInt($('shareSeats').value, 10) || 1);
    const previous = select.value;
    const eligible = types.filter(([value]) => shareVehicleCapacity[value] >= seats);
    select.innerHTML = '<option value="">أي مركبة مناسبة</option>' +
      eligible.map(([value,name]) => `<option value="${value}">${name}</option>`).join('');
    select.value = eligible.some(([value]) => value === previous) ? previous : '';
    select.disabled = eligible.length === 0;
    if (!eligible.length) {
      select.innerHTML = '<option value="">لا توجد مركبة تستوعب هذا العدد</option>';
    }
  };
  $('shareSeats').addEventListener('input', updateShareVehicleOptions);
  $('shareSeats').addEventListener('change', updateShareVehicleOptions);
  updateShareVehicleOptions();
  $('back').addEventListener('click',(e)=>{e.preventDefault();page='home';render();});
  $('shareMode').addEventListener('change',()=>{
    const scheduled=$('shareMode').value==='scheduled_share';
    $('shareDateField').hidden=!scheduled;
    $('shareDeparture').required=scheduled;
  });
  $('shareRequestForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const msg=$('shareCreateMessage');
    const btn=form.querySelector('button[type="submit"]');
    msg.textContent='جارٍ نشر الطلب...'; btn.disabled=true;
    const seats = Number($('shareSeats').value);
    const selectedVehicle = $('shareVehicle').value;
    if(!shareOriginPoint){msg.textContent='اختار مكان البداية من اقتراحات البحث أو من الخريطة.';btn.disabled=false;return;}
    if(!shareDestinationPoint){msg.textContent='اختار الوجهة من اقتراحات البحث أو من الخريطة.';btn.disabled=false;return;}
    if(shareOriginPoint.lat===shareDestinationPoint.lat&&shareOriginPoint.lng===shareDestinationPoint.lng){msg.textContent='مكان البداية والوجهة متطابقان.';btn.disabled=false;return;}
    if (!Number.isInteger(seats) || seats < 1 || seats > 3 ||
        (selectedVehicle && (shareVehicleCapacity[selectedVehicle] || 0) < seats)) {
      msg.textContent='نوع المركبة المختار لا يستوعب عدد الكراسي. عدّل العدد أو اختر مركبة مناسبة.';
      btn.disabled=false; updateShareVehicleOptions(); return;
    }
    const mode=$('shareMode').value;
    const departure=mode==='scheduled_share'
      ? new Date($('shareDeparture').value)
      : new Date(Date.now()+60000);
    if(mode==='scheduled_share' && (! $('shareDeparture').value || Number.isNaN(departure.getTime()) || departure<=new Date())){
      msg.textContent='اختار موعداً مستقبلياً صحيحاً.'; btn.disabled=false; return;
    }
    const {data,error}=await supabase.rpc('create_share_route_request',{
      p_ride_mode:mode,
      p_origin_name:shareOriginPoint.name,
      p_origin_lat:shareOriginPoint.lat,p_origin_lng:shareOriginPoint.lng,
      p_destination_name:shareDestinationPoint.name,
      p_destination_lat:shareDestinationPoint.lat,p_destination_lng:shareDestinationPoint.lng,
      p_route_description:null,
      p_departure_at:departure.toISOString(),
      p_seats:Number($('shareSeats').value),
      p_seat_price:Number($('sharePrice').value),
      p_vehicle_type:$('shareVehicle').value || null
    });
    btn.disabled=false;
    if(error){msg.textContent=shareError(error);return;}
    msg.textContent='تم نشر طلب المشاركة بنجاح. سيظهر للكباتن المعتمدين.';
    form.reset(); $('shareMode').value='live_share'; $('shareDateField').hidden=true;
    shareOriginPoint=null;shareDestinationPoint=null;
    $('shareOriginSuggestions').hidden=true;$('shareDestinationSuggestions').hidden=true;
    if(shareOriginMarker){shareMap?.removeLayer(shareOriginMarker);shareOriginMarker=null;}
    if(shareDestinationMarker){shareMap?.removeLayer(shareDestinationMarker);shareDestinationMarker=null;}
    if(shareRouteLine){shareMap?.removeLayer(shareRouteLine);shareRouteLine=null;}
    ++shareRouteSequence;shareMapHint('حدد النقطتين لعرض المسار.');
    updateShareVehicleOptions();
    await loadMyShareRequests();
  });

  async function loadMyShareRequests(){
    const host=$('shareMyRequests'); if(!host) return;
    const {data:requests,error}=await supabase.from('share_route_requests')
      .select('id,requester_id,ride_mode,origin_name,destination_name,departure_at,seats_requested,requester_seat_price_egp,request_status,created_at')
      .eq('requester_id',profile.id).order('created_at',{ascending:false}).limit(20);
    if(error){host.textContent='تعذر تحميل الطلبات. تأكد من تنفيذ تحديث قاعدة البيانات أولاً.';return;}
    if(!requests?.length){host.innerHTML='<p class="muted">لا توجد طلبات مشاركة منشورة حتى الآن.</p>';return;}
    const ids=requests.map(x=>x.id);
    const {data:negotiations}=await supabase.from('share_route_negotiations')
      .select('id,request_id,captain_id,vehicle_id,requester_offer_egp,captain_counter_offer_egp,agreed_price_egp,negotiation_status,created_at')
      .in('request_id',ids).order('created_at',{ascending:false});
    const rows=requests.map(r=>{
      const ns=(negotiations||[]).filter(n=>n.request_id===r.id);
      return `<article class="share-item">
        <b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b>
        <small>${r.ride_mode==='live_share'?'فوري':'مجدول'} · ${new Date(r.departure_at).toLocaleString('ar-EG')} · ${r.seats_requested} كرسي</small>
        <p>سعرك المبدئي: ${Number(r.requester_seat_price_egp).toLocaleString('ar-EG')} جنيه للكرسي · الحالة: ${shareStatus(r.request_status)}</p>
        ${ns.length?ns.map(n=>`<div class="share-negotiation">
          <small>عرض الكابتن: ${n.captain_counter_offer_egp==null?'لم يقدم سعراً مقابلاً':Number(n.captain_counter_offer_egp).toLocaleString('ar-EG')+' جنيه'} · ${shareStatus(n.negotiation_status)}</small>
          ${n.negotiation_status==='counter_offer'?`<div class="share-actions"><button class="btn primary" data-share-accept="${n.id}">قبول السعر</button><input type="number" min="0" step="0.5" id="offer-${n.id}" placeholder="سعرك الجديد"><button class="btn outline" data-share-counter="${n.id}">إرسال سعر مقابل</button></div>`:''}
          ${n.negotiation_status==='accepted'?'<span class="notice">تم الاتفاق على السعر. في انتظار تأكيد المطابقة.</span>':''}
          ${n.negotiation_status==='accepted'?'<button class="btn primary" data-share-confirm="'+n.id+'">تأكيد الاتفاق</button>':''}
        </div>`).join(''):'<p class="muted">لا توجد ردود حتى الآن.</p>'}
      </article>`;
    }).join('');
    host.innerHTML=rows;
    host.querySelectorAll('[data-share-accept]').forEach(b=>b.addEventListener('click',()=>replyToShare(b.dataset.shareAccept,'accept')));
    host.querySelectorAll('[data-share-counter]').forEach(b=>b.addEventListener('click',()=>{
      const amount=Number($('offer-'+b.dataset.shareCounter).value);
      if(!Number.isFinite(amount)||amount<0){alert('اكتب سعراً صحيحاً.');return;}
      replyToShare(b.dataset.shareCounter,'counter',amount);
    }));
    host.querySelectorAll('[data-share-confirm]').forEach(b=>b.addEventListener('click',async()=>{
      b.disabled=true;
      const {error}=await supabase.rpc('confirm_share_route_match',{p_negotiation_id:b.dataset.shareConfirm});
      if(error){alert(shareError(error));b.disabled=false;} else await loadMyShareRequests();
    }));
  }

  async function replyToShare(id,action,amount){
    const args={p_negotiation_id:id,p_action:action,p_new_offer:amount??null};
    const {error}=await supabase.rpc('requester_reply_share_route',args);
    if(error){alert(shareError(error));return;}
    await loadMyShareRequests();
  }

  async function loadCaptainRequests(){
    const host=$('shareOpenRequests'); if(!host)return;
    const [{data:requests,error},{data:vehicles}] = await Promise.all([
      supabase.from('share_route_requests').select('id,requester_id,ride_mode,origin_name,destination_name,departure_at,seats_requested,requester_seat_price_egp,preferred_vehicle_type')
        .eq('request_status','open').neq('requester_id',profile.id).order('departure_at',{ascending:true}).limit(40),
      supabase.from('vehicles').select('id,vehicle_type,make,model,passenger_capacity')
        .eq('captain_id',profile.id).eq('approval_status','approved').eq('is_active',true)
        .in('vehicle_type',sharedVehicleTypes)
    ]);
    if(error){host.textContent='تعذر تحميل الطلبات. تأكد من تنفيذ تحديث قاعدة البيانات أولاً.';return;}
    const eligibleRequests=(requests||[]).filter(r=>!r.preferred_vehicle_type||sharedVehicleTypes.includes(r.preferred_vehicle_type));
    if(!eligibleRequests.length){host.innerHTML='<p class="muted">لا توجد طلبات مشاركة متاحة حالياً.</p>';return;}
    if(!vehicles?.length){host.innerHTML='<div class="notice">لازم يكون عندك مركبة معتمدة ونشطة (ملاكي أو سوزوكي أو ميكروباص) حتى ترد على طلب مشاركة.</div>';return;}
    host.innerHTML=eligibleRequests.map(r=>{
      const matching=vehicles.filter(v=>(!r.preferred_vehicle_type||v.vehicle_type===r.preferred_vehicle_type)&&v.passenger_capacity>=r.seats_requested);
      const options=matching.map(v=>`<option value="${v.id}">${esc([v.make,v.model].filter(Boolean).join(' ')||v.vehicle_type)} · ${v.passenger_capacity} مقعد</option>`).join('');
      return `<article class="share-item">
        <b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b>
        <small>${r.ride_mode==='live_share'?'فوري':'مجدول'} · ${new Date(r.departure_at).toLocaleString('ar-EG')} · ${r.seats_requested} كرسي</small>
        <p>السعر المقترح: ${Number(r.requester_seat_price_egp).toLocaleString('ar-EG')} جنيه للكرسي</p>
        ${matching.length?`<label>مركبتك<select id="vehicle-${r.id}">${options}</select></label>
          <div class="share-actions"><button class="btn primary" data-captain-accept="${r.id}">قبول السعر</button><input id="counter-${r.id}" type="number" min="0" step="0.5" placeholder="سعرك المقابل"><button class="btn outline" data-captain-counter="${r.id}">تقديم سعر</button></div>`
          :'<small>لا توجد مركبة مناسبة لعدد الكراسي أو النوع المطلوب.</small>'}
      </article>`;
    }).join('');
    const captainReply=async(id,action,price)=>{
      const vehicleId=$('vehicle-'+id)?.value;
      const {error}=await supabase.rpc('captain_reply_share_route_request',{
        p_request_id:id,p_vehicle_id:vehicleId,p_action:action,p_counter_price:price??null
      });
      if(error){alert(shareError(error));return;}
      alert(action==='accept'?'تم قبول السعر. على صاحب الطلب تأكيد الاتفاق.':'تم إرسال سعرك المقابل لصاحب الطلب.');
      await loadCaptainRequests(); await loadMyShareRequests();
    };
    host.querySelectorAll('[data-captain-accept]').forEach(b=>b.addEventListener('click',()=>captainReply(b.dataset.captainAccept,'accept')));
    host.querySelectorAll('[data-captain-counter]').forEach(b=>b.addEventListener('click',()=>{
      const price=Number($('counter-'+b.dataset.captainCounter).value);
      if(!Number.isFinite(price)||price<0){alert('اكتب سعراً صحيحاً.');return;}
      captainReply(b.dataset.captainCounter,'counter',price);
    }));
  }


  async function loadCaptainNegotiations(){
    const host=$('shareCaptainNegotiations'); if(!host || !isCaptain)return;
    const {data:ns,error}=await supabase.from('share_route_negotiations')
      .select('id,request_id,vehicle_id,requester_offer_egp,negotiation_status,created_at')
      .eq('captain_id',profile.id).order('created_at',{ascending:false}).limit(30);
    if(error){host.textContent='تعذر تحميل تفاوضاتك.';return;}
    const waiting=(ns||[]).filter(n=>n.negotiation_status==='pending');
    if(!waiting.length){host.innerHTML='<p class="muted">لا توجد عروض تحتاج إلى رد منك حالياً.</p>';return;}
    const ids=[...new Set(waiting.map(n=>n.request_id))];
    const {data:rs}=await supabase.from('share_route_requests')
      .select('id,origin_name,destination_name,ride_mode,departure_at,seats_requested')
      .in('id',ids);
    const byId=new Map((rs||[]).map(r=>[r.id,r]));
    host.innerHTML=waiting.map(n=>{
      const r=byId.get(n.request_id); if(!r)return '';
      return '<article class="share-item"><b>'+esc(r.origin_name)+' ← '+esc(r.destination_name)+'</b>'+
        '<small>'+(r.ride_mode==='live_share'?'فوري':'مجدول')+' · '+new Date(r.departure_at).toLocaleString('ar-EG')+'</small>'+
        '<p>صاحب الطلب قدم سعراً جديداً: '+Number(n.requester_offer_egp).toLocaleString('ar-EG')+' جنيه للكرسي · '+r.seats_requested+' كرسي</p>'+
        '<div class="share-actions"><button class="btn primary" data-follow-accept="'+n.id+'">قبول السعر الجديد</button>'+
        '<input id="follow-price-'+n.id+'" type="number" min="0" step="0.5" placeholder="سعر مقابل جديد">'+
        '<button class="btn outline" data-follow-counter="'+n.id+'">إرسال سعر مقابل</button></div></article>';
    }).join('') || '<p class="muted">لا توجد تفاصيل متاحة.</p>';
    const reply=async(id,action,price)=>{
      const n=waiting.find(x=>x.id===id); if(!n)return;
      const {error}=await supabase.rpc('captain_reply_share_route_request',{
        p_request_id:n.request_id,p_vehicle_id:n.vehicle_id,p_action:action,p_counter_price:price??null
      });
      if(error){alert(shareError(error));return;}
      await loadCaptainNegotiations(); await loadMyShareRequests();
    };
    host.querySelectorAll('[data-follow-accept]').forEach(b=>b.addEventListener('click',()=>reply(b.dataset.followAccept,'accept')));
    host.querySelectorAll('[data-follow-counter]').forEach(b=>b.addEventListener('click',()=>{
      const price=Number($('follow-price-'+b.dataset.followCounter).value);
      if(!Number.isFinite(price)||price<0){alert('اكتب سعراً صحيحاً.');return;}
      reply(b.dataset.followCounter,'counter',price);
    }));
  }

  async function loadLegacyShareBookings(){
    const host=$('legacyShareBookings'); if(!host)return;
    const columns='id,ride_id,passenger_id,pickup_name,dropoff_name,seats_requested,passenger_offer_egp,captain_counter_offer_egp,agreed_price_egp,booking_status,created_at,pickup_route_offset_m,dropoff_route_offset_m';
    let bs=[];
    if(isCaptain){
      const [{data:asRequester,error:e1},{data:rides,error:e2}]=await Promise.all([
        supabase.from('bookings').select(columns).eq('passenger_id',profile.id).order('created_at',{ascending:false}).limit(50),
        supabase.from('rides').select('id').eq('captain_id',profile.id)
      ]);
      if(e1||e2){host.textContent='تعذر تحميل حجوزات الكراسي.';return;}
      const ids=(rides||[]).map(r=>r.id);
      let asCaptain=[];
      if(ids.length){
        const result=await supabase.from('bookings').select(columns).in('ride_id',ids).order('created_at',{ascending:false}).limit(50);
        if(result.error){host.textContent='تعذر تحميل حجوزات الكراسي.';return;}
        asCaptain=result.data||[];
      }
      bs=[...new Map([...(asRequester||[]),...asCaptain].map(b=>[b.id,b])).values()]
        .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,50);
    }else{
      const result=await supabase.from('bookings').select(columns).eq('passenger_id',profile.id).order('created_at',{ascending:false}).limit(50);
      if(result.error){host.textContent='تعذر تحميل حجوزات الكراسي.';return;}
      bs=result.data||[];
    }
    if(!bs.length){window.__sekkaPickupReminders={};host.innerHTML='<p class="muted">لا توجد حجوزات كراسي حتى الآن.</p>';return;}
    const rideIds=[...new Set(bs.map(b=>b.ride_id))];
    const {data:rideInfoRows}=await supabase.from('rides').select('id,departure_at,route_distance_m,route_duration_seconds').in('id',rideIds);
    const rideInfo=new Map((rideInfoRows||[]).map(r=>[r.id,r]));
    window.__sekkaPickupReminders=window.__sekkaPickupReminders||{};
    const activeReminderIds=new Set(bs.filter(b=>b.passenger_id===profile.id&&['accepted','confirmed','in_progress'].includes(b.booking_status)).map(b=>b.id));
    Object.keys(window.__sekkaPickupReminders).forEach(id=>{if(!activeReminderIds.has(id))delete window.__sekkaPickupReminders[id];});
    host.innerHTML=bs.map(b=>{
      const requester=b.passenger_id===profile.id;
      const ride=rideInfo.get(b.ride_id);
      const pickupEta=ride&&ride.route_distance_m>0&&ride.route_duration_seconds>0&&b.pickup_route_offset_m!=null
        ?new Date(new Date(ride.departure_at).getTime()+ride.route_duration_seconds*1000*(b.pickup_route_offset_m/ride.route_distance_m)):null;
      const reminderAction=requester&&pickupEta&&['accepted','confirmed','in_progress'].includes(b.booking_status)
        ?'<p class="muted">وصول الكابتن المتوقع: '+pickupEta.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})+' تقريبًا، حسب زمن الطريق التقديري وليس المرور الحي.</p><button class="btn outline" data-pickup-reminder="'+b.id+'" data-pickup-eta="'+pickupEta.getTime()+'">تفعيل تنبيه قبل الوصول بـ10 دقائق</button>':'';

      let actions='';
      if(requester&&b.booking_status==='counter_offer') actions=
        '<div class="share-actions"><button class="btn primary" data-b-accept="'+b.id+'">قبول سعر الكابتن</button><input id="b-offer-'+b.id+'" type="number" min="0" step="0.5" placeholder="سعرك الجديد"><button class="btn outline" data-b-counter="'+b.id+'">سعر مقابل</button><button class="btn ghost" data-b-cancel="'+b.id+'">إلغاء الحجز</button></div>';
      else if(requester&&b.booking_status==='accepted') actions='<div class="share-actions"><button class="btn primary" data-b-confirm="'+b.id+'">تأكيد حجز الكرسي</button><button class="btn ghost" data-b-cancel="'+b.id+'">إلغاء الحجز</button></div>';
      else if(requester&&['pending','confirmed'].includes(b.booking_status)) actions='<button class="btn ghost" data-b-cancel="'+b.id+'">إلغاء الحجز</button>';
      else if(!requester&&b.booking_status==='pending') actions=
        '<div class="share-actions"><button class="btn primary" data-b-captain-accept="'+b.id+'">قبول عرض الراكب</button><input id="b-counter-'+b.id+'" type="number" min="0" step="0.5" placeholder="سعرك المقابل"><button class="btn outline" data-b-captain-counter="'+b.id+'">سعر مقابل</button><button class="btn ghost" data-b-reject="'+b.id+'">رفض</button></div>';
      return '<article class="share-item"><b>'+esc(b.pickup_name)+' ← '+esc(b.dropoff_name)+'</b>'+
        '<small>'+b.seats_requested+' كرسي · '+(requester?'طلب أرسلته':'طلب على عرضك')+' · '+new Date(b.created_at).toLocaleString('ar-EG')+'</small>'+
        '<p>عرض الراكب: '+Number(b.passenger_offer_egp).toLocaleString('ar-EG')+' جنيه · '+(b.captain_counter_offer_egp==null?'لا يوجد سعر مقابل':'سعر الكابتن: '+Number(b.captain_counter_offer_egp).toLocaleString('ar-EG')+' جنيه')+' · الحالة: '+shareStatus(b.booking_status)+'</p>'+actions+reminderAction+'</article>';
    }).join('');
    const call=async(id,fn,args)=>{const {error}=await supabase.rpc(fn,args);if(error){alert(shareError(error));return;}await loadLegacyShareBookings();};
    host.querySelectorAll('[data-pickup-reminder]').forEach(button=>button.addEventListener('click',async()=>{
      if(!('Notification' in window)){alert('المتصفح لا يدعم إشعارات الوصول. اترك صفحة السكة مفتوحة لمتابعة الموعد.');return;}
      let permission=Notification.permission;
      if(permission!=='granted')permission=await Notification.requestPermission();
      if(permission!=='granted'){alert('لم يتم تفعيل الإشعارات. يمكنك تفعيلها من إعدادات المتصفح.');return;}
      const id=button.dataset.pickupReminder,eta=Number(button.dataset.pickupEta);
      window.__sekkaPickupReminders[id]={at:eta-10*60*1000,eta,label:button.closest('.share-item')?.querySelector('b')?.textContent||'رحلتك',sent:false};
      if(!window.__sekkaPickupReminderTimer){
        window.__sekkaPickupReminderTimer=setInterval(()=>{
          const now=Date.now();
          Object.entries(window.__sekkaPickupReminders||{}).forEach(([key,reminder])=>{
            if(!reminder.sent&&now>=reminder.at){
              try{new Notification('السكة: الكابتن قرب يوصل',{body:reminder.label+' · الوصول المتوقع '+new Date(reminder.eta).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}),tag:'sekka-pickup-'+key});}catch{}
              reminder.sent=true;
            }
          });
        },30000);
      }
      button.textContent='تم تفعيل تنبيه الوصول';
      button.disabled=true;
    }));
    host.querySelectorAll('[data-b-accept]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bAccept,'passenger_reply_booking',{p_booking_id:b.dataset.bAccept,p_action:'accept',p_new_offer:null})));
    host.querySelectorAll('[data-b-counter]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.bCounter,price=Number($('b-offer-'+id).value);if(!Number.isFinite(price)||price<0){alert('اكتب سعراً صحيحاً.');return;}call(id,'passenger_reply_booking',{p_booking_id:id,p_action:'counter',p_new_offer:price});}));
    host.querySelectorAll('[data-b-cancel]').forEach(b=>b.addEventListener('click',async buttonEvent=>{
      const button=buttonEvent.currentTarget,id=button.dataset.bCancel;
      if(!window.confirm('هل تريد إلغاء هذا الحجز؟ سيتم تحرير المقاعد المحجوزة إذا لم تكن الرحلة قد بدأت.'))return;
      button.disabled=true;
      const {error}=await supabase.rpc('passenger_cancel_shared_ride_booking',{p_booking_id:id});
      if(error){alert(shareError(error));button.disabled=false;return;}
      await loadLegacyShareBookings();
    }));
    host.querySelectorAll('[data-b-confirm]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bConfirm,'confirm_seat_booking',{p_booking_id:b.dataset.bConfirm})));
    host.querySelectorAll('[data-b-captain-accept]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bCaptainAccept,'captain_reply_booking',{p_booking_id:b.dataset.bCaptainAccept,p_action:'accept',p_counter_price:null})));
    host.querySelectorAll('[data-b-captain-counter]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.bCaptainCounter,price=Number($('b-counter-'+id).value);if(!Number.isFinite(price)||price<0){alert('اكتب سعراً صحيحاً.');return;}call(id,'captain_reply_booking',{p_booking_id:id,p_action:'counter',p_counter_price:price});}));
    host.querySelectorAll('[data-b-reject]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bReject,'captain_reply_booking',{p_booking_id:b.dataset.bReject,p_action:'reject',p_counter_price:null})));
  }

  window.__sekkaReloadShareBookings=loadLegacyShareBookings;

  async function loadCaptainSeatVehicles(){
    const vehicleInput=$('seatOfferVehicle'),status=$('seatOfferVehicleStatus'); if(!vehicleInput)return;
    vehicleInput.value='';
    const {data:vehicles,error}=await supabase.from('vehicles')
      .select('id,vehicle_type,make,model,passenger_capacity,is_active')
      .eq('captain_id',profile.id).eq('approval_status','approved')
      .eq('vehicle_type','private_car').order('created_at',{ascending:false});
    if(error){
      if(status){status.textContent='تعذر تحميل بيانات مركبتك. حدّث الصفحة وحاول مرة أخرى.';status.className='notice error';}
      return;
    }
    const eligible=(vehicles||[]).filter(v=>Number(v.passenger_capacity)>=1&&Number(v.passenger_capacity)<=3);
    if(!eligible.length){      if(status){status.textContent='لا توجد سيارة ملاكي معتمدة مرتبطة بحسابك. راجع بيانات المركبة.';status.className='notice';}
      return;
    }
    const active=eligible.filter(v=>v.is_active===true);
    if(!active.length){
      if(status){status.textContent='سيارتك الملاكي معتمدة، لكن غير مفعّلة حالياً. يلزم تفعيلها من الإدارة قبل نشر الخط.';status.className='notice';}
      return;
    }
    if(active.length>1){
      if(status){status.textContent='يوجد أكثر من سيارة ملاكي نشطة على حسابك. راجع الإدارة لتحديد المركبة الأساسية.';status.className='notice';}
      return;
    }
    const vehicle=active[0];
    vehicleInput.value=vehicle.id;
    const capacity=Math.min(3,Number(vehicle.passenger_capacity));
    const seatInput=$('seatOfferSeats');
    seatInput.max=String(capacity);
    if(Number(seatInput.value)>capacity)seatInput.value=String(capacity);
    if(status){status.textContent=[vehicle.make,vehicle.model].filter(Boolean).join(' ')+' · ملاكي · '+capacity+' مقعد متاح كحد أقصى';status.className='notice success';}
  }
  $('seatOfferMode')?.addEventListener('change',()=>{
    const scheduled=$('seatOfferMode').value==='scheduled_share';
    $('seatOfferDateField').hidden=!scheduled; $('seatOfferDeparture').required=scheduled;
  });
  let seatOfferMap=null,seatOfferActivePoint='origin',seatOfferOriginMarker=null,seatOfferDestinationMarker=null;
  const initSeatOfferMap=()=>{
    const el=$('seatOfferMap');if(!el||!window.L||seatOfferMap)return;
    seatOfferMap=window.L.map(el,{zoomControl:true}).setView([30.0444,31.2357],11);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(seatOfferMap);
    seatOfferMap.on('click',async event=>{
      const p=event.latlng,origin=seatOfferActivePoint==='origin';
      const icon=window.L.divIcon({className:'sekka-pin-wrap',html:'<span class="sekka-pin '+(origin?'pickup-pin':'dropoff-pin')+'"></span>',iconSize:[24,24],iconAnchor:[12,22]});
      let marker=origin?seatOfferOriginMarker:seatOfferDestinationMarker;
      if(marker)marker.setLatLng(p);else{marker=window.L.marker(p,{draggable:true,icon:icon}).addTo(seatOfferMap);if(origin)seatOfferOriginMarker=marker;else seatOfferDestinationMarker=marker;marker.on('dragend',async e=>{const q=e.target.getLatLng();$(origin?'seatOfferOrigin':'seatOfferDestination').value=await reversePlace(q.lat,q.lng);});}
      $(origin?'seatOfferOrigin':'seatOfferDestination').value=await reversePlace(p.lat,p.lng);
      $('seatOfferMapHint').textContent=origin?'تم تحديد البداية. اختار تحديد النهاية ثم اضغط على الخريطة.':'تم تحديد النهاية. راجع العنوانين قبل النشر.';
      if(seatOfferOriginMarker&&seatOfferDestinationMarker){const a=seatOfferOriginMarker.getLatLng(),b=seatOfferDestinationMarker.getLatLng();$('seatOfferMapHint').textContent='جارٍ رسم الطريق وإظهار الأماكن القريبة...';getShareRoadRoute(a,b).then(route=>showSeatOfferRouteAndPois(route,a,b)).catch(error=>{$('seatOfferMapHint').textContent=error.message||'تعذر رسم الطريق.';});}
    });
    $('seatPickOrigin')?.addEventListener('click',()=>{seatOfferActivePoint='origin';$('seatPickOrigin').classList.add('active');$('seatPickDestination').classList.remove('active');});
    $('seatPickDestination')?.addEventListener('click',()=>{seatOfferActivePoint='destination';$('seatPickDestination').classList.add('active');$('seatPickOrigin').classList.remove('active');});
    requestAnimationFrame(()=>seatOfferMap.invalidateSize());
  };
  const retrySeatOfferMap=()=>{if(!$('seatOfferMap'))return;if(!window.L){setTimeout(retrySeatOfferMap,180);return;}initSeatOfferMap();};
  retrySeatOfferMap();
  const showSeatOfferRouteAndPois=async(route,origin,destination)=>{
    if(!seatOfferMap||!window.L)return;
    if(window.__seatOfferRouteLayer)seatOfferMap.removeLayer(window.__seatOfferRouteLayer);
    window.__seatOfferRouteLayer=window.L.geoJSON(route.geometry,{style:{color:'#a8ff45',weight:6,opacity:.95}}).addTo(seatOfferMap);
    seatOfferMap.fitBounds(window.__seatOfferRouteLayer.getBounds(),{padding:[30,30]});
    if(window.__seatOfferPoiLayer)seatOfferMap.removeLayer(window.__seatOfferPoiLayer);
    window.__seatOfferPoiLayer=window.L.layerGroup().addTo(seatOfferMap);
    const lat=(origin.lat+destination.lat)/2,lng=(origin.lng+destination.lng)/2;
    const query='[out:json][timeout:15];(node(around:1800,'+lat+','+lng+')[amenity~"^(fuel|bank|pharmacy)$"];way(around:1800,'+lat+','+lng+')[amenity~"^(fuel|bank|pharmacy)$"];node(around:1800,'+lat+','+lng+')[shop=supermarket];way(around:1800,'+lat+','+lng+')[shop=supermarket];);out center tags;';
    const categories={fuel:['⛽','بنزينة'],bank:['🏦','بنك'],pharmacy:['💊','صيدلية'],supermarket:['🛒','سوبر ماركت']};
    try{
      const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(query),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}});
      if(!response.ok)throw new Error('poi');
      const data=await response.json();
      (data.elements||[]).forEach(item=>{
        const a=item.lat??item.center?.lat,b=item.lon??item.center?.lon;if(!Number.isFinite(a)||!Number.isFinite(b))return;
        const key=item.tags?.amenity||item.tags?.shop,category=categories[key];if(!category)return;
        const icon=window.L.divIcon({className:'sekka-poi-icon',html:'<span>'+category[0]+'</span>',iconSize:[30,30],iconAnchor:[15,15]});
        window.L.marker([a,b],{icon}).bindPopup('<b>'+esc(item.tags?.name||category[1])+'</b><br>'+category[1]).addTo(window.__seatOfferPoiLayer);
      });
      $('seatOfferMapHint').textContent='تم رسم خط السير وإظهار البنزينات والبنوك والسوبر ماركت والصيدليات القريبة.';
    }catch(_){$('seatOfferMapHint').textContent='تم رسم خط السير. تعذر تحميل الأماكن القريبة مؤقتاً.';}
  };
  async function fetchWithTimeout(url,options={},timeoutMs=12000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await fetch(url,{...options,signal:controller.signal});}
    catch(error){if(error.name==='AbortError')throw new Error('استغرق الاتصال بالخريطة وقتاً أطول من اللازم. حدّد النقطتين من الخريطة وحاول مرة أخرى.');throw error;}
    finally{clearTimeout(timer);}
  }
  let shareLastGeocodeAt=0;
  async function geocodeShareAddress(query){
    const wait=Math.max(0,1100-(Date.now()-shareLastGeocodeAt));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    shareLastGeocodeAt=Date.now();
    const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=eg&q='+encodeURIComponent(query+', Egypt');
    const response=await fetchWithTimeout(url,{headers:{'Accept-Language':'ar'}},12000);
    if(!response.ok)throw new Error('تعذر البحث عن العنوان.');
    const rows=await response.json();
    if(!rows?.length)throw new Error('لم نتمكن من تحديد أحد العنوانين. اكتب اسم منطقة أو معلم أوضح.');
    return {lat:Number(rows[0].lat),lng:Number(rows[0].lon),name:rows[0].display_name};
  }
  async function getShareRoadRoute(origin,destination){
    const url='https://router.project-osrm.org/route/v1/driving/'+origin.lng+','+origin.lat+';'+destination.lng+','+destination.lat+'?overview=full&geometries=geojson&steps=false';
    const response=await fetchWithTimeout(url,{},15000);
    if(!response.ok)throw new Error('تعذر حساب مسار الطريق. حاول مرة أخرى.');
    const data=await response.json();
    const route=data.routes?.[0];
    if(data.code!=='Ok'||!route?.geometry?.coordinates?.length)throw new Error('لم نجد مسار قيادة بين النقطتين.');
    return {geometry:route.geometry,distance:Math.round(route.distance),duration:Math.round(route.duration)};
  }
  $('captainSeatOfferForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const msg=$('seatOfferMessage'),btn=form.querySelector('button[type="submit"]');
    const mode=$('seatOfferMode').value;
    if(!$('seatOfferVehicle')?.value){
      msg.textContent=$('seatOfferVehicleStatus')?.textContent||'لا توجد مركبة ملاكي معتمدة ونشطة مرتبطة بحسابك.';
      return;
    }
    const registeredCapacity=Number($('seatOfferSeats').max||0);
    if(!registeredCapacity||Number($('seatOfferSeats').value)<1||Number($('seatOfferSeats').value)>registeredCapacity){
      msg.textContent='عدد الكراسي لا يمكن أن يتجاوز سعة سيارتك المسجلة ('+registeredCapacity+').';return;
    }
    const originName=$('seatOfferOrigin').value.trim(),destinationName=$('seatOfferDestination').value.trim();
    const departure=mode==='scheduled_share'?new Date($('seatOfferDeparture').value):new Date(Date.now()+60000);
    if(!originName||!destinationName){msg.textContent='اكتب بداية الخط ونهايته.';return;}
    if(mode==='scheduled_share'&&(! $('seatOfferDeparture').value||Number.isNaN(departure.getTime())||departure<=new Date())){
      msg.textContent='اختار موعداً مستقبلياً صحيحاً.';return;
    }
    btn.disabled=true;msg.textContent='جارٍ تحديد العناوين وحساب مسار الطريق...';
    try{
      const origin=seatOfferOriginMarker?seatOfferOriginMarker.getLatLng():await geocodeShareAddress(originName);
      const destination=seatOfferDestinationMarker?seatOfferDestinationMarker.getLatLng():await geocodeShareAddress(destinationName);
      const route=await getShareRoadRoute(origin,destination);
      showSeatOfferRouteAndPois(route,origin,destination).catch(()=>{});
      msg.textContent='تم حساب المسار ('+(route.distance/1000).toFixed(1)+' كم · '+Math.round(route.duration/60)+' دقيقة). جارٍ حفظ الخط...';
      const {error}=await supabase.rpc('create_share_ride',{
        p_vehicle_id:$('seatOfferVehicle').value,p_ride_mode:mode,
        p_origin_name:originName,p_origin_lat:origin.lat,p_origin_lng:origin.lng,
        p_destination_name:destinationName,p_destination_lat:destination.lat,p_destination_lng:destination.lng,
        p_route_description:null,p_departure_at:departure.toISOString(),
        p_seats:Number($('seatOfferSeats').value),p_seat_price:Number($('seatOfferPrice').value),
        p_route_geometry:route.geometry,p_route_distance_m:route.distance,p_route_duration_seconds:route.duration
      });
      if(error)throw error;
      msg.textContent='تم نشر خط السير وحفظ مساره على الخريطة.';
      form.reset();$('seatOfferMode').value='live_share';$('seatOfferDateField').hidden=true;
      await loadAvailableRides();
    }catch(error){msg.textContent=shareError(error)||error.message||'تعذر نشر الخط.';}
    finally{btn.disabled=false;}
  });

  let riderShareMap=null,riderShareRouteLayer=null,riderShareMarkerLayer=null,riderSharePoiLayer=null,riderShareMapAttempts=0,riderSharePoiSignature='';
  function initRiderShareMap(){
    const el=$('riderShareMap');if(!el||riderShareMap)return;
    if(!window.L){if(riderShareMapAttempts++<40)setTimeout(initRiderShareMap,180);return;}
    riderShareMap=window.L.map(el,{zoomControl:true}).setView([30.0444,31.2357],10);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(riderShareMap);
    riderShareRouteLayer=window.L.layerGroup().addTo(riderShareMap);
    riderShareMarkerLayer=window.L.layerGroup().addTo(riderShareMap);
    riderSharePoiLayer=window.L.layerGroup().addTo(riderShareMap);
    requestAnimationFrame(()=>riderShareMap?.invalidateSize());
    loadAvailableRides();
  }
  function renderRiderShareRoutes(rides){
    if(!riderShareMap||!window.L)return;
    riderShareRouteLayer.clearLayers();riderShareMarkerLayer.clearLayers();
    const bounds=[];
    rides.forEach(ride=>{
      const geometry=ride.route_geometry;if(!geometry?.coordinates?.length)return;
      const line=window.L.geoJSON(geometry,{style:{color:'#16a36a',weight:5,opacity:.82}}).addTo(riderShareRouteLayer);
      const coords=geometry.coordinates,start=[coords[0][1],coords[0][0]],end=[coords[coords.length-1][1],coords[coords.length-1][0]];
      const startIcon=window.L.divIcon({className:'rider-share-pin-wrap',html:'<span class="rider-share-pin rider-start-pin">●</span>',iconSize:[24,24],iconAnchor:[12,12]});
      const endIcon=window.L.divIcon({className:'rider-share-pin-wrap',html:'<span class="rider-share-pin rider-end-pin">●</span>',iconSize:[24,24],iconAnchor:[12,12]});
      window.L.marker(start,{icon:startIcon}).bindPopup('<b>'+esc(ride.origin_name)+'</b><br>بداية الخط').addTo(riderShareMarkerLayer);
      window.L.marker(end,{icon:endIcon}).bindPopup('<b>'+esc(ride.destination_name)+'</b><br>نهاية الخط').addTo(riderShareMarkerLayer);
      line.bindPopup('<b>'+esc(ride.origin_name)+' ← '+esc(ride.destination_name)+'</b><br>'+Number(ride.available_seats||0)+' مقعد متاح');
      bounds.push(line.getBounds());
    });
    if(bounds.length){const all=window.L.latLngBounds(bounds.flatMap(b=>[b.getSouthWest(),b.getNorthEast()]));riderShareMap.fitBounds(all,{padding:[24,24],maxZoom:13});}
    else riderShareMap.setView([30.0444,31.2357],10);
    setTimeout(()=>riderShareMap?.invalidateSize(),100);
    loadRiderSharePois(rides);
  }
  async function loadRiderSharePois(rides){
    const signature=rides.filter(r=>r.route_geometry?.coordinates?.length).map(r=>r.id).sort().join('|');
    if(!signature||signature===riderSharePoiSignature)return;
    riderSharePoiSignature=signature;riderSharePoiLayer?.clearLayers();
    const clauses=[];
    rides.filter(r=>r.route_geometry?.coordinates?.length).slice(0,5).forEach(ride=>{
      const coords=ride.route_geometry.coordinates,steps=[0,Math.floor((coords.length-1)/3),Math.floor(2*(coords.length-1)/3),coords.length-1];
      [...new Set(steps)].forEach(i=>{const p=coords[i];clauses.push('node(around:350,'+p[1]+','+p[0]+')[amenity~"^(fuel|bank|pharmacy)$"];way(around:350,'+p[1]+','+p[0]+')[amenity~"^(fuel|bank|pharmacy)$"];node(around:350,'+p[1]+','+p[0]+')[shop=supermarket];way(around:350,'+p[1]+','+p[0]+')[shop=supermarket];');});
    });
    if(!clauses.length)return;
    const query='[out:json][timeout:18];('+clauses.join('')+');out center tags;';
    const categories={fuel:['⛽','بنزينة'],bank:['🏦','بنك'],pharmacy:['💊','صيدلية'],supermarket:['🛒','سوبر ماركت']};
    try{
      const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(query),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}});
      if(!response.ok)throw new Error('poi');
      const data=await response.json(),seen=new Set();
      (data.elements||[]).forEach(item=>{
        const lat=item.lat??item.center?.lat,lng=item.lon??item.center?.lon;
        if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
        const type=item.tags?.amenity||item.tags?.shop,category=categories[type];if(!category)return;
        const key=type+':'+lat.toFixed(4)+':'+lng.toFixed(4);if(seen.has(key))return;seen.add(key);
        const icon=window.L.divIcon({className:'sekka-poi-icon',html:'<span>'+category[0]+'</span>',iconSize:[30,30],iconAnchor:[15,15]});
        window.L.marker([lat,lng],{icon}).bindPopup('<b>'+esc(item.tags?.name||category[1])+'</b><br>'+category[1]).addTo(riderSharePoiLayer);
      });
    }catch(_){riderSharePoiSignature='';}
  }
  async function loadCaptainOwnShareRides(){
    const host=$('captainOwnShareRides');if(!host)return;
    const {data,error}=await supabase.from('rides').select('id,origin_name,destination_name,departure_at,available_seats,seat_capacity,seat_price_egp,ride_status,route_distance_m').eq('captain_id',profile.id).order('departure_at',{ascending:false}).limit(20);
    if(error){host.textContent='تعذر تحميل خطوطك المنشورة.';return;}
    if(!data?.length){host.innerHTML='<p class="muted">لسه ما نشرتش أي خط. ابدأ بتحديد خط السير من النموذج بالأعلى.</p>';return;}
    host.innerHTML=data.map(ride=>'<article class="share-item captain-own-route-card"><b>'+esc(ride.origin_name)+' ← '+esc(ride.destination_name)+'</b><small>'+new Date(ride.departure_at).toLocaleString('ar-EG')+' · الحالة: '+esc(shareStatus(ride.ride_status))+'</small><p>المتاح: '+Number(ride.available_seats||0)+' من '+Number(ride.seat_capacity||0)+' مقعد · '+Number(ride.seat_price_egp||0).toLocaleString('ar-EG')+' جنيه للكرسي</p>'+(ride.route_distance_m?'<small>طول المسار '+(ride.route_distance_m/1000).toFixed(1)+' كم</small>':'')+(['open','full'].includes(ride.ride_status)?'<button type="button" class="btn ghost" data-cancel-share-ride="'+ride.id+'">إلغاء الخط</button>':'')+'</article>').join('');
    host.querySelectorAll('[data-cancel-share-ride]').forEach(button=>button.addEventListener('click',async()=>{
      const rideId=button.dataset.cancelShareRide;
      if(!window.confirm('هل تريد إلغاء هذا الخط؟ سيتم تحويل الحجوزات التي لم تبدأ إلى ملغاة، وسيظهر ذلك للركاب عند تحديث حجوزاتهم. لا يمكن الإلغاء إذا بدأت رحلة أحد الركاب.'))return;
      button.disabled=true;
      const {error}=await supabase.rpc('captain_cancel_shared_ride',{p_ride_id:rideId});
      if(error){alert(shareError(error));button.disabled=false;return;}
      await loadCaptainOwnShareRides();
      await loadAvailableRides();
    }));
  }

  async function loadAvailableRides(){
    const host=$('shareAvailableRides');if(!host)return;
    let q=supabase.from('rides').select('id,captain_id,vehicle_id,ride_mode,origin_name,destination_name,departure_at,available_seats,seat_price_egp,route_distance_m,route_duration_seconds,route_geometry')
      .eq('ride_status','open').order('departure_at',{ascending:true}).limit(40);
    const {data,error}=await q;
    if(error){host.textContent='تعذر تحميل عروض الكراسي.';return;}
    // The database trigger guarantees that every newly published ride uses a shared-service vehicle.
    // Do not query vehicles here: rider RLS intentionally limits direct vehicle reads to owners/admins.
    const rides=(data||[]).filter(r=>r.captain_id!==profile.id);
    if(!isCaptain)renderRiderShareRoutes(rides);
    if(!rides.length){host.innerHTML='<p class="muted">لا توجد خطوط متاحة حالياً. ارجع لاحقاً لاكتشاف خطوط جديدة.</p>';return;}
    host.innerHTML=rides.map(r=>`<article class="share-item rider-route-card">
      <div class="rider-route-card-head"><span class="route-car-icon">🚗</span><div><b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b><small>${r.ride_mode==='live_share'?'رحلة فورية':'رحلة مجدولة'} · ${new Date(r.departure_at).toLocaleString('ar-EG')}</small></div></div>
      <div class="rider-route-card-meta"><span>💺 ${r.available_seats} مقعد متاح</span><strong>${Number(r.seat_price_egp).toLocaleString('ar-EG')} جنيه <small>للكرسي</small></strong></div>
      ${r.route_distance_m?'<p class="muted">مسار قيادة: '+(r.route_distance_m/1000).toFixed(1)+' كم · زمن تقديري '+Math.round((r.route_duration_seconds||0)/60)+' دقيقة</p>':'<p class="muted">مسار الطريق التفصيلي غير متاح لهذا العرض.</p>'}
      <div class="share-actions"><input type="number" min="1" max="${r.available_seats}" value="1" id="ride-seats-${r.id}" aria-label="عدد الكراسي">
      <input type="number" min="0" step="0.5" value="${Number(r.seat_price_egp)}" id="ride-offer-${r.id}" aria-label="عرضك للكرسي"></div>
      <div class="share-actions"><input id="ride-pickup-${r.id}" placeholder="مكان صعودك" value="${esc(r.origin_name)}">
      <input id="ride-dropoff-${r.id}" placeholder="مكان نزولك" value="${esc(r.destination_name)}"></div>
      <button class="btn primary" data-book-share-ride="${r.id}">طلب الكراسي والتفاوض</button>
    </article>`).join('');
    host.querySelectorAll('[data-book-share-ride]').forEach(b=>b.addEventListener('click',async()=>{
      const id=b.dataset.bookShareRide;
      const seats=Number($('ride-seats-'+id).value),offer=Number($('ride-offer-'+id).value);
      if(!Number.isInteger(seats)||seats<1||!Number.isFinite(offer)||offer<0){alert('راجع عدد الكراسي والسعر.');return;}
      b.disabled=true;
      try{
        const pickupName=$('ride-pickup-'+id).value.trim();
        const dropoffName=$('ride-dropoff-'+id).value.trim();
        if(!pickupName||!dropoffName)throw new Error('اكتب مكان الركوب والنزول.');
        const pickup=await geocodeShareAddress(pickupName);
        const dropoff=await geocodeShareAddress(dropoffName);
        const {error}=await supabase.rpc('request_seats',{
          p_ride_id:id,p_pickup_name:pickupName,p_dropoff_name:dropoffName,
          p_pickup_order:0,p_dropoff_order:1,p_seats:seats,p_offer:offer,
          p_pickup_lat:pickup.lat,p_pickup_lng:pickup.lng,
          p_dropoff_lat:dropoff.lat,p_dropoff_lng:dropoff.lng
        });
        if(error)throw error;
        b.textContent='تم إرسال طلبك للكابتن';b.disabled=true;await loadLegacyShareBookings();
      }catch(error){alert(shareError(error));b.disabled=false;return;}
      b.textContent='تم إرسال طلبك';b.disabled=true;
    }));
  }

  if(window.__sekkaShareRideChannel) supabase.removeChannel(window.__sekkaShareRideChannel);
  window.__sekkaShareRideChannel=supabase.channel('sekka-shared-ride-seat-updates')
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rides'},()=>loadAvailableRides())
    .subscribe();
  if(isCaptain){loadCaptainSeatVehicles();loadCaptainOwnShareRides();}
  else initRiderShareMap();
  loadAvailableRides();
  loadMyShareRequests();
  loadLegacyShareBookings();
  if(isCaptain){loadCaptainRequests();loadCaptainNegotiations();}
}

function shareStatus(value) {
  return ({open:'مفتوح',matched:'تمت المطابقة',cancelled:'ملغي',completed:'مكتمل',pending:'في انتظار الرد',counter_offer:'سعر مقابل',accepted:'تم قبول السعر',confirmed:'تم التأكيد',rejected:'مرفوض'})[value] || value;
}
function shareError(error) {
  const code=error?.message||'';
  if(code.includes('does not exist')||code.includes('schema cache')) return 'وظائف مشاركة الطريق الجديدة لم تُفعّل بعد على قاعدة البيانات.';
  if(code.includes('approved_active_vehicle_required')) return 'لازم تختار مركبة معتمدة ونشطة.';
  if(code.includes('not_enough_vehicle_capacity')) return 'عدد الكراسي المطلوبة أكبر من سعة مركبتك.';
  if(code.includes('pickup_dropoff_off_route')) return 'نقطة الركوب أو النزول أبعد من 500 متر عن خط الكابتن. اختار نقطة أقرب للمسار.';
  if(code.includes('ride_route_geometry_missing')) return 'مسار الطريق غير محفوظ لهذا العرض، لذلك لا يمكن الحجز عليه حالياً.';
  if(code.includes('not_enough_seats_on_route_segment')) return 'المقاعد المتاحة على الجزء الذي اخترته لا تكفي. حدّث الطلب أو اختار عدد كراسي أقل.';
  if(code.includes('ride_has_started_bookings')) return 'لا يمكن إلغاء الخط لأن رحلة أحد الركاب بدأت بالفعل.';
  if(code.includes('ride_not_cancellable')) return 'هذا الخط بدأ أو أُلغي بالفعل ولا يمكن إلغاؤه.';
  if(code.includes('ride_not_found')) return 'الخط غير موجود أو لا تملك صلاحية إدارته.';
  if(code.includes('account_not_allowed')) return 'الحساب غير مسموح له باستخدام الخدمة.';
  return code||'حدث خطأ غير متوقع. حاول مرة أخرى.';
}


async function captainApplicationStatus() {
  const { data, error } = await supabase.from('captain_applications')
    .select('id,application_status,national_id_expiry,license_expiry,vehicle_license_expiry')
    .eq('user_id', profile.id).maybeSingle();
  if (error) return '<section class="panel"><p class="muted">تعذر تحميل حالة مستندات الكابتن.</p></section>';
  if (!data) return '<section class="panel"><h2>انضم كابتن في السكة</h2><p class="muted">قدّم بياناتك ومستنداتك الستة، وسيتم التحقق تلقائياً من اكتمالها وتواريخ صلاحيتها.</p><button class="btn primary" data-page="apply-captain">التقديم ككابتن</button></section>';
  if (data.application_status === 'approved') return '';
  if (data.application_status === 'pending') return '<section class="panel"><h2>طلب الكابتن قيد مراجعة الإدارة</h2><p class="muted">استلمنا مستنداتك. لن يتم تفعيل نشاط القيادة قبل مراجعة المستندات واعتماد الحساب والمركبة.</p><button class="btn outline" data-page="apply-captain">عرض / تحديث البيانات</button></section>';
  const message = data.application_status === 'suspended'
    ? 'تم إيقاف نشاط القيادة تلقائياً بسبب مستند منتهي. حدّث المستندات لاستعادة النشاط.'
    : 'طلبك السابق يحتاج استكمال المستندات المطلوبة بالنظام التلقائي الجديد.';
  return '<section class="panel"><h2>استكمال مستندات الكابتن</h2><p class="muted">'+message+'</p><button class="btn primary" data-page="apply-captain">استكمال / تحديث المستندات</button></section>';
}

async function captainDocumentsPanel() {
  const {data,error}=await supabase.from('captain_applications')
    .select('application_status,national_id_expiry,license_expiry,vehicle_license_expiry')
    .eq('user_id',profile.id).maybeSingle();
  const {data:notices}=await supabase.from('captain_document_notifications')
    .select('id,notification_type,document_type,message,created_at')
    .eq('user_id',profile.id).is('read_at',null).order('created_at',{ascending:false}).limit(5);
  const labels={national_id:'بطاقة الرقم القومي',driver_license:'رخصة القيادة',vehicle_license:'رخصة السيارة'};
  const dates=data?'<ul><li>بطاقة الرقم القومي: '+esc(data.national_id_expiry||'غير مسجل')+'</li><li>رخصة القيادة: '+esc(data.license_expiry||'غير مسجل')+'</li><li>رخصة السيارة: '+esc(data.vehicle_license_expiry||'غير مسجل')+'</li></ul>':'';
  const alerts=(notices||[]).map(n=>'<div class="notice">'+esc(n.message)+'</div>').join('');
  const status=data?.application_status==='suspended'
    ? '<p class="notice">نشاط القيادة موقوف لحين تحديث المستندات ومراجعتها.</p>'
    : data?.application_status==='pending' ? '<p class="notice">مستنداتك قيد مراجعة الإدارة. لن يتم تفعيل استقبال الرحلات قبل اعتماد الطلب.</p>'
    : data?.application_status==='approved' ? '<p class="muted">مستنداتك معتمدة. سيصلك تنبيه قبل انتهاء أي مستند بـ30 يوماً.</p>' : '<p class="muted">تعذر قراءة حالة المستندات حالياً.</p>';
  return '<section class="panel"><h2>صلاحية مستندات الكابتن</h2>'+status+(error?'':dates)+alerts+'<button class="btn outline" data-page="apply-captain">تحديث المستندات</button></section>';
}

async function captainApplicationStatusPage(knownApplicationId = null) {
  const {data,error} = await supabase.from('captain_applications')
    .select('id,application_status,admin_notes,created_at,reviewed_at,national_id_expiry,license_expiry,vehicle_license_expiry')
    .eq('user_id',profile.id).maybeSingle();
  const application = data;
  const status = application?.application_status || (knownApplicationId ? 'pending' : null);
  const labels = {
    pending:['طلبك قيد مراجعة الإدارة','اكتمل إرسال البيانات والمستندات. لن يتم تفعيل نشاط القيادة قبل مراجعة الإدارة واعتماد الطلب والمركبة.'],
    approved:['تم اعتماد حساب الكابتن','اعتمدت الإدارة بياناتك ومستنداتك. يلزم وجود اشتراك ساري لممارسة نشاط القيادة.'],
    rejected:['تعذر تفعيل الطلب','يمكنك تحديث بياناتك ومستنداتك وإعادة الإرسال.'],
    suspended:['تم إيقاف نشاط القيادة تلقائياً','يوجد مستند منتهي الصلاحية. ارفع النسخة المجددة بوجهيها وتاريخها الجديد لاستعادة النشاط.']
  };
  const details = labels[status];
  layout(`
    <main class="wrap narrow">
      <section class="hero compact"><span class="tag">الانضمام للكباتن</span><h1>حالة مستنداتك</h1><p>يتابع النظام صلاحية المستندات تلقائياً.</p></section>
      <section class="panel">
        ${details ? '<h2>'+details[0]+'</h2><p>'+details[1]+'</p>' : '<h2>تعذر تحديد الحالة</h2><p>اضغط تحديث الحالة بعد قليل.</p>'}
        ${application?.id || knownApplicationId ? '<p class="muted">رقم الطلب: <b>'+esc(application?.id || knownApplicationId)+'</b></p>' : ''}
        ${application?.created_at ? '<p class="muted">تاريخ الإرسال: '+new Date(application.created_at).toLocaleString('ar-EG')+'</p>' : ''}
        ${application ? '<ul><li>انتهاء البطاقة: '+esc(application.national_id_expiry||'—')+'</li><li>انتهاء رخصة القيادة: '+esc(application.license_expiry||'—')+'</li><li>انتهاء رخصة السيارة: '+esc(application.vehicle_license_expiry||'—')+'</li></ul>' : ''}
        ${error ? '<p class="message">تعذر تحديث الحالة من قاعدة البيانات حالياً.</p>' : ''}
        <div class="share-actions">
          <button type="button" class="btn primary" id="refreshApplicationStatus">تحديث الحالة</button>
          <button type="button" class="btn outline" id="renewCaptainDocuments">تحديث / تجديد المستندات</button>
          <button type="button" class="btn outline" id="statusHome">العودة للرئيسية</button>
        </div>
      </section>
    </main>`);
  document.getElementById('refreshApplicationStatus')?.addEventListener('click',()=>captainApplicationStatusPage(knownApplicationId));
  document.getElementById('renewCaptainDocuments')?.addEventListener('click',()=>{page='apply-captain';render();});
  document.getElementById('statusHome')?.addEventListener('click',async()=>{page='trip';await loadProfile();});
}

async function applyCaptainPage() {
  const {data: existing, error: existingError} = await supabase.from('captain_applications')
    .select('id,national_id_last4,national_id_expiry,license_number,license_expiry,vehicle_license_expiry,application_status,vehicle_id,national_id_front_path,national_id_back_path,driver_license_front_path,driver_license_back_path,vehicle_license_front_path,vehicle_license_back_path,vehicle:vehicles!captain_applications_vehicle_id_fkey(id,vehicle_type,make,model,model_year,color,plate_number,passenger_capacity,has_ac,has_large_trunk,no_smoking,pets_allowed,photo_front_path,photo_side_path,photo_rear_path)')
    .eq('user_id',profile.id).maybeSingle();
  const {data:profileData}=await supabase.from('profiles').select('avatar_path').eq('id',profile.id).maybeSingle();
  if (existingError) {
    layout('<main class="wrap narrow"><section class="panel"><h2>تعذر تحميل بياناتك</h2><p class="muted">لم نتمكن من تحميل بيانات الطلب السابق.</p><button type="button" class="btn primary" id="back">العودة للرئيسية</button></section></main>');
    document.getElementById('back')?.addEventListener('click',()=>{page='home';render();});
    return;
  }
  const v=existing?.vehicle||{};
  const val=(x)=>esc(x??'');
  const selected=(x,y)=>x===y?' selected':'';
  layout(`
    <main class="wrap narrow">
      <button type="button" class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">الانضمام للكباتن</span><h1>بيانات ومستندات الكابتن</h1><p>أدخل تواريخ الصلاحية وارفع وجهي كل مستند. بعد الإرسال تراجع الإدارة المستندات وتعتمد الحساب والمركبة.</p></section>
      <form class="panel form" id="captainApplyForm">
        <h3>أولاً: بطاقة الرقم القومي</h3>
        <label>آخر 4 أرقام من الرقم القومي<input name="national_id_last4" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" required value="${val(existing?.national_id_last4)}" placeholder="1234"></label>
        <label>تاريخ انتهاء البطاقة<input name="national_id_expiry" type="date" required value="${val(existing?.national_id_expiry)}"></label>
        <label>وجه البطاقة<input name="national_id_front" type="file" accept="image/*" required></label><div class="captain-image-preview" data-preview="id-front"></div>
        <label>ظهر البطاقة<input name="national_id_back" type="file" accept="image/*" required></label><div class="captain-image-preview" data-preview="id-back"></div>
        <hr>
        <h3>ثانياً: رخصة القيادة</h3>
        <label>رقم رخصة القيادة<input name="license_number" maxlength="80" required value="${val(existing?.license_number)}" placeholder="رقم الرخصة"></label>
        <label>تاريخ انتهاء رخصة القيادة<input name="license_expiry" type="date" required value="${val(existing?.license_expiry)}"></label>
        <label>وجه رخصة القيادة<input name="driver_license_front" type="file" accept="image/*" required></label><div class="captain-image-preview" data-preview="driver-front"></div>
        <label>ظهر رخصة القيادة<input name="driver_license_back" type="file" accept="image/*" required></label><div class="captain-image-preview" data-preview="driver-back"></div>
        <hr>
        <h3>ثالثاً: رخصة السيارة</h3>
        <label>تاريخ انتهاء رخصة السيارة<input name="vehicle_license_expiry" type="date" required value="${val(existing?.vehicle_license_expiry)}"></label>
        <label>وجه رخصة السيارة<input name="vehicle_license_front" type="file" accept="image/*" required></label><div class="captain-image-preview" data-preview="vehicle-license-front"></div>
        <label>ظهر رخصة السيارة<input name="vehicle_license_back" type="file" accept="image/*" required></label><div class="captain-image-preview" data-preview="vehicle-license-back"></div>
        <hr>
        <h3>رابعاً: بيانات المركبة</h3>
        <label>نوع المركبة<select name="vehicle_type" required>
          <option value="private_car"${selected(v.vehicle_type,'private_car')}>ملاكي</option><option value="taxi"${selected(v.vehicle_type,'taxi')}>تاكسي</option><option value="suzuki"${selected(v.vehicle_type,'suzuki')}>سوزوكي</option><option value="microbus"${selected(v.vehicle_type,'microbus')}>ميكروباص</option><option value="scooter"${selected(v.vehicle_type,'scooter')}>اسكوتر</option><option value="motorcycle"${selected(v.vehicle_type,'motorcycle')}>موتوسيكل</option>
        </select></label>
        <label>الماركة<input name="make" maxlength="60" required value="${val(v.make)}" placeholder="مثال: هيونداي"></label>
        <label>الموديل<input name="model" maxlength="60" required value="${val(v.model)}" placeholder="مثال: إلنترا"></label>
        <label>سنة الصنع<input name="model_year" type="number" min="1980" max="2027" required value="${val(v.model_year)}"></label>
        <label>لون المركبة<input name="color" maxlength="40" required value="${val(v.color)}" placeholder="مثال: أبيض"></label>
        <label>رقم اللوحة<input name="plate_number" maxlength="30" required value="${val(v.plate_number)}" placeholder="رقم اللوحة"></label>
        <label>عدد الركاب (بدون السائق)<input name="passenger_capacity" type="number" min="1" max="13" value="${val(v.passenger_capacity||3)}" required></label>
        <label class="checkline"><input name="has_ac" type="checkbox"${v.has_ac?' checked':''}> يوجد تكييف</label>
        <label class="checkline"><input name="has_large_trunk" type="checkbox"${v.has_large_trunk?' checked':''}> شنطة واسعة</label>
        <label class="checkline"><input name="no_smoking" type="checkbox"${v.no_smoking!==false?' checked':''}> ممنوع التدخين داخل المركبة</label>
        <label class="checkline"><input name="pets_allowed" type="checkbox"${v.pets_allowed?' checked':''}> يسمح باصطحاب الحيوانات الأليفة</label>
        <h3>خامساً: الصور التعريفية</h3>
        <label>الصورة الشخصية<input name="profile_photo" type="file" accept="image/*"${profileData?.avatar_path?'':' required'}></label><div class="captain-image-preview" data-preview="profile"></div>
        <label>صورة أمامية للمركبة<input name="vehicle_front" type="file" accept="image/*"${v.photo_front_path?'':' required'}></label><div class="captain-image-preview" data-preview="front"></div>
        <label>صورة جانبية للمركبة<input name="vehicle_side" type="file" accept="image/*"${v.photo_side_path?'':' required'}></label><div class="captain-image-preview" data-preview="side"></div>
        <label>صورة خلفية للمركبة<input name="vehicle_rear" type="file" accept="image/*"${v.photo_rear_path?'':' required'}></label><div class="captain-image-preview" data-preview="rear"></div>
        <div class="notice">صور المستندات الرسمية تحفظ في مساحة خاصة ولا تظهر للركاب. التحقق الآلي يراجع اكتمال الصور والتواريخ فقط، ولا يثبت أصالة المستند أو صحة بياناته.</div>
        <label class="checkline"><input name="attestation" type="checkbox" required> أقر أن المستندات والبيانات المرفوعة صحيحة وتخصني أو تخص المركبة المسجلة.</label>
        <button class="btn primary" type="submit">إرسال المستندات للمراجعة / تحديثها</button>
        <p class="message" id="applyMessage" aria-live="polite"></p>
      </form>    </main>`);
  document.getElementById('back')?.addEventListener('click',()=>{page='home';render();});
  const form=document.getElementById('captainApplyForm');
  const capacityByType={private_car:3,taxi:4,suzuki:6,microbus:13,scooter:1,motorcycle:1};
  const previewFields=['profile_photo','vehicle_front','vehicle_side','vehicle_rear','national_id_front','national_id_back','driver_license_front','driver_license_back','vehicle_license_front','vehicle_license_back'];
  const previewNames={profile_photo:'profile',vehicle_front:'front',vehicle_side:'side',vehicle_rear:'rear',national_id_front:'id-front',national_id_back:'id-back',driver_license_front:'driver-front',driver_license_back:'driver-back',vehicle_license_front:'vehicle-license-front',vehicle_license_back:'vehicle-license-back'};
  previewFields.forEach(name=>{
    const input=form.elements[name], preview=form.querySelector('[data-preview="'+previewNames[name]+'"]');
    input.addEventListener('change',()=>{
      preview.replaceChildren();
      const file=input.files?.[0];
      if(!file) return;
      if(!file.type.startsWith('image/')){input.value='';return;}
      const img=document.createElement('img');img.alt='معاينة الصورة المختارة';img.src=URL.createObjectURL(file);
      img.onload=()=>URL.revokeObjectURL(img.src);preview.append(img);
    });
  });
  const typeField=form.elements.vehicle_type, capacityField=form.elements.passenger_capacity;
  typeField.addEventListener('change',()=>{capacityField.max=capacityByType[typeField.value];capacityField.value=Math.min(Number(capacityField.value)||1,capacityByType[typeField.value]);});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const d=new FormData(form), msg=document.getElementById('applyMessage'), btn=form.querySelector('button[type="submit"]');
    const today=new Date();today.setMinutes(today.getMinutes()-today.getTimezoneOffset());const todayText=today.toISOString().slice(0,10);
    const dates={national_id_expiry:String(d.get('national_id_expiry')||''),license_expiry:String(d.get('license_expiry')||''),vehicle_license_expiry:String(d.get('vehicle_license_expiry')||'')};
    if(Object.values(dates).some(x=>!x||x<=todayText)){msg.textContent='كل تواريخ الانتهاء يجب أن تكون بعد تاريخ اليوم.';return;}
    const last4=String(d.get('national_id_last4')||'').trim(),license=String(d.get('license_number')||'').trim();
    const type=String(d.get('vehicle_type')||''),capacity=Number(d.get('passenger_capacity'));
    if(!/^\d{4}$/.test(last4)||!license){msg.textContent='راجع آخر 4 أرقام ورقم رخصة القيادة.';return;}
    if(!capacityByType[type]||capacity<1||capacity>capacityByType[type]){msg.textContent='عدد الركاب أكبر من سعة نوع المركبة.';return;}
    const docNames=['national_id_front','national_id_back','driver_license_front','driver_license_back','vehicle_license_front','vehicle_license_back'];
    const docFiles=Object.fromEntries(docNames.map(n=>[n,d.get(n)]));
    if(docNames.some(n=>!(docFiles[n] instanceof File)||!docFiles[n].size)){msg.textContent='ارفع وجه وظهر البطاقة ورخصة القيادة ورخصة السيارة.';return;}
    const publicInputs={profile:d.get('profile_photo'),front:d.get('vehicle_front'),side:d.get('vehicle_side'),rear:d.get('vehicle_rear')};
    const existingPublic={profile:profileData?.avatar_path,front:v.photo_front_path,side:v.photo_side_path,rear:v.photo_rear_path};
    if(Object.entries(publicInputs).some(([k,f])=>(!(f instanceof File)||!f.size)&&!existingPublic[k])){msg.textContent='أكمل الصورة الشخصية وصور المركبة.';return;}
    const allFiles=[...Object.values(docFiles),...Object.values(publicInputs).filter(f=>f instanceof File&&f.size)];
    if(allFiles.some(f=>!f.type.startsWith('image/')||f.size>5*1024*1024)){msg.textContent='كل صورة يجب أن تكون صورة واضحة وحجمها لا يتجاوز 5 ميجابايت.';return;}
    if(!d.get('attestation')){msg.textContent='يجب تأكيد صحة البيانات والمستندات.';return;}
    btn.disabled=true;
    try{
      msg.textContent='جارٍ رفع المستندات والصور بشكل آمن...';
      const upload=async(bucket,key,file)=>{
        const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
        const path=profile.id+'/'+key+'/'+crypto.randomUUID()+'.'+ext;
        const {error}=await supabase.storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false});
        if(error) throw error;
        return path;
      };
      const media={};
      for(const [key,file] of Object.entries(publicInputs)) media[key]=(file instanceof File&&file.size)?await upload('captain-media',key,file):existingPublic[key];
      const docs={};
      for(const [key,file] of Object.entries(docFiles)) docs[key]=await upload('captain-documents',key,file);
      msg.textContent='تم رفع الصور. جارٍ إرسال الطلب لمراجعة الإدارة...';
      const {data:applicationId,error}=await supabase.rpc('submit_captain_application_v3',{
        p_national_id_last4:last4,p_national_id_expiry:dates.national_id_expiry,
        p_license_number:license,p_license_expiry:dates.license_expiry,p_vehicle_license_expiry:dates.vehicle_license_expiry,
        p_national_id_front_path:docs.national_id_front,p_national_id_back_path:docs.national_id_back,
        p_driver_license_front_path:docs.driver_license_front,p_driver_license_back_path:docs.driver_license_back,
        p_vehicle_license_front_path:docs.vehicle_license_front,p_vehicle_license_back_path:docs.vehicle_license_back,
        p_vehicle_type:type,p_make:String(d.get('make')||'').trim(),p_model:String(d.get('model')||'').trim(),
        p_model_year:Number(d.get('model_year')),p_color:String(d.get('color')||'').trim(),p_plate_number:String(d.get('plate_number')||'').trim(),
        p_passenger_capacity:capacity,p_has_ac:d.has('has_ac'),p_has_large_trunk:d.has('has_large_trunk'),
        p_no_smoking:d.has('no_smoking'),p_pets_allowed:d.has('pets_allowed'),
        p_profile_photo_path:media.profile,p_vehicle_front_path:media.front,p_vehicle_side_path:media.side,p_vehicle_rear_path:media.rear
      });
      if(error) throw error;
      page='apply-captain';
      await captainApplicationStatusPage(applicationId);
    }catch(error){msg.textContent=applicationError(error);}
    finally{btn.disabled=false;}
  });
}

function applicationError(error){
  const m=error?.message||'';
  if(m.includes('application_already_pending')) return 'لديك طلب قيد المراجعة بالفعل.';
  if(m.includes('account_not_allowed')) return 'الحساب غير مسموح له بالتقديم حالياً.';
  if(m.includes('invalid_application_data')) return 'راجع بيانات المستندات وتواريخ انتهائها وبيانات المركبة.';
  if(m.includes('captain_document_upload_missing')) return 'لم يكتمل رفع صور المستندات. أعد اختيار الصور وحاول مرة أخرى.';
  if(m.includes('captain_media_upload_missing')) return 'لم تكتمل الصور التعريفية. أعد اختيار الصور وحاول مرة أخرى.';
  if(m.includes('captain_documents_expired_or_missing')) return 'المستندات منتهية أو غير مكتملة. حدّثها وأرسلها لمراجعة الإدارة.';
  if(m.includes('vehicle_capacity_exceeded')) return 'عدد الركاب أكبر من سعة نوع المركبة.';
  return m||'تعذر إرسال المستندات. حاول مرة أخرى.';
}


async function captainSubscriptionPanel(completedTripsCount=0) {
  const {data:application}=await supabase.from('captain_applications')
    .select('application_status,national_id_expiry,license_expiry,vehicle_license_expiry')
    .eq('user_id',profile.id).maybeSingle();
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Cairo'}).format(new Date());
  const documentsReady=application?.application_status==='approved'
    && application.national_id_expiry>today
    && application.license_expiry>today
    && application.vehicle_license_expiry>today;
  const {data,error}=await supabase.from('captain_subscriptions')
    .select('id,plan_days,amount_egp,payment_reference,payment_status,starts_at,expires_at,created_at')
    .eq('captain_id',profile.id).order('created_at',{ascending:false}).limit(10);
  if(error) return {active:null,loaded:false,html:'<section class="panel" id="captainSubscriptionPanel"><h2>اشتراك الكابتن</h2><p class="message">تعذر تحميل بيانات الاشتراك حالياً.</p></section>'};
  const rows=data||[];
  const now=Date.now();
  const active=rows.find(x=>x.payment_status==='approved'&&x.starts_at&&x.expires_at&&new Date(x.starts_at).getTime()<=now&&new Date(x.expires_at).getTime()>now);
  const pending=rows.find(x=>x.payment_status==='submitted');
  const latest=rows[0];
  const status=(active
    ? '<div class="notice">اشتراكك نشط حتى '+esc(new Date(active.expires_at).toLocaleString('ar-EG'))+'.</div>'
    : '<div class="notice">لا يوجد اشتراك نشط حالياً.</div>')
    +(pending ? '<div class="notice">لديك طلب اشتراك قيد مراجعة الإدارة. لا ترسل طلباً آخر قبل انتهاء المراجعة.</div>'
      : latest?.payment_status==='rejected' ? '<div class="notice">تم رفض آخر طلب اشتراك. راجع بيانات التحويل والإثبات ثم أرسل طلباً جديداً.</div>'
      : !active ? '<p class="muted">يمكنك تقديم طلب اشتراك جديد.</p>' : '');
  const history=rows.length?'<h3>سجل الاشتراكات</h3><ul>'+rows.map(x=>'<li>'+esc(x.plan_days)+' يوم · '+esc(x.amount_egp)+' جنيه · '+(x.payment_status==='approved'?'معتمد':x.payment_status==='submitted'?'قيد المراجعة':'مرفوض')+(x.expires_at?' · ينتهي '+esc(new Date(x.expires_at).toLocaleDateString('ar-EG')):'')+'</li>').join('')+'</ul>':'';
  const form=(pending||!documentsReady)?'':`
    <form class="form" id="subscriptionForm">
      <h3>تقديم / تجديد الاشتراك</h3>
      <label>مدة الاشتراك
        <select name="plan_days" required><option value="30">30 يومًا — 150 جنيه</option><option value="90">90 يومًا — 400 جنيه</option></select>
      </label>
      <div class="subscription-transfer-box">
        <div><b>بيانات التحويل</b><p>فودافون كاش / إنستا باي</p><strong id="subscriptionTransferNumber" dir="ltr">01010530716</strong></div>
        <button type="button" class="btn outline" id="copySubscriptionNumber">نسخ الرقم</button>
        <small>حوّل قيمة الباقة المختارة: 150 جنيه لـ30 يومًا أو 400 جنيه لـ90 يومًا.</small>
      </div>
      <label>رقم مرجع التحويل<input name="payment_reference" required maxlength="120" placeholder="رقم العملية أو مرجع التحويل"></label>
      <label>إثبات الدفع (صورة أو PDF)<input name="payment_proof" id="subscriptionProofInput" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
      <div id="subscriptionProofPreview" class="subscription-proof-preview" hidden aria-live="polite"></div>
      <p class="muted">ارفع إثبات التحويل بعد الدفع خارج التطبيق. لا توجد مدفوعات إلكترونية داخل السكة.</p>
      <button class="btn primary" type="submit">إرسال طلب الاشتراك</button>
      <p class="message" id="subscriptionMessage" aria-live="polite"></p>
    </form>`;
  const earlyActivation=(Number(completedTripsCount)===0&&!active);
  const subscriptionContent=status+history+(earlyActivation
    ? '<details class="subscription-early-details"><summary>تفعيل الاشتراك مبكراً (اختياري)</summary>'+form+'</details>'
    : form);
  return {active:active||null,loaded:true,html:'<section class="panel" id="captainSubscriptionPanel"><h2>اشتراك الكابتن</h2>'+subscriptionContent+'</section>'};
}

async function captainDashboardPage() {
  const [{count:completedTripsCount,error:completedTripsCountError},{data:captainApp,error:captainAppError}]=await Promise.all([
    supabase.from('trip_requests').select('id',{count:'exact',head:true})
      .eq('accepted_captain_id',profile.id).eq('request_status','completed'),
    supabase.from('captain_applications').select('application_status,national_id_expiry,license_expiry,vehicle_license_expiry')
      .eq('user_id',profile.id).maybeSingle()
  ]);
  const docs=await captainDocumentsPanel();
  const subscriptionState=await captainSubscriptionPanel(completedTripsCount||0);
  const subscription=subscriptionState.html;
  const cairoToday=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Cairo'}).format(new Date());
  const trialEligible=!completedTripsCountError&&!captainAppError
    && captainApp?.application_status==='approved'
    && captainApp.national_id_expiry>cairoToday
    && captainApp.license_expiry>cairoToday
    && captainApp.vehicle_license_expiry>cairoToday
    && (completedTripsCount||0)===0;
  const [{data:vehicles, error:vehicleError},{data:requests,error:requestError},{data:activeTrips,error:activeTripError}]=await Promise.all([
    supabase.from('vehicles')
      .select('id,vehicle_type,make,model,color,plate_number,passenger_capacity,is_active')
      .eq('captain_id',profile.id).eq('approval_status','approved'),
    supabase.from('trip_requests')
      .select('id,vehicle_type,origin_name,destination_name,passenger_count,fixed_fare_egp,is_scheduled,scheduled_at,created_at,pickup_note,ride_preferences')
      .eq('request_status','searching').neq('passenger_id',profile.id)
      .order('created_at',{ascending:true}).limit(30),
    supabase.from('trip_requests')
      .select('id,origin_name,destination_name,request_status,fixed_fare_egp,created_at')
      .eq('accepted_captain_id',profile.id).in('request_status',['accepted','in_progress'])
      .order('created_at',{ascending:false}).limit(10)
  ]);
  const availableVehicles=(vehicles||[]).filter(vehicle=>vehicle.is_active||trialEligible);
  const showFirstTripOffer=trialEligible&&subscriptionState.loaded&&!subscriptionState.active;
  const showPostTrialSubscription=(subscriptionState.loaded&&Number(completedTripsCount||0)>=1&&!subscriptionState.active);
  const firstTripOffer=showFirstTripOffer
    ? '<section class="panel first-trip-free-card"><div class="first-trip-free-icon">🎁</div><h2>مشوارك الأول مجاني 100%</h2><p>اقبل أول طلب من قائمة المشاوير المتاحة بالأسفل وجرّب السكة مجاناً بدون اشتراك!</p></section>'
    : '';
  const postTrialNotice=showPostTrialSubscription
    ? '<section class="panel post-trial-subscription-notice"><h2>اشتراك الكابتن</h2><p>أتممت مشوارك التجريبي بنجاح! فعّل اشتراكك الشهري الآن (150 ج / شهر أو 400 ج / 3 شهور) لمواصلة استقبال الطلبات.</p></section>'
    : '';
  const activeTripCards=(activeTrips||[]).map(trip=>`<article class="fixed-trip-card active-captain-trip">
    <div class="fixed-trip-card-head"><b>${trip.request_status==='in_progress'?'رحلة جارية':'رحلة مقبولة'}</b><strong>${Number(trip.fixed_fare_egp||0).toLocaleString('ar-EG')} جنيه</strong></div>
    <p><b>من:</b> ${esc(trip.origin_name)}</p><p><b>إلى:</b> ${esc(trip.destination_name)}</p>
    <button type="button" class="btn primary" data-captain-open-trip="${esc(trip.id)}">فتح الرحلة والتواصل</button>
  </article>`).join('')||'<div class="notice">لا توجد رحلات مقبولة أو جارية حاليًا.</div>';
  const requestCards=requestError
    ? '<p class="message">تعذر تحميل الطلبات المفتوحة. تأكد من اعتماد المستندات والاشتراك النشط.</p>'
    : (requests||[]).length
      ? requests.map(request=>{
          const matching=availableVehicles.filter(vehicle=>vehicle.vehicle_type===request.vehicle_type&&vehicle.passenger_capacity>=request.passenger_count);
          const preference=request.ride_preferences||{};
          const preferenceLabels=[
            preference.quiet?'🤫 رحلة هادية':null,
            preference.ac?'❄️ تكييف':null,
            preference.luggage?'🧳 شنط':null
          ].filter(Boolean);
          const vehicleOptions=matching.map(vehicle=>{
            const label=[vehicle.make,vehicle.model,vehicle.color,vehicle.plate_number].filter(Boolean).join(' · ')||'مركبة معتمدة';
            return '<option value="'+esc(vehicle.id)+'">'+esc(label)+'</option>';
          }).join('');
          return `<article class="fixed-trip-card">
            <div class="fixed-trip-card-head"><b>طلب مشوار جديد</b><strong>${Number(request.fixed_fare_egp||0).toLocaleString('ar-EG')} جنيه</strong></div>
            <p><b>من:</b> ${esc(request.origin_name)}</p>
            <p><b>إلى:</b> ${esc(request.destination_name)}</p>
            <p><b>المركبة:</b> ${esc(({private_car:'ملاكي',taxi:'تاكسي',suzuki:'سوزوكي',microbus:'ميكروباص',scooter:'اسكوتر',motorcycle:'دراجة نارية'})[request.vehicle_type]||request.vehicle_type)} · <b>الركاب:</b> ${esc(request.passenger_count)}</p>
            ${request.is_scheduled?'<p><b>موعد محدد:</b> '+esc(request.scheduled_at?new Date(request.scheduled_at).toLocaleString('ar-EG'):'')+'</p>':'<p class="muted">مشوار فوري</p>'}
            ${request.pickup_note?'<p><b>ملاحظة الركوب:</b> '+esc(request.pickup_note)+'</p>':''}
            ${preferenceLabels.length?'<div class="fixed-trip-preferences">'+preferenceLabels.map(item=>'<span>'+item+'</span>').join('')+'</div>':'<small class="muted">لا توجد تفضيلات إضافية.</small>'}
            ${matching.length?`<label>اختر مركبتك<select id="fixedVehicle-${esc(request.id)}">${vehicleOptions}</select></label>`:'<div class="notice">لا توجد مركبة معتمدة ونشطة من نفس الفئة وبسعة كافية لقبول الطلب.</div>'}
            <button type="button" class="btn primary" data-accept-fixed-trip="${esc(request.id)}" ${matching.length?'':'disabled'}>اقبل المشوار</button>
          </article>`;
        }).join('')
      : '<div class="notice">مفيش طلبات مشاوير مفتوحة حاليًا. هنظهر هنا الطلبات المناسبة لمركباتك المعتمدة.</div>';
  const requestsSection=`<section class="panel">
    <div class="fixed-trip-section-head"><div><h2>طلبات المشاوير المتاحة</h2><p class="muted">اقبل الطلب المناسب لمركبتك. السعر محدد مسبقًا ولا يوجد تفاوض.</p></div><button type="button" class="btn outline" id="refreshFixedTrips">تحديث</button></div>
    <div class="fixed-trip-list">${requestCards}</div>
    ${vehicleError?'<p class="message">تعذر تحميل مركباتك المعتمدة.</p>':''}
  </section>`;
  const retainedSubscriptionPanel=preserveCaptainSubscriptionPanel?document.getElementById('captainSubscriptionPanel'):null;
  const captainAccountPage=page==='captain-account';
  layout(`
    <main class="wrap narrow captain-workspace">
      <section class="hero compact"><span class="tag">${captainAccountPage?'حساب الكابتن':'مركز تشغيل الكابتن'}</span><h1>${captainAccountPage?'اشتراكي ومستنداتي':'طلبات المشاوير'}</h1><p>${captainAccountPage?'تابع اعتماد مستنداتك واشتراكك لتظل جاهزاً لاستقبال الطلبات.':'راجع الطلبات المناسبة لمركبتك وتابع رحلاتك الحالية.'}</p></section>
      ${captainAccountPage?`${postTrialNotice}${showPostTrialSubscription?subscription:''}${docs}${!showPostTrialSubscription&&!showFirstTripOffer?subscription:''}${showFirstTripOffer?'<section class="panel notice">يمكنك تفعيل الاشتراك مبكراً إذا رغبت، لكن أول مشوار تجريبي متاح لك مجاناً.</section>':''}`: `${firstTripOffer}${showFirstTripOffer?requestsSection:''}
      <section class="panel"><div class="fixed-trip-section-head"><div><h2>رحلاتك الحالية</h2><p class="muted">تابع الرحلات المقبولة وابدأها أو أنهها من شاشة الرحلة.</p></div></div><div class="fixed-trip-list">${activeTripError?'<p class="message">تعذر تحميل رحلاتك الحالية.</p>':activeTripCards}</div></section>
      ${showFirstTripOffer?'':requestsSection}`}
    </main>`);
  if(retainedSubscriptionPanel){const freshPanel=document.getElementById('captainSubscriptionPanel');if(freshPanel)freshPanel.replaceWith(retainedSubscriptionPanel);}
  document.getElementById('captainHome')?.addEventListener('click',()=>{page='captain';render();});
  document.getElementById('refreshFixedTrips')?.addEventListener('click',()=>captainDashboardPage());
  document.querySelectorAll('[data-captain-open-trip]').forEach(button=>button.addEventListener('click',()=>{currentTripId=button.dataset.captainOpenTrip;page='trip-status';render();}));
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;render();}));
  document.querySelectorAll('[data-accept-fixed-trip]').forEach(button=>button.addEventListener('click',async()=>{
    const requestId=button.dataset.acceptFixedTrip;
    const vehicleId=document.getElementById('fixedVehicle-'+requestId)?.value;
    if(!vehicleId)return;
    button.disabled=true;button.textContent='جارٍ قبول المشوار...';
    const {data,error}=await supabase.rpc('captain_accept_fixed_trip',{p_request_id:requestId,p_vehicle_id:vehicleId});
    if(error){
      const message=error.message||'تعذر قبول المشوار.';
      button.disabled=false;button.textContent='اقبل المشوار';
      alert(message.includes('active_subscription_required')?'الاشتراك غير نشط. راجع قسم الاشتراك.':message.includes('request_not_available')||message.includes('request_already_taken')?'الطلب اتقبل بواسطة كابتن آخر أو لم يعد متاحًا.':message.includes('approved_active_vehicle_required')?'المركبة غير معتمدة أو غير نشطة.':message.includes('trip_requests_one_active_trip_per_captain_idx')?'عندك رحلة مقبولة أو جارية بالفعل. أنهِها أولاً قبل قبول رحلة جديدة.':'تعذر قبول الطلب. راجع بيانات المركبة والاشتراك.');
      return;
    }
    if(data===true){alert('تم قبول المشوار.');await captainDashboardPage();}
    else{button.disabled=false;button.textContent='اقبل المشوار';alert('لم يتم قبول المشوار. حاول تحديث الطلبات.');}
  }));
  document.getElementById('copySubscriptionNumber')?.addEventListener('click',async()=>{
    const number=document.getElementById('subscriptionTransferNumber')?.textContent?.trim();
    if(!number)return;
    const button=document.getElementById('copySubscriptionNumber');
    try{await navigator.clipboard.writeText(number);button.textContent='تم النسخ ✓';}
    catch(_){window.prompt('انسخ رقم التحويل:',number);}
  });
  const proofInput=document.getElementById('subscriptionProofInput');
  proofInput?.addEventListener('change',()=>{
    const file=proofInput.files?.[0],preview=document.getElementById('subscriptionProofPreview');
    if(!preview)return;
    if(!file){preview.hidden=true;preview.innerHTML='';return;}
    const isImage=file.type.startsWith('image/');
    const imageUrl=isImage?URL.createObjectURL(file):'';
    preview.hidden=false;
    preview.innerHTML=(isImage?'<img src="'+esc(imageUrl)+'" alt="معاينة إثبات الدفع">':'<span class="proof-file-icon">PDF</span>')+'<div><b>'+esc(file.name)+'</b><small>'+ (file.size/1024/1024).toFixed(2)+' ميجابايت · محفوظ حتى إرسال الطلب</small></div>';
  });
  document.getElementById('subscriptionForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,d=new FormData(form),msg=document.getElementById('subscriptionMessage'),btn=form.querySelector('button[type="submit"]');
    const file=d.get('payment_proof');
    if(!(file instanceof File)||!file.size){msg.textContent='اختر صورة أو ملف PDF لإثبات الدفع.';return;}
    if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){msg.textContent='الملف يجب أن يكون صورة JPG أو PNG أو WEBP أو PDF ولا يتجاوز 5 ميجابايت.';return;}
    const reference=String(d.get('payment_reference')||'').trim();
    if(!reference){msg.textContent='أدخل مرجع التحويل.';return;}
    btn.disabled=true;let uploadedPath=null;
    try{
      msg.textContent='جارٍ رفع إثبات الدفع بشكل خاص...';
      const ext=file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
      uploadedPath=profile.id+'/subscription/'+crypto.randomUUID()+'.'+ext;
      const {error:uploadError}=await supabase.storage.from('captain-payment-proofs').upload(uploadedPath,file,{contentType:file.type,upsert:false});
      if(uploadError)throw uploadError;
      const {error:rpcError}=await supabase.rpc('submit_subscription',{p_plan_days:Number(d.get('plan_days')),p_payment_reference:reference,p_proof_path:uploadedPath});
      if(rpcError)throw rpcError;
      preserveCaptainSubscriptionPanel=false;
      await captainDashboardPage();
      preserveCaptainSubscriptionPanel=true;
    }catch(error){
      if(uploadedPath)await supabase.storage.from('captain-payment-proofs').remove([uploadedPath]);
      const m=error?.message||'';
      msg.textContent=m.includes('subscription_already_pending')?'لديك طلب اشتراك قيد المراجعة بالفعل.':m.includes('valid_captain_documents_required')?'يجب اعتماد طلب الكابتن وصلاحية المستندات أولاً.':m.includes('payment_proof_not_owned_or_missing')?'تعذر التحقق من إثبات الدفع. أعد المحاولة.':m||'تعذر إرسال طلب الاشتراك.';
    }finally{btn.disabled=false;}
  });
}

async function adminApplicationsPage(){
  const {data:applications,error:appError}=await supabase.from('captain_applications')
    .select('id,user_id,national_id_last4,national_id_expiry,license_number,license_expiry,vehicle_license_expiry,application_status,created_at,national_id_front_path,national_id_back_path,driver_license_front_path,driver_license_back_path,vehicle_license_front_path,vehicle_license_back_path,profile:profiles!captain_applications_user_id_fkey(display_name,avatar_path),vehicle:vehicles!captain_applications_vehicle_id_fkey(vehicle_type,make,model,model_year,color,plate_number,passenger_capacity,photo_front_path,photo_side_path,photo_rear_path)')
    .in('application_status',['pending','suspended']).order('created_at',{ascending:true});
  const {data:subscriptions,error:subError}=await supabase.from('captain_subscriptions')
    .select('id,captain_id,plan_days,amount_egp,payment_reference,payment_proof_path,payment_status,created_at')
    .eq('payment_status','submitted').order('created_at',{ascending:true});
  const docLabels=[
    ['national_id_front_path','وجه البطاقة'],['national_id_back_path','ظهر البطاقة'],
    ['driver_license_front_path','وجه رخصة القيادة'],['driver_license_back_path','ظهر رخصة القيادة'],
    ['vehicle_license_front_path','وجه رخصة السيارة'],['vehicle_license_back_path','ظهر رخصة السيارة']
  ];
  const appCards=[];
  for(const a of applications||[]){
    const links=[];
    const profilePath=a.profile?.avatar_path;
    if(profilePath){const {data:signed}=await supabase.storage.from('captain-media').createSignedUrl(profilePath,300);if(signed?.signedUrl)links.push('<a class="btn outline" target="_blank" rel="noopener" href="'+esc(signed.signedUrl)+'">الصورة الشخصية</a>');}
    for(const [field,label] of docLabels){
      const path=a[field];
      if(!path) continue;
      const {data:signed}=await supabase.storage.from('captain-documents').createSignedUrl(path,300);
      if(signed?.signedUrl) links.push('<a class="btn outline" target="_blank" rel="noopener" href="'+esc(signed.signedUrl)+'">'+label+'</a>');
    }
    const v=a.vehicle||{};
    for(const [path,label] of [[v.photo_front_path,'صورة المركبة الأمامية'],[v.photo_side_path,'صورة المركبة الجانبية'],[v.photo_rear_path,'صورة المركبة الخلفية']]){if(path){const {data:signed}=await supabase.storage.from('captain-media').createSignedUrl(path,300);if(signed?.signedUrl)links.push('<a class="btn outline" target="_blank" rel="noopener" href="'+esc(signed.signedUrl)+'">'+label+'</a>');}}
    appCards.push('<article class="panel"><h3>طلب كابتن · '+esc(a.profile?.display_name||a.user_id.slice(0,8))+'</h3><p>الحالة: '+esc(a.application_status==='suspended'?'موقوف — يحتاج مراجعة':'قيد المراجعة')+'</p><p>تاريخ الطلب: '+esc(new Date(a.created_at).toLocaleString('ar-EG'))+'</p><p>آخر 4 أرقام: '+esc(a.national_id_last4)+' · انتهاء البطاقة: '+esc(a.national_id_expiry)+'</p><p>رخصة القيادة: '+esc(a.license_number)+' · تنتهي: '+esc(a.license_expiry)+'</p><p>رخصة المركبة تنتهي: '+esc(a.vehicle_license_expiry)+'</p><p>المركبة: '+esc([v.make,v.model,v.model_year,v.color].filter(Boolean).join(' '))+' · '+esc(v.vehicle_type||'')+' · اللوحة: '+esc(v.plate_number||'')+' · السعة: '+esc(v.passenger_capacity||'')+'</p><div class="share-actions">'+links.join(' ')+'</div><label>ملاحظات الإدارة<textarea data-notes="'+esc(a.id)+'" maxlength="1000" rows="2" placeholder="ملاحظات اختيارية"></textarea></label><div class="share-actions"><button class="btn primary" data-review-app="'+esc(a.id)+'" data-decision="approved">اعتماد الكابتن والمركبة</button><button class="btn outline" data-review-app="'+esc(a.id)+'" data-decision="rejected">رفض الطلب</button></div></article>');
  }
  const subCards=[];
  for(const sub of subscriptions||[]){
    const {data:signed}=await supabase.storage.from('captain-payment-proofs').createSignedUrl(sub.payment_proof_path,300);
    const proof=signed?.signedUrl?'<a class="btn outline" target="_blank" rel="noopener" href="'+esc(signed.signedUrl)+'">فتح إثبات الدفع</a>':'<span class="muted">تعذر فتح الإثبات</span>';
    subCards.push('<article class="panel"><h3>اشتراك كابتن · '+esc(sub.captain_id.slice(0,8))+'</h3><p>'+esc(sub.plan_days)+' يوم · '+esc(sub.amount_egp)+' جنيه</p><p>مرجع التحويل: '+esc(sub.payment_reference)+'</p><p>تاريخ الطلب: '+esc(new Date(sub.created_at).toLocaleString('ar-EG'))+'</p>'+proof+'<div class="share-actions"><button class="btn primary" data-sub-approve="'+esc(sub.id)+'">اعتماد الاشتراك</button><button class="btn outline" data-sub-reject="'+esc(sub.id)+'">رفض الاشتراك</button></div></article>');
  }
  layout(`
    <main class="wrap narrow">
      <button type="button" class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">إدارة المنصة</span><h1>مراجعة الكباتن والاشتراكات</h1><p>راجع المستندات وإثباتات الدفع بنفسك قبل اعتماد نشاط القيادة أو الاشتراك.</p></section>
      <section><h2>طلبات الكباتن ${(applications||[]).length}</h2>${appError?'<p class="message">تعذر تحميل طلبات الكباتن.</p>':appCards.join('')||'<section class="panel"><p class="muted">لا توجد طلبات كابتن قيد المراجعة.</p></section>'}</section>
      <section><h2>طلبات الاشتراك ${(subscriptions||[]).length}</h2>${subError?'<p class="message">تعذر تحميل طلبات الاشتراك.</p>':subCards.join('')||'<section class="panel"><p class="muted">لا توجد طلبات اشتراك قيد المراجعة.</p></section>'}</section>
    </main>`);
  document.getElementById('back')?.addEventListener('click',()=>{page='home';render();});
  document.querySelectorAll('[data-review-app]').forEach(btn=>btn.addEventListener('click',async()=>{
    const id=btn.dataset.reviewApp,decision=btn.dataset.decision;
    const relatedButtons=[...document.querySelectorAll('[data-review-app="'+id+'"]')];
    relatedButtons.forEach(item=>item.disabled=true);
    const notes=document.querySelector('[data-notes="'+id+'"]')?.value||null;
    const {error}=await supabase.rpc('review_captain_application_v2',{p_application_id:id,p_decision:decision,p_admin_notes:notes});
    if(error){alert('تعذر تنفيذ مراجعة الطلب: '+error.message);relatedButtons.forEach(item=>item.disabled=false);return;}
    await adminApplicationsPage();
  }));
  document.querySelectorAll('[data-sub-approve]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    const {error}=await supabase.rpc('admin_approve_subscription',{p_subscription_id:btn.dataset.subApprove});
    if(error){alert('تعذر اعتماد الاشتراك: '+error.message);btn.disabled=false;return;}
    await adminApplicationsPage();
  }));
  document.querySelectorAll('[data-sub-reject]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    const {error}=await supabase.rpc('admin_reject_subscription',{p_subscription_id:btn.dataset.subReject});
    if(error){alert('تعذر رفض الاشتراك: '+error.message);btn.disabled=false;return;}
    await adminApplicationsPage();
  }));
}

function placeholder(title, desc) {
  layout(`
    <main class="wrap narrow">
      <button type="button" class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">السكة · المرحلة التالية</span><h1>${title}</h1><p>${desc}</p></section>
      <section class="panel"><div class="notice">سيتم توصيل هذه الوظائف بعد استكمال اختبارات الأمان وقاعدة البيانات.</div></section>
    </main>`);
  document.querySelector('#back').addEventListener('click', () => { page = 'home'; render(); });
}

function disposeLiveUi(){
  activeChatChannels.forEach(channel=>{try{supabase?.removeChannel(channel);}catch(_){}});
  activeTripChannels.forEach(channel=>{try{supabase?.removeChannel(channel);}catch(_){}});
  activeChatChannels=[];activeTripChannels=[];
  window.__sekkaReloadShareBookings=null;
  if(publicTrackingTimer){clearInterval(publicTrackingTimer);publicTrackingTimer=null;}
  if(publicTrackingMap){try{publicTrackingMap.remove();}catch(_){}publicTrackingMap=null;publicTrackingMarker=null;}
  if(captainLocationWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(captainLocationWatchId);captainLocationWatchId=null;}
}


async function tripsPage(){
  const {data:rows,error}=await supabase.from('trip_requests')
    .select('id,origin_name,destination_name,request_status,fixed_fare_egp,created_at,is_scheduled,scheduled_at')
    .eq('passenger_id',profile.id).order('created_at',{ascending:false}).limit(40);
  const cards=(rows||[]).map(trip=>`<article class="trip-history-card">
    <div class="trip-history-top"><span class="trip-role-pill">راكب</span><b>${esc(tripStatusLabel(trip.request_status))}</b></div>
    <div class="trip-history-route"><p><small>من</small><strong>${esc(trip.origin_name||'—')}</strong></p><span>←</span><p><small>إلى</small><strong>${esc(trip.destination_name||'—')}</strong></p></div>
    <div class="trip-history-meta"><span>${Number(trip.fixed_fare_egp||0).toLocaleString('ar-EG')} جنيه</span><span>${new Date(trip.created_at).toLocaleDateString('ar-EG')}</span><span>${trip.is_scheduled?'مجدول':'فوري'}</span></div>
    <button type="button" class="btn outline" data-history-trip="${esc(trip.id)}">تفاصيل الرحلة</button>
  </article>`).join('');
  layout(`<main class="wrap narrow page-workspace"><section class="hero compact"><span class="tag">سجلّك على السكة</span><h1>مشاويري</h1><p>كل المشاوير التي طلبتها من حساب الراكب في مكان واحد.</p></section>
    ${error?'<section class="panel"><p class="message">تعذر تحميل الرحلات. حاول تحديث الصفحة.</p></section>':''}
    <section class="trip-history-list">${cards||'<section class="panel empty-state"><div>🧭</div><h3>لسه مفيش مشاوير</h3><p class="muted">أول مشوار تطلبه هيظهر هنا وتقدر ترجع لتفاصيله في أي وقت.</p><button class="btn primary" id="startFirstRide">اطلب مشوار</button></section>'}</section></main>`);
  document.querySelectorAll('[data-history-trip]').forEach(button=>button.addEventListener('click',()=>{currentTripId=button.dataset.historyTrip;page='trip-status';render();}));
  document.getElementById('startFirstRide')?.addEventListener('click',()=>{page='trip';render();});
}

async function profilePage(){
  const [{data:captainApp},{data:activeSubscription}]=(profile.account_type==='captain'||profile.role==='captain')?await Promise.all([
    supabase.from('captain_applications').select('application_status').eq('user_id',profile.id).maybeSingle(),
    supabase.from('captain_subscriptions').select('expires_at,payment_status').eq('captain_id',profile.id).eq('payment_status','approved').order('expires_at',{ascending:false}).limit(1).maybeSingle()
  ]):[{data:null},{data:null}];
  const name=profile.display_name||'مستخدم السكة';
  const roleLabel=profile.role==='admin'?'مدير المنصة':profile.account_type==='captain'?'كابتن':'راكب';
  layout(`<main class="wrap narrow page-workspace">
    <section class="profile-hero"><div class="profile-avatar">${esc(name.slice(0,1))}</div><div><span class="tag">حسابي الشخصي</span><h1>${esc(name)}</h1><p>${esc(session?.user?.email||'')}</p><span class="profile-role-pill">${roleLabel}</span></div></section>
    <section class="panel profile-section"><h2>بيانات الحساب</h2>
      <div class="profile-info-row"><span>الاسم الظاهر</span><b>${esc(name)}</b></div>
      <div class="profile-info-row"><span>البريد الإلكتروني</span><b dir="ltr">${esc(session?.user?.email||'—')}</b></div>      <div class="profile-info-row"><span>نوع الحساب</span><b>${roleLabel}</b></div>
      ${profile.is_blocked?'<div class="notice">الحساب موقوف حاليًا. تواصل مع الإدارة للمراجعة.</div>':''}
    </section>
    ${profile.account_type==='captain'?'<section class="panel profile-section"><h2>حالة الكابتن</h2><div class="profile-info-row"><span>طلب الانضمام</span><b>'+esc(captainApp?.application_status==='approved'?'معتمد':captainApp?.application_status==='pending'?'قيد المراجعة':captainApp?.application_status==='suspended'?'موقوف':'غير مكتمل')+'</b></div><div class="profile-info-row"><span>الاشتراك</span><b>'+esc(activeSubscription?.expires_at&&new Date(activeSubscription.expires_at)>new Date()?'نشط حتى '+new Date(activeSubscription.expires_at).toLocaleDateString('ar-EG'):'لا يوجد اشتراك نشط')+'</b></div></section>':''}
    <section class="profile-actions-grid">
      <button class="profile-action" id="openRewards"><span>🎁</span><b>النقاط والمكافآت</b><small>الدعوات والخصومات وأيام المكافأة</small></button>
      ${profile.account_type!=='captain'?'<button class="profile-action" id="openTrips"><span>🧾</span><b>سجل الرحلات</b><small>راجع مشاويرك السابقة والحالية</small></button>':''}
      ${profile.role==='admin'?'<button class="profile-action" id="openAdminProfile"><span>⚙️</span><b>إدارة المنصة</b><small>طلبات الكباتن والاشتراكات</small></button>':''}
    </section>
    <section class="panel profile-section theme-preference-panel"><h2>مظهر التطبيق</h2><p class="muted">اختار التبديل التلقائي حسب وقت هاتفك أو ثبّت الوضع اللي يناسبك.</p><div class="theme-mode-options"><button type="button" data-theme-mode="auto">تلقائي ☀️🌙</button><button type="button" data-theme-mode="day">نهاري ☀️</button><button type="button" data-theme-mode="night">ليلي 🌙</button></div></section>
     <section class="panel profile-section"><h2>الأمان والخصوصية</h2><p class="muted">التواصل بين أطراف الرحلة يتم داخل التطبيق. أرقام الهواتف لا تظهر للطرف الآخر.</p><button class="btn outline" id="profileLogout">تسجيل الخروج</button></section>
  </main>`);
  document.querySelectorAll('[data-theme-mode]').forEach(button=>button.addEventListener('click',()=>{try{localStorage.setItem(APP_THEME_KEY,button.dataset.themeMode);}catch(_){}applyAppTheme();document.querySelectorAll('[data-theme-mode]').forEach(x=>x.classList.toggle('active',x===button));}));
  const savedTheme=(()=>{try{return localStorage.getItem(APP_THEME_KEY)||'auto';}catch(_){return 'auto';}})();
  document.querySelectorAll('[data-theme-mode]').forEach(button=>button.classList.toggle('active',button.dataset.themeMode===savedTheme));
  document.getElementById('openRewards')?.addEventListener('click',()=>{page='rewards';render();});
  document.getElementById('openTrips')?.addEventListener('click',()=>{page='trips';render();});
  document.getElementById('openAdminProfile')?.addEventListener('click',()=>{page='admin';render();});
  document.getElementById('profileLogout')?.addEventListener('click',async()=>{await supabase.auth.signOut();});
}

async function rewardsPage() {
  const [{data:profileRow,error:profileError},{data:invites,error:invitesError},{data:myReferral,error:myReferralError},{data:pointsRows},{data:rewardRows}] = await Promise.all([
    supabase.from('profiles').select('referral_code,points,captain_reward_days_balance,captain_referral_progress,discounted_trips_count,role').eq('id',profile.id).single(),
    supabase.from('referrals').select('id,referred_id,referred_role,status,captain_progress,created_at').eq('referrer_id',profile.id).order('created_at',{ascending:false}).limit(50),
    supabase.from('referrals').select('id,referrer_id,referrer_role,referred_role,status,captain_progress,created_at').eq('referred_id',profile.id).maybeSingle(),
    supabase.from('points_ledger').select('points_delta,reason,created_at').eq('user_id',profile.id).order('created_at',{ascending:false}).limit(20),
    supabase.from('rewards_ledger').select('reward_type,quantity,description,created_at').eq('beneficiary_id',profile.id).order('created_at',{ascending:false}).limit(20)
  ]);
  const row=profileRow||profile;
  const inviteUrl=window.location.origin+'/?ref='+encodeURIComponent(row.referral_code||'');
  const inviteList=(invites||[]).map((r,i)=>'<article class="reward-invite"><b>دعوة رقم '+(i+1)+'</b><small>'+new Date(r.created_at).toLocaleDateString('ar-EG')+'</small><span>'+(r.referred_role==='captain'?'كابتن':'راكب')+'</span><strong>'+(r.status==='completed'?'مكتملة':r.referred_role==='captain'?'التقدم '+Number(r.captain_progress||0)+'/5':'في انتظار أول رحلة مكتملة')+'</strong></article>').join('');
  const myProgress=myReferral
    ? '<div class="notice">تم تسجيل كود دعوة من '+(myReferral.referrer_role==='captain'?'كابتن':'راكب')+' · '+(myReferral.referred_role==='captain'?'تقدمك '+Number(myReferral.captain_progress||0)+'/5 رحلات':'خصم الدعوة متاح لأول 3 رحلات مؤهلة')+'</div>'
    : '';
  const pointsHistory=(pointsRows||[]).map(x=>'<li><b>'+(x.points_delta>0?'+':'')+x.points_delta+' نقطة</b><small>'+esc(x.reason)+' · '+new Date(x.created_at).toLocaleDateString('ar-EG')+'</small></li>').join('');
  const rewardHistory=(rewardRows||[]).map(x=>'<li><b>'+(x.reward_type==='free_days'?x.quantity+' يوم مجاني':x.quantity+' نقطة')+'</b><small>'+esc(x.description)+' · '+new Date(x.created_at).toLocaleDateString('ar-EG')+'</small></li>').join('');
  layout(`
    <main class="wrap narrow">
      <button class="back" id="backRewards">← الرئيسية</button>
      <section class="hero compact"><span class="tag">SEKKA REWARDS</span><h1>الدعوات والمكافآت 🎁</h1><p>ادعُ أصحابك واجمع النقاط وأيام الاشتراك المجانية.</p></section>
      ${profileError||invitesError||myReferralError?'<section class="panel"><p class="message">تعذر تحميل بعض بيانات المكافآت. حاول مرة أخرى.</p></section>':''}
      ${myProgress}
      <section class="panel referral-code-panel">
        <h2>كود دعوتك الموحد</h2><div class="referral-code-value">${esc(row.referral_code||'—')}</div>
        <p class="muted">الكود صالح لدعوة راكب أو كابتن.</p>
        <button class="btn primary" id="copyReferralCode">نسخ كود الدعوة</button>
        <button class="btn outline" id="shareReferralLink">مشاركة رابط الدعوة</button>
      </section>
      <section class="reward-stats">
        <article class="panel"><small>نقاطك</small><strong>${Number(row.points||0)}</strong></article>
        <article class="panel"><small>أيام مجانية معلّقة</small><strong>${Number(row.captain_reward_days_balance||0)}</strong></article><article class="panel"><small>الرحلات المخفضة للمكافأة</small><strong>${Number(row.discounted_trips_count||0)}/3</strong></article>
        ${row.role==='captain'?'<article class="panel"><small>تقدم دعوة الكابتن</small><strong>'+Number(row.captain_referral_progress||0)+'/5</strong></article>':''}
      </section>
      <section class="panel"><h2>الأشخاص الذين دعوتهم</h2>${inviteList||'<p class="muted">لم تسجل دعوات حتى الآن. شارك كودك مع أصدقائك.</p>'}</section>
      <section class="panel"><h2>سجل المكافآت</h2><ul class="reward-history">${rewardHistory||'<li class="muted">لا توجد مكافآت مسجلة حتى الآن.</li>'}</ul></section>
      <section class="panel"><h2>حركة النقاط</h2><ul class="reward-history">${pointsHistory||'<li class="muted">لا توجد حركة نقاط حتى الآن.</li>'}</ul><p class="muted">كل 100 نقطة تمنح خصمًا 15% بحد أقصى 15 جنيهًا. خصم الدعوة والنقاط لا يجتمعان، ويُطبّق الأفضل تلقائيًا. يحصل الكابتن على يوم مجاني كل 3 رحلات مخفضة، وبحد أقصى 10 أيام مجانية في الشهر.</p></section>
    </main>`);
  document.getElementById('backRewards')?.addEventListener('click',()=>{page='home';render();});
  document.getElementById('copyReferralCode')?.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(row.referral_code);document.getElementById('copyReferralCode').textContent='تم النسخ ✓';}
    catch(_){window.prompt('انسخ كود الدعوة:',row.referral_code);}
  });
  document.getElementById('shareReferralLink')?.addEventListener('click',async()=>{
    if(navigator.share){try{await navigator.share({title:'انضم إلى السكة',text:'سجل في السكة باستخدام كود دعوتي',url:inviteUrl});}catch(_){}}
    else {try{await navigator.clipboard.writeText(inviteUrl);document.getElementById('shareReferralLink').textContent='تم نسخ الرابط ✓';}catch(_){window.prompt('انسخ رابط الدعوة:',inviteUrl);}}
  });
}

function render() {
  disposeLiveUi();
  try {
    if (session && VALID_PAGES.has(page) && page !== 'track') sessionStorage.setItem(PAGE_STORAGE_KEY, page);
    else if (!session) sessionStorage.removeItem(PAGE_STORAGE_KEY);
  } catch (_) {}
  if (!supabase) return setup();
  if (page === 'track' && publicTrackingToken) return publicTrackingPage(publicTrackingToken);
  if (!session) return auth();
  if(profile){
    const type=profile.account_type||(profile.role==='captain'?'captain':profile.role==='admin'?'admin':'rider');
    const allowed=type==='admin'
      ?['admin','profile']
      :type==='captain'
        ?['captain','share','captain-account','apply-captain','profile','rewards','trip-status']
        :['home','trip','trip-search','trip-options','share','trips','profile','rewards','trip-status'];
    if(!allowed.includes(page))page=type==='admin'?'admin':type==='captain'?'share':'trip';
  }
  if (page === 'trip-status') return tripStatusPage(currentTripId);
  if (page === 'captain-account') return captainDashboardPage();
  if (page === 'home') return profile?.account_type==='captain'?(page='share',shareHome()):(page='trip',riderStartPage());
  if (page === 'rewards') return rewardsPage();
  if (page === 'trips') return tripsPage();
  if (page === 'profile') return profilePage();
  if (page === 'trip') return riderStartPage();
  if (page === 'trip-search') return riderSearchPage();
  if (page === 'trip-options') return tripForm();
  if (page === 'share') return shareHome();
  if (page === 'apply-captain') return applyCaptainPage();
  if (page === 'admin') return (profile?.account_type === 'admin' || profile?.role === 'admin') ? adminApplicationsPage() : (page='home',render());
  if (page === 'captain') return profile?.account_type === 'captain' ? (page='share',shareHome()) : (page='home',render());
  page = 'home'; home();
}

async function init() {
  if (!supabase) return render();
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) await loadProfile(); else render();
  supabase.auth.onAuthStateChange((_event, next) => {
    session = next;
    if (next) loadProfile();
    else {
      stopPassengerBookingUpdates();
      profile = null; page = 'home';
      try { sessionStorage.removeItem(PAGE_STORAGE_KEY); } catch (_) {}
      render();
    }
  });
}
init();