import { createClient } from '@supabase/supabase-js';
import './style.css';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = URL && KEY ? createClient(URL, KEY) : null;
const app = document.querySelector('#app');

let session = null;
let profile = null;
const PAGE_STORAGE_KEY = 'el-sekka-current-page';
const VALID_PAGES = new Set(['home','trip','share','apply-captain','captain','admin']);
let page = (() => {
  try {
    const saved = sessionStorage.getItem(PAGE_STORAGE_KEY);
    return VALID_PAGES.has(saved) ? saved : 'home';
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

function layout(body) {
  app.innerHTML = `
    <header class="topbar">
      <div class="logo">س</div>
      <div class="brand"><b>السكة</b><small>مشوارك.. على طريقك</small></div>
      <div class="grow"></div>
      ${session ? '<button class="btn ghost" id="logout">خروج</button>' : ''}
    </header>
    ${body}
    <footer>السكة © 2026 · منصة تنقل ومشاركة طريق</footer>`;
  document.querySelector('#logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    session = null; profile = null; page = 'home';
    try { sessionStorage.removeItem(PAGE_STORAGE_KEY); } catch (_) {}
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
  layout(`
    <main class="wrap narrow">
      <section class="hero compact"><span class="tag">أهلاً بك في السكة</span><h1>حسابك على السكة</h1><p>سجّل الدخول أو أنشئ حساباً جديداً.</p></section>
      <form class="panel form" id="authForm">
        <label>البريد الإلكتروني<input name="email" type="email" required autocomplete="email" placeholder="name@example.com"></label>
        <label>كلمة المرور<input name="password" type="password" minlength="6" required autocomplete="current-password" placeholder="••••••••"></label>
        <button class="btn primary" type="submit">تسجيل الدخول</button>
        <button class="btn outline" type="button" id="signup">إنشاء حساب جديد</button>
        <p id="msg" class="message"></p>
      </form>
    </main>`);
  document.querySelector('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    await authAction('signin', d.get('email'), d.get('password'));
  });
  document.querySelector('#signup').addEventListener('click', async () => {
    const d = new FormData(document.querySelector('#authForm'));
    await authAction('signup', d.get('email'), d.get('password'));
  });
}

async function authAction(mode, email, password) {
  const msg = document.querySelector('#msg');
  msg.textContent = 'جارٍ التنفيذ...';
  const result = mode === 'signup'
    ? await supabase.auth.signUp({ email, password })
    : await supabase.auth.signInWithPassword({ email, password });
  if (result.error) { msg.textContent = result.error.message; return; }
  if (mode === 'signup' && !result.data.session) {
    msg.textContent = 'تم إنشاء الحساب. راجع بريدك لتأكيد التسجيل إذا طُلب ذلك.';
    return;
  }
  session = result.data.session;
  await loadProfile();
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles')
    .select('id,display_name,role,is_blocked,is_vip')
    .eq('id', session.user.id).maybeSingle();
  if (error) console.error(error);
  profile = data;
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
  layout(`
    <main class="wrap">
      <section class="welcome">
        <div><span class="tag">لوحة ${role}</span><h1>أهلاً ${esc(profile.display_name || 'بك')} 👋</h1><p>اختار الخدمة المناسبة لمشوارك.</p></div>
        <div class="avatar">${esc((profile.display_name || 'س').slice(0,1))}</div>
      </section>
      <section class="cards">
        <button class="service" data-page="trip"><span>🚕</span><b>مشوار عادي</b><small>السعر يحسبه النظام تلقائياً</small><strong>اطلب مشوار ←</strong></button>
        <button class="service" data-page="share"><span>🛣️</span><b>مشاركة السكة</b><small>احجز كرسي أو انشر طريقك</small><strong>اكتشف الرحلات ←</strong></button>
      </section>
      <section class="panel passenger-shortcuts">
        <div class="section-head"><div><h3>مشاويرك السريعة</h3><p class="muted">أماكنك المحفوظة وآخر مشوار في متناول إيدك.</p></div></div>
        <div id="homeSavedPlaces" class="saved-place-list"></div>
        <div id="repeatLastTrip"></div>
      </section>
      ${profile.role === 'captain' ? '<section class="panel"><h2>مساحة الكابتن</h2><p class="muted">إدارة المركبة والرحلات والحجوزات والاشتراك.</p><button class="btn primary" data-page="captain">لوحة الكابتن</button></section>' + await captainDocumentsPanel() : ''}
      ${profile.role === 'admin' ? '<section class="panel"><h2>إدارة المنصة</h2><p class="muted">مراجعة طلبات الكباتن والاشتراكات وإدارة التشغيل.</p><button class="btn primary" data-page="admin">مراجعة الطلبات والاشتراكات</button></section>' : ''}
      ${profile.role === 'passenger' ? await captainApplicationStatus() : ''}
      <section class="panel"><h3>اختار طريقك</h3><p class="muted">في المشوار العادي السعر يحدده النظام. وفي مشاركة الكرسي السعر بالتفاوض وموافقة الطرفين.</p></section>
    </main>`);
  const saved = savedPassengerPlaces();
  const placesBox = document.getElementById('homeSavedPlaces');
  const placeLabels = {home:'البيت',work:'الشغل'};
  const placeEntries = Object.entries(saved).filter(([key,p]) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  placesBox.innerHTML = placeEntries.length
    ? placeEntries.map(([key,p]) => `<button class="saved-place-chip" type="button" data-quick-place="${esc(key)}"><span>${key==='home'?'⌂':'▣'}</span><b>${esc(placeLabels[key] || p.label || 'مكان محفوظ')}</b><small>${esc(p.name || '')}</small></button>`).join('')
    : '<p class="muted">احفظ البيت والشغل من صفحة الحجز لتطلب مشاويرك أسرع.</p>';
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
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', countrycodes: 'eg', 'accept-language': 'ar', addressdetails: '1' });
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

function tripForm() {
  const types = [
    ['private_car','🚘','ملاكي',''],
    ['taxi','🚕','تاكسي',''],
    ['suzuki','🚐','سوزوكي',''],
    ['microbus','🚌','ميكروباص',''],
    ['scooter','🛵','اسكوتر',''],
    ['motorcycle','🏍️','موتوسيكل','']
  ];
  layout(`
    <main class="wrap narrow trip-page">
      <button type="button" class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><h1>رايح فين؟</h1><p>حدد مكان الركوب والوجهة، والسكة هتوصلك.</p></section>
      <form class="panel form trip-panel" id="tripForm">
        <section class="location-card">
          <label>مكان الركوب
            <div class="input-with-action"><input id="originName" required placeholder="اكتب اسم الشارع أو المنطقة" autocomplete="off"><button class="gps-icon" type="button" id="useLocation" aria-label="تحديد موقعي الحالي" title="موقعي الحالي">◎</button></div>
            <div class="suggestions" id="originSuggestions" role="listbox"></div>
            <div class="save-place-actions"><button type="button" data-save-place="home">حفظ كـ البيت</button><button type="button" data-save-place="work">حفظ كـ الشغل</button></div>
          </label>
          <div class="quick-place-row" id="quickPlaceRow"></div>
          <div class="location-divider"></div>
          <label>الوجهة
            <input id="destinationName" required placeholder="رايح فين؟ اكتب اسم المكان" autocomplete="off">
            <div class="suggestions" id="destinationSuggestions" role="listbox"></div>
          </label>
         </section>

        <details class="trip-map-details" id="tripMapDetails">
          <summary>عرض الخريطة وتعديل المواقع</summary>
          <p class="map-helper">اضغط على الخريطة لتعديل مكان الركوب أو الوجهة.</p>
          <div id="tripMap" class="trip-map" role="application" aria-label="خريطة تحديد مكان الركوب والوجهة"></div>
          <div class="map-legend"><span>🟢 الركوب</span><span>🔴 الوجهة</span><span id="mapHint" hidden></span></div>
        </details>

        <fieldset class="vehicle-field">
          <legend>اختار نوع المركبة</legend>
          <div class="vehicle-grid">
            ${types.map(([value,icon,name,desc]) => `
              <button class="vehicle-card" type="button" data-vehicle="${value}">
                <span class="vehicle-icon">${icon}</span><b>${name}</b>
              </button>`).join('')}
          </div>
          <input type="hidden" name="vehicle_type" id="vehicleType" value="private_car">
        </fieldset>
        <label id="passengerCountField">عدد الركاب
          <select name="passenger_count" id="passengerCount"></select>
        </label>
        <label class="schedule-toggle"><input type="checkbox" id="scheduleToggle"> حجز المشوار في موعد لاحق</label>
        <label id="scheduleField" hidden>موعد المشوار
          <input type="datetime-local" id="scheduledAt">
        </label>
        <section class="trip-summary" id="tripSummary"><div><small>المسافة</small><b id="summaryDistance">—</b></div><div><small>الوقت المتوقع</small><b id="summaryDuration">—</b></div><div><small>السعر النهائي</small><b id="summaryFare">—</b></div></section>
        <div class="notice" id="pricingNotice" hidden></div>
        <button class="btn primary" type="submit" id="sendTrip">تأكيد وطلب المشوار</button>
        <p class="message" id="tripMessage" aria-live="polite"></p>
        <section id="tripResult" class="trip-result" hidden></section>
      </form>
    </main>`);

  let origin = null, destination = null, activePoint = 'origin';
  const $ = id => document.getElementById(id);
  let pendingTrip = null;
  try { pendingTrip=JSON.parse(sessionStorage.getItem('el-sekka-pending-trip') || 'null'); sessionStorage.removeItem('el-sekka-pending-trip'); } catch (_) {}

  let routeDistanceKm = null, routeDurationMinutes = null, summarySequence = 0;
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 18;
  document.documentElement.classList.toggle('trip-day', isDay);
  document.documentElement.classList.toggle('trip-night', !isDay);
  document.body.classList.toggle('trip-day', isDay);
  document.body.classList.toggle('trip-night', !isDay);
  $('tripMap')?.classList.toggle('trip-map-night', !isDay);
  $('tripMap')?.classList.toggle('trip-map-day', isDay);
  let map = null, originMarker = null, destinationMarker = null, routeLine = null;
  const searchTimers = {origin:null,destination:null};
  const searchSequence = {origin:0,destination:0};
  const statusHint = message => { $('mapHint').textContent = message; };
  const savedPlaces = savedPassengerPlaces();
  const quickPlaceRow = $('quickPlaceRow');
  const rememberedTrip = pendingTrip || readPassengerStore('last-trip');
  if (pendingTrip?.origin) setTimeout(() => setPoint('origin',pendingTrip.origin.lat,pendingTrip.origin.lng,pendingTrip.origin.name,true),250);
  if (pendingTrip?.destination) setTimeout(() => setPoint('destination',pendingTrip.destination.lat,pendingTrip.destination.lng,pendingTrip.destination.name,true),450);

  const savedEntries = Object.entries(savedPlaces).filter(([key,p]) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  quickPlaceRow.innerHTML = savedEntries.map(([key,p]) => `<button type="button" class="quick-place-chip" data-fill-place="${esc(key)}">${key==='home'?'⌂':'▣'} ${key==='home'?'البيت':key==='work'?'الشغل':esc(p.label || 'مكان محفوظ')}</button>`).join('');
  quickPlaceRow.querySelectorAll('[data-fill-place]').forEach(button => button.addEventListener('click', () => {
    const place = savedPlaces[button.dataset.fillPlace];
    setPoint('origin',place.lat,place.lng,place.name,true);
  }));
  document.querySelectorAll('[data-save-place]').forEach(button => button.addEventListener('click', () => {
    if (!origin) { $('tripMessage').textContent='حدد مكان الركوب أولاً ثم احفظه.'; return; }
    const key=button.dataset.savePlace, current=savedPassengerPlaces();
    current[key]={lat:origin.lat,lng:origin.lng,name:origin.name,label:key==='home'?'البيت':'الشغل'};
    if(writePassengerStore('places',current)) {
      $('tripMessage').textContent=key==='home'?'تم حفظ عنوان البيت على هذا الجهاز.':'تم حفظ عنوان الشغل على هذا الجهاز.';
      savedPlaces[key]=current[key];
      quickPlaceRow.innerHTML=Object.entries(current).map(([k,p])=>`<button type="button" class="quick-place-chip" data-fill-place="${esc(k)}">${k==='home'?'⌂':'▣'} ${k==='home'?'البيت':k==='work'?'الشغل':esc(p.label || 'مكان محفوظ')}</button>`).join('');
      quickPlaceRow.querySelectorAll('[data-fill-place]').forEach(b=>b.addEventListener('click',()=>{const p=current[b.dataset.fillPlace];setPoint('origin',p.lat,p.lng,p.name,true);}));
    } else $('tripMessage').textContent='تعذر الحفظ على الجهاز. تحقق من مساحة التخزين.';
  }));
  $('back').addEventListener('click', () => { page = 'home'; render(); });
  $('tripMapDetails').addEventListener('toggle', () => {
    if ($('tripMapDetails').open && map) {
      window.setTimeout(() => {
        map.invalidateSize({pan:false,animate:false});
        if (origin && destination) drawRoute();
      }, 120);
    }
  });

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
      $('summaryFare').textContent = Number.isFinite(fare) ? `${fare.toLocaleString('ar-EG')} جنيه` : 'يظهر عند الطلب';
    } catch (_) {
      if(seq===summarySequence) $('summaryFare').textContent = 'يظهر عند الطلب';
    }
  };

  const setVehicle = value => {
    $('vehicleType').value = value;
    document.querySelectorAll('.vehicle-card').forEach(card => card.classList.toggle('selected', card.dataset.vehicle === value));
    const caps = {private_car:3,taxi:4,suzuki:6,microbus:13,scooter:1,motorcycle:1};
    const max = caps[value] || 1;
    $('passengerCountField').hidden = max === 1;
    $('passengerCount').innerHTML = Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    updateFarePreview();
  };
  document.querySelectorAll('.vehicle-card').forEach(card => card.addEventListener('click', () => setVehicle(card.dataset.vehicle)));
  setVehicle(rememberedTrip?.vehicle_type || 'private_car');
  if (rememberedTrip?.passenger_count) $('passengerCount').value = String(rememberedTrip.passenger_count);

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
      routeLine = window.L.geoJSON(data.routes[0].geometry,{style:{color:'#a8ff45',weight:6,opacity:1}}).addTo(map);
      routeDistanceKm = data.routes[0].distance / 1000;
      routeDurationMinutes = data.routes[0].duration / 60;
      map.fitBounds(routeLine.getBounds(),{padding:[35,35]});
      statusHint('تم تحديد المسار على الخريطة.');
      await updateFarePreview();
    } catch (error) {
      if (seq !== routeSequence) return;
      routeDistanceKm=null; routeDurationMinutes=null;
      await updateFarePreview();
      statusHint(error.name === 'TimeoutError' ? 'خدمة المسارات تأخرت. حاول مرة أخرى بعد لحظات.' : (error.message || 'تعذر رسم المسار حالياً.'));
    }
  };

  const setPoint = async (point, lat, lng, knownName = null, moveMap = false) => {
    const place = {lat:Number(lat),lng:Number(lng),name:knownName || 'جارٍ تحديد العنوان...'};
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    const isOrigin = point === 'origin';
    if (isOrigin) origin = place; else destination = place;
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
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        maxZoom:19,
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
        crossOrigin:true
      }).addTo(map);
      // Restore any addresses selected while Leaflet was loading.
      if (origin) setPoint('origin',origin.lat,origin.lng,origin.name,true).catch(error => statusHint(error.message || 'تعذر إظهار مكان الركوب.'));
      if (destination) setPoint('destination',destination.lat,destination.lng,destination.name,true).catch(error => statusHint(error.message || 'تعذر إظهار الوجهة.'));
      const applyMapTheme = () => {
        const day = new Date().getHours() >= 6 && new Date().getHours() < 18;
        document.documentElement.classList.toggle('trip-day',day);
        document.documentElement.classList.toggle('trip-night',!day);
        document.body.classList.toggle('trip-day',day);
        document.body.classList.toggle('trip-night',!day);
        mapElement.classList.toggle('trip-map-day',day);
        mapElement.classList.toggle('trip-map-night',!day);
      };
      applyMapTheme();
      window.setInterval(applyMapTheme,60_000);
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

  $('scheduleToggle').addEventListener('change',e=>{
    const scheduled=e.target.checked;
    $('scheduleField').hidden=!scheduled;
    $('scheduledAt').required=scheduled;
    $('sendTrip').textContent=scheduled?'تأكيد حجز المشوار المجدول':'تأكيد وطلب المشوار';
    $('pricingNotice').textContent=scheduled
      ? 'المشوار المجدول بسعر ثابت يحسبه النظام تلقائياً، مثل المشوار الفوري. لا يوجد تفاوض على السعر.'
      : 'المشوار الفوري بسعر ثابت يحسبه النظام تلقائياً. لا توجد عمولة، والدفع للكابتن نقداً.';
    if(!scheduled) $('scheduledAt').value='';
    updateFarePreview();
  });

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
      if(!raw||new Date(raw).getTime()<=Date.now()){msg.textContent='اختر موعداً مستقبلياً صحيحاً.';return;}
      scheduledAt=new Date(raw).toISOString();
    }
    button.disabled=true;button.textContent=scheduled?'جارٍ حساب السعر الثابت وإرسال الحجز...':'جارٍ حساب السعر وإرسال الطلب...';
    msg.textContent='بنحسب المسافة والسعر الثابت على الخادم.';
    try{
      const commonBody={
        vehicle_type:$('vehicleType').value,
        origin_name:origin.name,origin_lat:origin.lat,origin_lng:origin.lng,
        destination_name:destination.name,destination_lat:destination.lat,destination_lng:destination.lng,
        passenger_count:Number($('passengerCount').value)
      };
      const result=await supabase.functions.invoke('create-fixed-trip',{
        body:{...commonBody,is_scheduled:scheduled,scheduled_at:scheduledAt}
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
      const distanceLabel=Number.isFinite(distance)?`${distance.toFixed(1)} كم`:'غير متاحة';
      writePassengerStore('last-trip',{
        origin:{lat:origin.lat,lng:origin.lng,name:origin.name},
        destination:{lat:destination.lat,lng:destination.lng,name:destination.name},
        vehicle_type:$('vehicleType').value,
        passenger_count:Number($('passengerCount').value)
      });
      const nextStep=scheduled?'تم تسجيل حجزك بالموعد المحدد.':'بنبحث لك عن كابتن قريب منك الآن.';
      $('tripResult').innerHTML=`<div class="trip-success-icon">✓</div><h3>طلبك وصل بنجاح</h3><div class="fare-line"><span>السعر النهائي</span><strong>${fareLabel}</strong></div><p>${nextStep}</p>`;
      $('tripResult').hidden=false;msg.textContent='تم إنشاء الطلب بنجاح.';button.textContent='تم إرسال الطلب';
    }catch(error){
      msg.textContent=error.message||'حصل خطأ غير متوقع. حاول مرة أخرى.';
      button.disabled=false;button.textContent=$('scheduleToggle').checked?'تأكيد حجز المشوار المجدول':'تأكيد وطلب المشوار';
    }
  });
}

