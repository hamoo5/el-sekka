import { createClient } from '@supabase/supabase-js';
import './style.css';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = URL && KEY ? createClient(URL, KEY) : null;
const app = document.querySelector('#app');

let session = null;
let profile = null;
let page = 'home';

const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

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
    session = null; profile = null; page = 'home'; render();
  });
}

function setup() {
  layout(`
    <main class="wrap narrow">
      <section class="hero">
        <span class="tag">EL SEKKA · V2</span>
        <h1>كل الطرق <em>تبدأ من هنا</em></h1>
        <p>مشوار فوري بسعر النظام، أو رحلة مجدولة تتفق فيها مع الكابتن على السعر.</p>
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
  render();
}

function home() {
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
        ${profile.role === 'passenger' ? '<button class="service" data-page="myScheduled"><span>🗓️</span><b>رحلاتي المجدولة</b><small>تابع عروض الكباتن واتفاق السعر</small><strong>متابعة الرحلات ←</strong></button>' : ''}
      </section>
      ${profile.role === 'captain' ? '<section class="panel"><h2>مساحة الكابتن</h2><p class="muted">إدارة المركبة والرحلات والحجوزات والاشتراك.</p><button class="btn primary" data-page="captain">لوحة الكابتن</button></section>' : ''}
      ${profile.role === 'admin' ? '<section class="panel"><h2>إدارة المنصة</h2><p class="muted">مراجعة الكباتن والمركبات والاشتراكات والبلاغات.</p><button class="btn primary" data-page="admin">لوحة الإدارة</button></section>' : ''}
      <section class="panel"><h3>اختار طريقك</h3><p class="muted">في المشوار العادي السعر يحدده النظام. وفي مشاركة الكرسي السعر بالتفاوض وموافقة الطرفين.</p></section>
    </main>`);
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
    ['private_car','🚘','ملاكي','حتى 3 ركاب'],
    ['taxi','🚕','تاكسي','حتى 4 ركاب'],
    ['suzuki','🚐','سوزوكي','حتى 6 ركاب'],
    ['microbus','🚌','ميكروباص','حتى 13 راكب'],
    ['scooter','🛵','اسكوتر','راكب واحد'],
    ['motorcycle','🏍️','موتوسيكل','راكب واحد']
  ];
  layout(`
    <main class="wrap narrow trip-page">
      <button class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">مشوار عادي · سعر ثابت</span><h1>اطلب مشوارك</h1><p>حدد مكان الركوب والوجهة، وشوف المسار قبل إرسال الطلب.</p></section>
      <form class="panel form trip-panel" id="tripForm">
        <section class="location-card">
          <label>مكان الركوب
            <div class="input-with-action"><input id="originName" required placeholder="اكتب اسم الشارع أو المنطقة" autocomplete="off"><button class="gps-icon" type="button" id="useLocation" aria-label="تحديد موقعي الحالي" title="موقعي الحالي">◎</button></div>
            <div class="suggestions" id="originSuggestions" role="listbox"></div>
          </label>
          <div class="location-divider"></div>
          <label>الوجهة
            <input id="destinationName" required placeholder="رايح فين؟ اكتب اسم المكان" autocomplete="off">
            <div class="suggestions" id="destinationSuggestions" role="listbox"></div>
          </label>
         </section>

        <div class="map-heading"><b>مسارك على الخريطة</b><small>اختار الحقل ثم اضغط على الخريطة أو حرّك الدبوس.</small></div>
        <div id="tripMap" class="trip-map" role="application" aria-label="خريطة تحديد مكان الركوب والوجهة"></div>
        <div class="map-legend"><span>🟢 الركوب</span><span>🔴 الوجهة</span><span id="mapHint">حدد النقطتين لعرض المسار.</span></div>

        <fieldset class="vehicle-field">
          <legend>اختار نوع المركبة</legend>
          <div class="vehicle-grid">
            ${types.map(([value,icon,name,desc]) => `
              <button class="vehicle-card" type="button" data-vehicle="${value}">
                <span class="vehicle-icon">${icon}</span><b>${name}</b><small>${desc}</small>
              </button>`).join('')}
          </div>
          <input type="hidden" name="vehicle_type" id="vehicleType" value="private_car">
        </fieldset>
        <label>عدد الركاب
          <select name="passenger_count" id="passengerCount"></select>
        </label>
        <label class="schedule-toggle"><input type="checkbox" id="scheduleToggle"> حجز المشوار في موعد لاحق</label>
        <label id="scheduleField" hidden>موعد المشوار
          <input type="datetime-local" id="scheduledAt">
        </label>
        <label id="scheduledOfferField" hidden>عرضك المبدئي للسعر (جنيه)
          <input type="number" id="initialOffer" min="1" max="100000" step="1" inputmode="numeric" placeholder="اكتب السعر اللي يناسبك">
          <small class="muted">الكابتن يقدر يقبل عرضك أو يرسل سعرًا مقابلًا. لا يتم تأكيد الرحلة إلا بموافقتكما.</small>
        </label>
        <section class="trip-summary" id="tripSummary"><div><small>المسافة</small><b id="summaryDistance">—</b></div><div><small>الوقت المتوقع</small><b id="summaryDuration">—</b></div><div><small>السعر النهائي</small><b id="summaryFare">—</b></div></section>
        <div class="notice" id="pricingNotice">المشوار الفوري: السعر يحسبه النظام تلقائياً. لا توجد عمولة على الرحلة، والدفع للكابتن نقداً.</div>
        <button class="btn primary" type="submit" id="sendTrip">تأكيد وطلب المشوار</button>
        <p class="message" id="tripMessage" aria-live="polite"></p>
        <section id="tripResult" class="trip-result" hidden></section>
      </form>
    </main>`);

  let origin = null, destination = null, activePoint = 'origin';
  const $ = id => document.getElementById(id);
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
  $('back').addEventListener('click', () => { page = 'home'; render(); });

  const updateFarePreview = async () => {
    const seq = ++summarySequence;
    if (!origin || !destination || !routeDistanceKm) {
      $('summaryDistance').textContent = '—'; $('summaryDuration').textContent = '—'; $('summaryFare').textContent = '—'; return;
    }
    $('summaryDistance').textContent = `${routeDistanceKm.toFixed(1)} كم`;
    $('summaryDuration').textContent = routeDurationMinutes ? `${Math.max(1,Math.round(routeDurationMinutes))} دقيقة` : '—';
    if ($('scheduleToggle')?.checked) { $('summaryFare').textContent = 'بالتفاوض'; return; }
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
    $('passengerCount').innerHTML = Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    updateFarePreview();
  };
  document.querySelectorAll('.vehicle-card').forEach(card => card.addEventListener('click', () => setVehicle(card.dataset.vehicle)));
  setVehicle('private_car');

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
    $('scheduledOfferField').hidden=!scheduled;
    $('scheduledAt').required=scheduled;
    $('initialOffer').required=scheduled;
    $('sendTrip').textContent=scheduled?'إرسال طلب التفاوض':'تأكيد وطلب المشوار';
    $('pricingNotice').textContent=scheduled
      ? 'الرحلة المجدولة: اكتب عرضك المبدئي، والكابتن يقدر يقبله أو يفاوضك على سعر آخر. لا توجد عمولة، والدفع نقداً.'
      : 'المشوار الفوري: السعر يحسبه النظام تلقائياً. لا توجد عمولة على الرحلة، والدفع للكابتن نقداً.';
    if(!scheduled){$('scheduledAt').value='';$('initialOffer').value='';}
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
    let initialOffer=null;
    if(scheduled){
      const raw=$('scheduledAt').value;
      if(!raw||new Date(raw).getTime()<=Date.now()){msg.textContent='اختر موعداً مستقبلياً صحيحاً.';return;}
      scheduledAt=new Date(raw).toISOString();
      initialOffer=Number($('initialOffer').value);
      if(!Number.isFinite(initialOffer)||initialOffer<=0||initialOffer>100000){msg.textContent='اكتب عرض سعر صحيحاً أكبر من صفر.';return;}
    }
    button.disabled=true;button.textContent=scheduled?'جارٍ إرسال طلب التفاوض...':'جارٍ حساب السعر وإرسال الطلب...';
    msg.textContent=scheduled?'بنحسب المسافة ونسجل عرض السعر المبدئي.':'بنحسب المسافة والسعر المعتمد على الخادم.';
    try{
      const commonBody={
        vehicle_type:$('vehicleType').value,
        origin_name:origin.name,origin_lat:origin.lat,origin_lng:origin.lng,
        destination_name:destination.name,destination_lat:destination.lat,destination_lng:destination.lng,
        passenger_count:Number($('passengerCount').value)
      };
      const result=scheduled
        ? await supabase.functions.invoke('create-scheduled-trip',{body:{...commonBody,scheduled_at:scheduledAt,initial_offer_egp:initialOffer}})
        : await supabase.functions.invoke('create-fixed-trip',{body:{...commonBody,is_scheduled:false,scheduled_at:null}});
      const {data,error}=result;
      if(error){
        let details=error.message||'تعذر إرسال الطلب.';
        try{const body=await error.context?.json();if(body?.error)details=body.error;}catch(_){}
        throw new Error(details);
      }
      const requestId=data?.request_id||data?.requestId;
      if(!requestId)throw new Error(data?.error||'الخادم لم يرجع تأكيداً بإنشاء الطلب.');
      const fareRaw=scheduled?initialOffer:(data.fixed_fare_egp??data.fixedFareEgp??data.fare_egp??data.fare);
      const distanceRaw=data.distance_km??data.distanceKm??routeDistanceKm;
      const fare=Number(fareRaw), distance=Number(distanceRaw);
      const fareLabel=Number.isFinite(fare)?`${fare.toLocaleString('ar-EG')} جنيه`:'—';
      const distanceLabel=Number.isFinite(distance)?`${distance.toFixed(1)} كم`:'غير متاحة';
      const requestStatus=data.request_status||data.requestStatus||data.status||'searching';
      const priceTitle=scheduled?'عرضك المبدئي':'السعر المحسوب بواسطة النظام';
      const nextStep=scheduled?'الكابتن يستطيع قبول عرضك أو إرسال عرض مقابل. تنتظر الرحلة موافقة الطرفين قبل التأكيد.':'سيظهر الطلب للكباتن ليقبل أحدهم المشوار بالسعر المحدد.';
      $('tripResult').innerHTML=`<h3>تم إرسال طلب المشوار</h3><div class="fare-line"><span>${priceTitle}</span><strong>${fareLabel}</strong></div><p>المسافة التقريبية: ${distanceLabel}</p><p>${nextStep}</p><p>رقم الطلب: <small dir="ltr">${esc(requestId)}</small></p><p class="muted">حالة الطلب: ${esc(requestStatus)}</p>`;
      $('tripResult').hidden=false;msg.textContent='تم إنشاء الطلب بنجاح.';button.textContent='تم إرسال الطلب';
    }catch(error){
      msg.textContent=error.message||'حصل خطأ غير متوقع. حاول مرة أخرى.';
      button.disabled=false;button.textContent=$('scheduleToggle').checked?'إرسال طلب التفاوض':'تأكيد وطلب المشوار';
    }
  });
}

