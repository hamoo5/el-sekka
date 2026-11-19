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
        <p>مشوار عادي بسعر واضح، أو مشاركة طريق وحجز كرسي باتفاق الطرفين.</p>
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
        <button class="service" data-page="trip"><span>🚕</span><b>مشوار عادي</b><small>سعر ثابت وواضح للطرفين</small><strong>اطلب مشوار ←</strong></button>
        <button class="service" data-page="share"><span>🛣️</span><b>مشاركة السكة</b><small>احجز كرسي أو انشر طريقك</small><strong>اكتشف الرحلات ←</strong></button>
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
        <section class="trip-summary" id="tripSummary"><div><small>المسافة</small><b id="summaryDistance">—</b></div><div><small>الوقت المتوقع</small><b id="summaryDuration">—</b></div><div><small>السعر النهائي</small><b id="summaryFare">—</b></div></section>
        <div class="notice">السعر النهائي يُحسب من قواعد التسعير المعتمدة على الخادم. لا توجد عمولة على الرحلة، والدفع للكابتن نقداً.</div>
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
    if (moveMap) map.setView([place.lat,place.lng],15);
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
    $('scheduleField').hidden=!e.target.checked;
    $('scheduledAt').required=e.target.checked;
    if(!e.target.checked)$('scheduledAt').value='';
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
    button.disabled=true;button.textContent='جارٍ حساب المسافة والسعر...';
    msg.textContent='بنحسب المسافة ونتأكد من السعر على الخادم.';
    try{
      const {data,error}=await supabase.functions.invoke('create-fixed-trip',{body:{
        vehicle_type:$('vehicleType').value,
        origin_name:origin.name,origin_lat:origin.lat,origin_lng:origin.lng,
        destination_name:destination.name,destination_lat:destination.lat,destination_lng:destination.lng,
        is_scheduled:scheduled,scheduled_at:scheduledAt,passenger_count:Number($('passengerCount').value)
      }});
      if(error){
        let details=error.message||'تعذر إرسال الطلب.';
        try{const body=await error.context?.json();if(body?.error)details=body.error;}catch(_){}
        throw new Error(details);
      }
      const requestId=data?.request_id||data?.requestId;
      if(!requestId)throw new Error(data?.error||'الخادم لم يرجع تأكيداً بإنشاء الطلب.');
      const fare=data.fixed_fare_egp??data.fixedFareEgp??data.fare_egp??data.fare;
      const distance=data.distance_km??data.distanceKm;
      const requestStatus=data.request_status||data.requestStatus||data.status||'searching';
      $('tripResult').innerHTML=`<h3>تم إرسال طلب المشوار</h3><div class="fare-line"><span>السعر الثابت</span><strong>${Number(fare).toLocaleString('ar-EG')} جنيه</strong></div><p>المسافة التقريبية: ${Number(distance).toFixed(1)} كم</p><p>رقم الطلب: <small dir="ltr">${esc(requestId)}</small></p><p class="muted">حالة الطلب: ${esc(requestStatus)}</p>`;
      $('tripResult').hidden=false;msg.textContent='تم إنشاء الطلب بنجاح.';button.textContent='تم إرسال الطلب';
    }catch(error){
      msg.textContent=error.message||'حصل خطأ غير متوقع. حاول مرة أخرى.';
      button.disabled=false;button.textContent='تأكيد وطلب المشوار';
    }
  });
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
  if (page === 'captain') return placeholder('لوحة الكابتن', 'إدارة المركبة والرحلات والحجوزات والاشتراك.');
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