function shareHome() {
  const isCaptain = profile?.role === 'captain';
  const types = [
    ['private_car','ملاكي'],['taxi','تاكسي'],['suzuki','سوزوكي'],
    ['microbus','ميكروباص'],['scooter','اسكوتر'],['motorcycle','موتوسيكل']
  ];
  layout(`
    <main class="wrap narrow">
      <button type="button" class="back" id="back">→ الرئيسية</button>
      <section class="hero compact">
        <span class="tag">مشاركة السكة · سعر الكرسي بالتفاوض</span>
        <h1>شارك الطريق</h1>
      </section>
      <details class="panel share-rule">
        <summary><b>كيف تعمل المشاركة؟</b></summary>
        <p>صاحب الطلب يحدد السعر المبدئي، والطرف الآخر يقدر يقبل أو يقدم سعراً مقابلاً. نفس القاعدة للمشاركة الفورية والمجدولة.</p>
        <p>الكابتن يقدر يطلب كرسياً كأي راكب، لكن الراكب لا يحصل على صلاحيات الكابتن. الحجز العادي يظل بسعر ثابت ومنفصل.</p>
      </details>
      <section class="panel">
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
          <label>عدد الكراسي المطلوبة<input id="shareSeats" type="number" min="1" max="13" value="1" required></label>
          <label>السعر المبدئي للكرسي (جنيه)<input id="sharePrice" type="number" min="0" step="0.5" required placeholder="اكتب السعر الذي تقترحه"></label>
          <label>نوع المركبة المفضل (اختياري)
            <select id="shareVehicle"><option value="">أي مركبة مناسبة</option>${types.map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select>
          </label>
          <button class="btn primary" type="submit">نشر طلب المشاركة</button>
          <p id="shareCreateMessage" class="message" aria-live="polite"></p>
        </form>
      </section>
      ${isCaptain ? `
      <section class="panel">
        <h2>انشر كراسي متاحة بمركبتك</h2>
        <p class="muted">هذا العرض ينشره الكابتن فقط بمركبة معتمدة ونشطة، ويحدد سعر الكرسي.</p>
        <form id="captainSeatOfferForm" class="form">
          <label>المركبة<select id="seatOfferVehicle" required><option value="">جارٍ تحميل المركبات...</option></select></label>
          <label>نوع العرض<select id="seatOfferMode"><option value="live_share">فوري</option><option value="scheduled_share">مجدول</option></select></label>
          <label>من<input id="seatOfferOrigin" required maxlength="180"></label>
          <label>إلى<input id="seatOfferDestination" required maxlength="180"></label>
          <label id="seatOfferDateField" hidden>موعد التحرك<input id="seatOfferDeparture" type="datetime-local"></label>
          <label>عدد الكراسي المتاحة<input id="seatOfferSeats" type="number" min="1" max="13" value="1" required></label>
          <label>سعر الكرسي (جنيه)<input id="seatOfferPrice" type="number" min="0" step="0.5" required></label>
          <button class="btn primary" type="submit">نشر عرض الكراسي</button>
          <p id="seatOfferMessage" class="message" aria-live="polite"></p>
        </form>
      </section>
      <section class="panel">
        <h2>طلبات مشاركة متاحة على الطريق</h2>
        <p class="muted">طلبات الركاب والكباتن الذين يستخدمون الخدمة كطالبي مقاعد.</p>
        <div id="shareOpenRequests" class="share-list">جارٍ تحميل الطلبات...</div>
      </section>` : ''}
      ${isCaptain ? '<section class="panel"><h2>متابعة تفاوضاتك ككابتن</h2><div id="shareCaptainNegotiations" class="share-list">جارٍ تحميل التفاوضات...</div></section>' : ''}
      <section class="panel"><h2>حجوزات الكراسي الحالية</h2><div id="legacyShareBookings" class="share-list">جارٍ تحميل الحجوزات...</div></section>
      <section class="panel">
        <h2>عروض الكراسي المتاحة</h2>
        <p class="muted">تقدر تطلب كرسياً من عرض كابتن آخر، حتى لو حسابك كابتن.</p>
        <div id="shareAvailableRides" class="share-list">جارٍ تحميل العروض...</div>
      </section>
      <section class="panel">
        <h2>طلباتي وردود الكباتن</h2>
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
  const shareVehicleCapacity = {private_car:3,taxi:4,suzuki:6,microbus:13,scooter:1,motorcycle:1};
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
    const msg=$('shareCreateMessage');
    const btn=e.currentTarget.querySelector('button[type="submit"]');
    msg.textContent='جارٍ نشر الطلب...'; btn.disabled=true;
    const seats = Number($('shareSeats').value);
    const selectedVehicle = $('shareVehicle').value;
    if(!shareOriginPoint){msg.textContent='اختار مكان البداية من اقتراحات البحث أو من الخريطة.';btn.disabled=false;return;}
    if(!shareDestinationPoint){msg.textContent='اختار الوجهة من اقتراحات البحث أو من الخريطة.';btn.disabled=false;return;}
    if(shareOriginPoint.lat===shareDestinationPoint.lat&&shareOriginPoint.lng===shareDestinationPoint.lng){msg.textContent='مكان البداية والوجهة متطابقان.';btn.disabled=false;return;}
    if (!Number.isInteger(seats) || seats < 1 || seats > 13 ||
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
    e.currentTarget.reset(); $('shareMode').value='live_share'; $('shareDateField').hidden=true;
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
    ]);
    if(error){host.textContent='تعذر تحميل الطلبات. تأكد من تنفيذ تحديث قاعدة البيانات أولاً.';return;}
    if(!requests?.length){host.innerHTML='<p class="muted">لا توجد طلبات مشاركة متاحة حالياً.</p>';return;}
    if(!vehicles?.length){host.innerHTML='<div class="notice">لازم يكون عندك مركبة معتمدة ونشطة حتى ترد على طلب مشاركة.</div>';return;}
    host.innerHTML=requests.map(r=>{
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
    const columns='id,ride_id,passenger_id,pickup_name,dropoff_name,seats_requested,passenger_offer_egp,captain_counter_offer_egp,agreed_price_egp,booking_status,created_at';
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
    if(!bs.length){host.innerHTML='<p class="muted">لا توجد حجوزات كراسي حتى الآن.</p>';return;}
    host.innerHTML=bs.map(b=>{
      const requester=b.passenger_id===profile.id;
      let actions='';
      if(requester&&b.booking_status==='counter_offer') actions=
        '<div class="share-actions"><button class="btn primary" data-b-accept="'+b.id+'">قبول سعر الكابتن</button><input id="b-offer-'+b.id+'" type="number" min="0" step="0.5" placeholder="سعرك الجديد"><button class="btn outline" data-b-counter="'+b.id+'">سعر مقابل</button><button class="btn ghost" data-b-cancel="'+b.id+'">إلغاء</button></div>';
      else if(requester&&b.booking_status==='accepted') actions='<button class="btn primary" data-b-confirm="'+b.id+'">تأكيد حجز الكرسي</button>';
      else if(!requester&&b.booking_status==='pending') actions=
        '<div class="share-actions"><button class="btn primary" data-b-captain-accept="'+b.id+'">قبول عرض الراكب</button><input id="b-counter-'+b.id+'" type="number" min="0" step="0.5" placeholder="سعرك المقابل"><button class="btn outline" data-b-captain-counter="'+b.id+'">سعر مقابل</button><button class="btn ghost" data-b-reject="'+b.id+'">رفض</button></div>';
      return '<article class="share-item"><b>'+esc(b.pickup_name)+' ← '+esc(b.dropoff_name)+'</b>'+
        '<small>'+b.seats_requested+' كرسي · '+(requester?'طلب أرسلته':'طلب على عرضك')+' · '+new Date(b.created_at).toLocaleString('ar-EG')+'</small>'+
        '<p>عرض الراكب: '+Number(b.passenger_offer_egp).toLocaleString('ar-EG')+' جنيه · '+(b.captain_counter_offer_egp==null?'لا يوجد سعر مقابل':'سعر الكابتن: '+Number(b.captain_counter_offer_egp).toLocaleString('ar-EG')+' جنيه')+' · الحالة: '+shareStatus(b.booking_status)+'</p>'+actions+'</article>';
    }).join('');
    const call=async(id,fn,args)=>{const {error}=await supabase.rpc(fn,args);if(error){alert(shareError(error));return;}await loadLegacyShareBookings();};
    host.querySelectorAll('[data-b-accept]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bAccept,'passenger_reply_booking',{p_booking_id:b.dataset.bAccept,p_action:'accept',p_new_offer:null})));
    host.querySelectorAll('[data-b-counter]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.bCounter,price=Number($('b-offer-'+id).value);if(!Number.isFinite(price)||price<0){alert('اكتب سعراً صحيحاً.');return;}call(id,'passenger_reply_booking',{p_booking_id:id,p_action:'counter',p_new_offer:price});}));
    host.querySelectorAll('[data-b-cancel]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bCancel,'passenger_reply_booking',{p_booking_id:b.dataset.bCancel,p_action:'cancel',p_new_offer:null})));
    host.querySelectorAll('[data-b-confirm]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bConfirm,'confirm_seat_booking',{p_booking_id:b.dataset.bConfirm})));
    host.querySelectorAll('[data-b-captain-accept]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bCaptainAccept,'captain_reply_booking',{p_booking_id:b.dataset.bCaptainAccept,p_action:'accept',p_counter_price:null})));
    host.querySelectorAll('[data-b-captain-counter]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.bCaptainCounter,price=Number($('b-counter-'+id).value);if(!Number.isFinite(price)||price<0){alert('اكتب سعراً صحيحاً.');return;}call(id,'captain_reply_booking',{p_booking_id:id,p_action:'counter',p_counter_price:price});}));
    host.querySelectorAll('[data-b-reject]').forEach(b=>b.addEventListener('click',()=>call(b.dataset.bReject,'captain_reply_booking',{p_booking_id:b.dataset.bReject,p_action:'reject',p_counter_price:null})));
  }

  async function loadCaptainSeatVehicles(){
    const select=$('seatOfferVehicle'); if(!select)return;
    const {data,error}=await supabase.from('vehicles')
      .select('id,vehicle_type,make,model,passenger_capacity')
      .eq('captain_id',profile.id).eq('approval_status','approved').eq('is_active',true);
    if(error||!data?.length){select.innerHTML='<option value="">لا توجد مركبات معتمدة ونشطة</option>';return;}
    select.innerHTML=data.map(v=>`<option value="${v.id}">${esc([v.make,v.model].filter(Boolean).join(' ')||v.vehicle_type)} · ${v.passenger_capacity} مقعد</option>`).join('');
    $('seatOfferSeats').max=String(Math.max(...data.map(v=>v.passenger_capacity)));
  }
  $('seatOfferMode')?.addEventListener('change',()=>{
    const scheduled=$('seatOfferMode').value==='scheduled_share';
    $('seatOfferDateField').hidden=!scheduled; $('seatOfferDeparture').required=scheduled;
  });
  $('captainSeatOfferForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const msg=$('seatOfferMessage'),btn=e.currentTarget.querySelector('button[type="submit"]');
    const mode=$('seatOfferMode').value;
    const departure=mode==='scheduled_share'?new Date($('seatOfferDeparture').value):new Date(Date.now()+60000);
    if(mode==='scheduled_share'&&(! $('seatOfferDeparture').value||Number.isNaN(departure.getTime())||departure<=new Date())){
      msg.textContent='اختار موعداً مستقبلياً صحيحاً.';return;
    }
    btn.disabled=true;msg.textContent='جارٍ نشر عرض الكراسي...';
    const {error}=await supabase.rpc('create_share_ride',{
      p_vehicle_id:$('seatOfferVehicle').value,p_ride_mode:mode,
      p_origin_name:$('seatOfferOrigin').value.trim(),p_origin_lat:null,p_origin_lng:null,
      p_destination_name:$('seatOfferDestination').value.trim(),p_destination_lat:null,p_destination_lng:null,
      p_route_description:null,p_departure_at:departure.toISOString(),
      p_seats:Number($('seatOfferSeats').value),p_seat_price:Number($('seatOfferPrice').value)
    });
    btn.disabled=false;
    if(error){msg.textContent=shareError(error);return;}
    msg.textContent='تم نشر عرض الكراسي.';e.currentTarget.reset();
    $('seatOfferMode').value='live_share';$('seatOfferDateField').hidden=true;
    await loadAvailableRides();
  });

  async function loadAvailableRides(){
    const host=$('shareAvailableRides');if(!host)return;
    let q=supabase.from('rides').select('id,captain_id,ride_mode,origin_name,destination_name,departure_at,available_seats,seat_price_egp')
      .eq('ride_status','open').order('departure_at',{ascending:true}).limit(40);
    const {data,error}=await q;
    if(error){host.textContent='تعذر تحميل عروض الكراسي.';return;}
    const rides=(data||[]).filter(r=>r.captain_id!==profile.id);
    if(!rides.length){host.innerHTML='<p class="muted">لا توجد عروض كراسي متاحة حالياً.</p>';return;}
    host.innerHTML=rides.map(r=>`<article class="share-item">
      <b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b>
      <small>${r.ride_mode==='live_share'?'فوري':'مجدول'} · ${new Date(r.departure_at).toLocaleString('ar-EG')}</small>
      <p>المتاح: ${r.available_seats} · السعر المطلوب: ${Number(r.seat_price_egp).toLocaleString('ar-EG')} جنيه للكرسي</p>
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
      const {error}=await supabase.rpc('request_seats',{
        p_ride_id:id,p_pickup_name:$('ride-pickup-'+id).value.trim(),
        p_dropoff_name:$('ride-dropoff-'+id).value.trim(),
        p_pickup_order:0,p_dropoff_order:1,p_seats:seats,p_offer:offer
      });
      if(error){alert(shareError(error));b.disabled=false;return;}
      b.textContent='تم إرسال طلبك';b.disabled=true;
    }));
  }

  if(isCaptain) loadCaptainSeatVehicles();
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
    : data?.application_status==='pending' ? '<p class="notice">مستنداتك قيد مراجعة الإدارة. يمكنك استخدام التطبيق كراكب كالمعتاد.</p>'
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
  document.getElementById('statusHome')?.addEventListener('click',async()=>{page='home';await loadProfile();});
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
      </form>
    </main>`);
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


async function captainSubscriptionPanel() {
  const {data:application}=await supabase.from('captain_applications')
    .select('application_status,national_id_expiry,license_expiry,vehicle_license_expiry')
    .eq('user_id',profile.id).maybeSingle();
  const today=new Date().toISOString().slice(0,10);
  const documentsReady=application?.application_status==='approved'
    && application.national_id_expiry>today
    && application.license_expiry>today
    && application.vehicle_license_expiry>today;
  const {data,error}=await supabase.from('captain_subscriptions')
    .select('id,plan_days,amount_egp,payment_reference,payment_status,starts_at,expires_at,created_at')
    .eq('captain_id',profile.id).order('created_at',{ascending:false}).limit(10);
  if(error) return '<section class="panel"><h2>اشتراك الكابتن</h2><p class="message">تعذر تحميل بيانات الاشتراك حالياً.</p></section>';
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
      <label>رقم مرجع التحويل<input name="payment_reference" required maxlength="120" placeholder="رقم العملية أو مرجع التحويل"></label>
      <label>إثبات الدفع (صورة أو PDF)<input name="payment_proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
      <p class="muted">ارفع إثبات التحويل بعد الدفع خارج التطبيق. لا توجد مدفوعات إلكترونية داخل السكة.</p>
      <button class="btn primary" type="submit">إرسال طلب الاشتراك</button>
      <p class="message" id="subscriptionMessage" aria-live="polite"></p>
    </form>`;
  const documentsNotice=documentsReady?'':'<div class="notice">لن تتمكن من تقديم اشتراك قبل مراجعة الإدارة واعتماد المستندات وصلاحيتها.</div>';
  return '<section class="panel"><h2>اشتراك الكابتن</h2>'+status+documentsNotice+history+form+'</section>';
}