async function myScheduledTrips() {
  layout(`
    <main class="wrap narrow">
      <button class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">الراكب · الرحلات المجدولة</span><h1>رحلاتي المجدولة</h1><p>تابع عروض الكباتن، فاوض على السعر، أو وافق على العرض المناسب.</p></section>
      <section id="scheduledList" class="panel">جاري تحميل رحلاتك...</section>
    </main>`);
  document.querySelector('#back').addEventListener('click',()=>{page='home';render();});
  const host=document.querySelector('#scheduledList');
  const {data,error}=await supabase.rpc('list_my_scheduled_trip_requests');
  if(error){host.innerHTML='<p class="message">تعذر تحميل الرحلات. تأكد من تطبيق تحديث قاعدة البيانات.</p>';return;}
  if(!data?.length){host.innerHTML='<p class="muted">لا توجد رحلات مجدولة حتى الآن.</p>';return;}
  host.innerHTML=data.map(r=>{
    const current=r.pending_offer_id ? (r.pending_offer_by_role==='captain'
      ? `<div class="notice">عرض الكابتن: <b>${Number(r.pending_offer_amount_egp).toLocaleString('ar-EG')} جنيه</b></div>
         <div class="scheduled-actions"><button class="btn primary" data-accept-offer="${r.pending_offer_id}">موافقة على السعر</button>
         <input type="number" min="1" step="1" inputmode="numeric" placeholder="سعرك المقابل" data-counter-amount="${r.request_id}">
         <button class="btn outline" data-counter-request="${r.request_id}">إرسال عرض مقابل</button></div>`
      : `<div class="notice">عرضك الحالي: <b>${Number(r.pending_offer_amount_egp).toLocaleString('ar-EG')} جنيه</b> · في انتظار رد الكباتن</div>`)
      : (r.request_status==='accepted' ? `<div class="notice">تم الاتفاق على السعر: <b>${Number(r.agreed_fare_egp).toLocaleString('ar-EG')} جنيه</b></div>` : '<p class="muted">في انتظار عروض الكباتن.</p>');
    return `<article class="scheduled-card"><b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b>
      <p>المركبة: ${esc(r.vehicle_type)} · الركاب: ${r.passenger_count}</p>
      <p>الموعد: ${new Date(r.scheduled_at).toLocaleString('ar-EG')}</p>
      <p>الحالة: ${esc(r.request_status)}</p>${current}</article>`;
  }).join('');
  host.querySelectorAll('[data-accept-offer]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    const {error}=await supabase.rpc('respond_scheduled_trip_offer',{p_offer_id:button.dataset.acceptOffer,p_vehicle_id:null});
    if(error){button.disabled=false;alert('تعذر قبول العرض. ربما انتهت صلاحيته أو تغيرت حالة الرحلة.');return;}
    myScheduledTrips();
  }));
  host.querySelectorAll('[data-counter-request]').forEach(button=>button.addEventListener('click',async()=>{
    const amount=Number(host.querySelector(`[data-counter-amount="${button.dataset.counterRequest}"]`)?.value);
    if(!Number.isFinite(amount)||amount<=0){alert('اكتب سعراً صحيحاً أكبر من صفر.');return;}
    button.disabled=true;
    const {error}=await supabase.rpc('passenger_counter_scheduled_trip_offer',{p_request_id:button.dataset.counterRequest,p_amount_egp:amount});
    if(error){button.disabled=false;alert('تعذر إرسال العرض المقابل. ربما وصل عرض آخر أو تم حسم الرحلة.');return;}
    myScheduledTrips();
  }));
}