async function captainDashboardPage() {
  const docs=await captainDocumentsPanel();
  const subscription=await captainSubscriptionPanel();
  layout(`
    <main class="wrap narrow">
      <button type="button" class="back" id="captainHome">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">مساحة الكابتن</span><h1>إدارة حسابك واشتراكك</h1><p>يمكنك استخدام السكة كراكب في أي وقت. الاشتراك مطلوب فقط لممارسة نشاط القيادة.</p></section>
      ${docs}
      ${subscription}
    </main>`);
  document.getElementById('captainHome')?.addEventListener('click',()=>{page='home';render();});
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;render();}));
  document.getElementById('subscriptionForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget, d=new FormData(form), msg=document.getElementById('subscriptionMessage'), btn=form.querySelector('button[type="submit"]');
    const file=d.get('payment_proof');
    if(!(file instanceof File)||!file.size){msg.textContent='اختر صورة أو ملف PDF لإثبات الدفع.';return;}
    if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){msg.textContent='الملف يجب أن يكون صورة JPG أو PNG أو WEBP أو PDF ولا يتجاوز 5 ميجابايت.';return;}
    const reference=String(d.get('payment_reference')||'').trim();
    if(!reference){msg.textContent='أدخل مرجع التحويل.';return;}
    btn.disabled=true;
    let uploadedPath=null;
    try{
      msg.textContent='جارٍ رفع إثبات الدفع بشكل خاص...';
      const ext=file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
      uploadedPath=profile.id+'/subscription/'+crypto.randomUUID()+'.'+ext;
      const {error:uploadError}=await supabase.storage.from('captain-payment-proofs').upload(uploadedPath,file,{contentType:file.type,upsert:false});
      if(uploadError) throw uploadError;
      const {error:rpcError}=await supabase.rpc('submit_subscription',{
        p_plan_days:Number(d.get('plan_days')),p_payment_reference:reference,p_proof_path:uploadedPath
      });
      if(rpcError) throw rpcError;
      await captainDashboardPage();
    }catch(error){
      if(uploadedPath) await supabase.storage.from('captain-payment-proofs').remove([uploadedPath]);
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
    btn.disabled=true;
    const id=btn.dataset.reviewApp,decision=btn.dataset.decision;
    const notes=document.querySelector('[data-notes="'+id+'"]')?.value||null;
    const {error}=await supabase.rpc('review_captain_application_v2',{p_application_id:id,p_decision:decision,p_admin_notes:notes});
    if(error){alert('تعذر تنفيذ مراجعة الطلب: '+error.message);btn.disabled=false;return;}
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

function render() {
  try {
    if (session && VALID_PAGES.has(page)) sessionStorage.setItem(PAGE_STORAGE_KEY, page);
    else if (!session) sessionStorage.removeItem(PAGE_STORAGE_KEY);
  } catch (_) {}
  if (!supabase) return setup();
  if (!session) return auth();
  if (page === 'home') return home();
  if (page === 'trip') return tripForm();
  if (page === 'share') return shareHome();
  if (page === 'apply-captain') return applyCaptainPage();
  if (page === 'admin') return profile?.role === 'admin' ? adminApplicationsPage() : (page='home',home());
  if (page === 'captain') return profile?.role === 'captain' ? captainDashboardPage() : (page='home',home());
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
      profile = null; page = 'home';
      try { sessionStorage.removeItem(PAGE_STORAGE_KEY); } catch (_) {}
      render();
    }
  });
}
init();