async function captainDashboard() {
  layout(`
    <main class="wrap narrow">
      <button class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">الكابتن · الرحلات المجدولة</span><h1>طلبات التفاوض</h1><p>اقبل عرض الراكب أو قدم سعراً مقابلاً. لا تتأكد الرحلة إلا بعد الاتفاق.</p></section>
      <section id="captainScheduledList" class="panel">جاري تحميل الطلبات والمركبات...</section>
    </main>`);
  document.querySelector('#back').addEventListener('click',()=>{page='home';render();});
  const host=document.querySelector('#captainScheduledList');
  const [requestsResult,vehiclesResult]=await Promise.all([
    supabase.rpc('list_scheduled_trip_requests_for_captain'),
    supabase.from('vehicles').select('id,vehicle_type,passenger_capacity,make,model')
      .eq('captain_id',session.user.id).eq('approval_status','approved').eq('is_active',true)
  ]);
  if(requestsResult.error||vehiclesResult.error){
    host.innerHTML='<p class="message">تعذر تحميل الطلبات. تأكد من اعتماد حسابك واشتراكك وتطبيق تحديث قاعدة البيانات.</p>';return;
  }
  const vehicles=vehiclesResult.data||[];
  const requests=requestsResult.data||[];
  if(!requests.length){host.innerHTML='<p class="muted">لا توجد حالياً رحلات مجدولة مناسبة لمركباتك.</p>';return;}
  host.innerHTML=requests.map(r=>{
    const matching=vehicles.filter(v=>v.vehicle_type===r.vehicle_type&&v.passenger_capacity>=r.passenger_count);
    const options=matching.map(v=>`<option value="${v.id}">${esc([v.make,v.model].filter(Boolean).join(' '))||'مركبة'} · سعة ${v.passenger_capacity}</option>`).join('');
    return `<article class="scheduled-card"><b>${esc(r.origin_name)} ← ${esc(r.destination_name)}</b>
      <p>الموعد: ${new Date(r.scheduled_at).toLocaleString('ar-EG')} · عدد الركاب: ${r.passenger_count}</p>
      <p>عرض الراكب: <strong>${Number(r.passenger_offer_egp).toLocaleString('ar-EG')} جنيه</strong></p>
      ${matching.length?`<label>المركبة المناسبة<select data-vehicle-for="${r.request_id}">${options}</select></label>
      <div class="scheduled-actions"><button class="btn primary" data-accept-passenger-offer="${r.pending_offer_id}">قبول عرض الراكب</button>
      <input type="number" min="1" step="1" inputmode="numeric" placeholder="السعر المقابل" data-captain-amount="${r.request_id}">
      <button class="btn outline" data-captain-counter="${r.request_id}">إرسال عرض مقابل</button></div>`
      : '<p class="muted">لا توجد مركبة معتمدة ونشطة بسعة مناسبة لهذا الطلب.</p>'}
    </article>`;
  }).join('');
  host.querySelectorAll('[data-accept-passenger-offer]').forEach(button=>button.addEventListener('click',async()=>{
    const request=button.closest('.scheduled-card');
    const vehicleId=request.querySelector('select')?.value;
    if(!vehicleId){alert('اختار المركبة المناسبة أولاً.');return;}
    button.disabled=true;
    const {error}=await supabase.rpc('respond_scheduled_trip_offer',{p_offer_id:button.dataset.acceptPassengerOffer,p_vehicle_id:vehicleId});
    if(error){button.disabled=false;alert('تعذر قبول العرض. ربما تم حسم الرحلة بالفعل.');return;}
    captainDashboard();
  }));
  host.querySelectorAll('[data-captain-counter]').forEach(button=>button.addEventListener('click',async()=>{
    const requestId=button.dataset.captainCounter;
    const amount=Number(host.querySelector(`[data-captain-amount="${requestId}"]`)?.value);
    const vehicleId=host.querySelector(`[data-vehicle-for="${requestId}"]`)?.value;
    if(!vehicleId||!Number.isFinite(amount)||amount<=0){alert('اختار المركبة واكتب سعراً صحيحاً أكبر من صفر.');return;}
    button.disabled=true;
    const {error}=await supabase.rpc('captain_counter_scheduled_trip_offer',{p_request_id:requestId,p_vehicle_id:vehicleId,p_amount_egp:amount});
    if(error){button.disabled=false;alert('تعذر إرسال العرض المقابل. ربما تغيرت حالة الطلب.');return;}
    captainDashboard();
  }));
}

function placeholder(title, desc) {
  layout(`
    <main class="wrap narrow">
      <button class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">السكة · المرحلة التالية</span><h1>${title}</h1><p>${desc}</p></section>
      <section class="panel"><div class="notice">سيتم توصيل هذه الوظائف بعد استكمال اختبارات الأمان وقاعدة البيانات.</div></section>
    </main>`);
  document.querySelector('#back').addEventListener('click', () => { page = 'home'; render(); });
}

function render() {
  if (!supabase) return setup();
  if (!session) return auth();
  if (page === 'home') return home();
  if (page === 'trip') return tripForm();
  if (page === 'share') return placeholder('مشاركة السكة', 'ابحث عن رحلة مناسبة أو انشر طريقك كمقاعد متاحة.');
  if (page === 'myScheduled') return myScheduledTrips();
  if (page === 'captain') return captainDashboard();
  if (page === 'admin') return placeholder('لوحة الإدارة', 'مراجعة الحسابات والمركبات والاشتراكات والبلاغات.');
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
    else { profile = null; page = 'home'; render(); }
  });
}
init();
