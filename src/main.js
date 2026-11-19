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

async function findPlace(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', countrycodes: 'eg' });
  const response = await fetch(url);
  if (!response.ok) throw new Error('تعذر البحث عن العنوان حالياً.');
  const rows = await response.json();
  if (!rows.length) throw new Error('العنوان غير واضح. جرّب كتابة اسم المنطقة والشارع.');
  return { name: rows[0].display_name, lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
}

async function reversePlace(lat, lng) {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({lat:String(lat),lon:String(lng),format:'jsonv2'});
    const response = await fetch(url);
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
    <main class="wrap narrow">
      <button class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">مشوار عادي · سعر ثابت</span><h1>اطلب مشوارك</h1><p>اختار المركبة وحدد الركوب والوجهة على الخريطة، والسعر يظهر قبل إرسال الطلب.</p></section>
      <form class="panel form" id="tripForm">
        <fieldset class="vehicle-field">
          <legend>اختار نوع المركبة</legend>
          <div class="vehicle-grid">
            ${types.map(([value,icon,name,desc]) => `
              <button class="vehicle-card ${value === 'bus' ? 'coming-soon' : ''}" type="button" data-vehicle="${value}" ${value === 'bus' ? 'disabled aria-disabled="true"' : ''}>
                <span class="vehicle-icon">${icon}</span><b>${name}</b><small>${desc}</small>
              </button>`).join('')}
          </div>
          <input type="hidden" name="vehicle_type" id="vehicleType" value="private_car">
        </fieldset>
        <label>مكان الركوب
          <input id="originName" required placeholder="اكتب المنطقة أو اختار نقطة على الخريطة" autocomplete="street-address">
        </label>
        <div class="place-actions">
          <button class="btn outline" type="button" id="findOrigin">تحديد العنوان</button>
          <button class="btn outline" type="button" id="useLocation">استخدم موقعي الحالي</button>
        </div>
        <p class="place-status" id="originStatus">اضغط على الخريطة لتحديد مكان الركوب.</p>
        <label>الوجهة
          <input id="destinationName" required placeholder="اكتب الوجهة أو اختارها على الخريطة" autocomplete="off">
        </label>
        <button class="btn outline" type="button" id="findDestination">تأكيد عنوان الوجهة</button>
        <p class="place-status" id="destinationStatus">اختار الوجهة من الخريطة أو ابحث بالاسم.</p>
        <div class="map-heading"><b>حدد النقطتين على الخريطة</b><small>اضغط على الخريطة لوضع الدبوس للمكان المحدد بالأسفل.</small></div>
        <div class="map-pick-mode">
          <button type="button" class="map-mode active" id="pickOrigin">📍 تحديد الركوب</button>
          <button type="button" class="map-mode" id="pickDestination">🏁 تحديد الوجهة</button>
        </div>
        <div id="tripMap" class="trip-map" role="application" aria-label="خريطة تحديد مكان الركوب والوجهة"></div>
        <p class="map-hint" id="mapHint">الوضع الحالي: تحديد مكان الركوب.</p>
        <label>عدد الركاب
          <select name="passenger_count" id="passengerCount">
            <option value="1">1</option><option value="2">2</option><option value="3">3</option>
          </select>
        </label>
        <label class="schedule-toggle"><input type="checkbox" id="scheduleToggle"> حجز المشوار في موعد لاحق</label>
        <label id="scheduleField" hidden>موعد المشوار
          <input type="datetime-local" id="scheduledAt">
        </label>
        <div class="notice">السعر ثابت ويظهر بعد تحديد المسافة. لا توجد عمولة على الرحلة، والدفع للكابتن نقداً.</div>
        <button class="btn primary" type="submit" id="sendTrip">احسب السعر واطلب المشوار</button>
        <p class="message" id="tripMessage" aria-live="polite"></p>
        <section id="tripResult" class="trip-result" hidden></section>
      </form>
    </main>`);

  let origin = null;
  let destination = null;
  let activePoint = 'origin';
  let map = null;
  let originMarker = null;
  let destinationMarker = null;
  let routeLine = null;
  const $ = id => document.getElementById(id);
  const status = (id, message, bad=false) => { $(id).textContent = message; $(id).classList.toggle('error', bad); };
  $('back').addEventListener('click', () => { page = 'home'; render(); });

  const setVehicle = value => {
    $('vehicleType').value = value;
    document.querySelectorAll('.vehicle-card').forEach(card => card.classList.toggle('selected', card.dataset.vehicle === value));
    const caps = {private_car:3,taxi:4,suzuki:6,microbus:13,scooter:1,motorcycle:1};
    const max = caps[value] || 1;
    $('passengerCount').innerHTML = Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
  };
  document.querySelectorAll('.vehicle-card:not(:disabled)').forEach(card => card.addEventListener('click', () => setVehicle(card.dataset.vehicle)));
  setVehicle('private_car');

  const setActivePoint = point => {
    activePoint = point;
    $('pickOrigin').classList.toggle('active', point === 'origin');
    $('pickDestination').classList.toggle('active', point === 'destination');
    $('mapHint').textContent = point === 'origin' ? 'الوضع الحالي: اضغط لتحديد مكان الركوب.' : 'الوضع الحالي: اضغط لتحديد الوجهة.';
  };
  $('pickOrigin').addEventListener('click', () => setActivePoint('origin'));
  $('pickDestination').addEventListener('click', () => setActivePoint('destination'));

  const drawRoute = async () => {
    if (!origin || !destination || !map) return;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || data.code !== 'Ok' || !data.routes?.length) throw new Error('لا يوجد مسار قيادة متاح بين النقطتين.');
      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.geoJSON(data.routes[0].geometry, {style:{color:'#a8e85e',weight:5,opacity:.9}}).addTo(map);
      map.fitBounds(routeLine.getBounds(), {padding:[28,28]});
      $('mapHint').textContent = `تم رسم المسار التقريبي على الخريطة · ${(data.routes[0].distance/1000).toFixed(1)} كم`;
    } catch (error) {
      $('mapHint').textContent = error.message || 'تعذر رسم المسار الآن؛ تأكد من النقطتين.';
    }
  };

  const setPoint = async (point, lat, lng, name = null) => {
    const place = {lat:Number(lat),lng:Number(lng),name:name || 'نقطة محددة على الخريطة'};
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    if (!name) place.name = await reversePlace(place.lat, place.lng);
    const isOrigin = point === 'origin';
    if (isOrigin) {
      origin = place;
      $('originName').value = place.name;
      status('originStatus','تم تحديد مكان الركوب على الخريطة.');
      if (originMarker) originMarker.setLatLng([place.lat,place.lng]);
      else originMarker = L.marker([place.lat,place.lng], {draggable:true}).addTo(map).bindPopup('مكان الركوب');
      originMarker.off('dragend').on('dragend', async event => {
        const p = event.target.getLatLng();
        await setPoint('origin',p.lat,p.lng);
      });
    } else {
      destination = place;
      $('destinationName').value = place.name;
      status('destinationStatus','تم تحديد الوجهة على الخريطة.');
      if (destinationMarker) destinationMarker.setLatLng([place.lat,place.lng]);
      else destinationMarker = L.marker([place.lat,place.lng], {draggable:true}).addTo(map).bindPopup('الوجهة');
      destinationMarker.off('dragend').on('dragend', async event => {
        const p = event.target.getLatLng();
        await setPoint('destination',p.lat,p.lng);
      });
    }
    if (origin && destination) await drawRoute();
  };

  try {
    if (!window.L) throw new Error('تعذر تحميل مكتبة الخريطة.');
    map = L.map('tripMap', {zoomControl:true}).setView([30.0444,31.2357], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    map.on('click', async event => {
      await setPoint(activePoint,event.latlng.lat,event.latlng.lng);
    });
    setTimeout(() => map.invalidateSize(), 150);
  } catch (error) {
    $('tripMap').innerHTML = '<p class="map-error">تعذر تحميل الخريطة. يمكنك استخدام البحث عن العنوان مؤقتاً.</p>';
    $('mapHint').textContent = error.message;
  }

  const locate = async (field, pointName, statusId) => {
    const value = $(field).value.trim();
    if (!value) { status(statusId,'اكتب العنوان أولاً.',true); return; }
    status(statusId,'جارٍ البحث عن العنوان...');
    try {
      const point = await findPlace(value);
      await setPoint(pointName,point.lat,point.lng,point.name);
      if (map) map.setView([point.lat,point.lng],15);
    } catch (error) { status(statusId,error.message,true); }
  };
  $('findOrigin').addEventListener('click', () => locate('originName','origin','originStatus'));
  $('findDestination').addEventListener('click', () => locate('destinationName','destination','destinationStatus'));
  $('originName').addEventListener('input', () => { origin = null; if(originMarker && map) map.removeLayer(originMarker); originMarker = null; if(routeLine && map) map.removeLayer(routeLine); routeLine = null; status('originStatus','العنوان اتغير؛ اضغط تحديد العنوان أو اختار على الخريطة.'); });
  $('destinationName').addEventListener('input', () => { destination = null; if(destinationMarker && map) map.removeLayer(destinationMarker); destinationMarker = null; if(routeLine && map) map.removeLayer(routeLine); routeLine = null; status('destinationStatus','الوجهة اتغيرت؛ اضغط تأكيد العنوان أو اختار على الخريطة.'); });

  $('useLocation').addEventListener('click', () => {
    if (!navigator.geolocation) { status('originStatus','تحديد الموقع غير مدعوم على هذا الجهاز.',true); return; }
    status('originStatus','جارٍ تحديد موقعك...');
    navigator.geolocation.getCurrentPosition(async pos => {
      await setPoint('origin',pos.coords.latitude,pos.coords.longitude,'موقعي الحالي');
      $('originName').value = origin.name;
      status('originStatus','تم تحديد موقع الركوب بنجاح.');
      if (map) map.setView([origin.lat,origin.lng],16);
    }, err => status('originStatus',err.code === 1 ? 'اسمح للموقع بالوصول إلى موقعك من إعدادات المتصفح.' : 'تعذر تحديد موقعك. اكتب العنوان يدوياً.',true), {enableHighAccuracy:true,timeout:15000});
  });

  $('scheduleToggle').addEventListener('change', e => {
    $('scheduleField').hidden = !e.target.checked;
    $('scheduledAt').required = e.target.checked;
    if (!e.target.checked) $('scheduledAt').value = '';
  });

  $('tripForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('tripMessage');
    const button = $('sendTrip');
    msg.textContent = '';
    $('tripResult').hidden = true;
    if (!origin) { status('originStatus','حدد مكان الركوب أولاً.',true); return; }
    if (!destination) { status('destinationStatus','حدد الوجهة أولاً.',true); return; }
    if (origin.lat === destination.lat && origin.lng === destination.lng) { msg.textContent = 'مكان الركوب والوجهة متطابقان.'; return; }
    const scheduled = $('scheduleToggle').checked;
    let scheduledAt = null;
    if (scheduled) {
      const raw = $('scheduledAt').value;
      if (!raw || new Date(raw).getTime() <= Date.now()) { msg.textContent = 'اختر موعداً مستقبلياً صحيحاً.'; return; }
      scheduledAt = new Date(raw).toISOString();
    }
    button.disabled = true;
    button.textContent = 'جارٍ حساب المسافة والسعر...';
    msg.textContent = 'بنحسب المسافة ونتأكد من السعر على الخادم.';
    try {
      const { data, error } = await supabase.functions.invoke('create-fixed-trip', {
        body: {
          vehicle_type: $('vehicleType').value,
          origin_name: origin.name,
          origin_lat: origin.lat,
          origin_lng: origin.lng,
          destination_name: destination.name,
          destination_lat: destination.lat,
          destination_lng: destination.lng,
          is_scheduled: scheduled,
          scheduled_at: scheduledAt,
          passenger_count: Number($('passengerCount').value)
        }
      });
      if (error) {
        let details = error.message || 'تعذر إرسال الطلب.';
        try { const body = await error.context?.json(); if (body?.error) details = body.error; } catch (_) {}
        throw new Error(details);
      }
      const requestId = data?.request_id || data?.requestId;
      if (!requestId) throw new Error(data?.error || 'الخادم لم يرجع تأكيداً بإنشاء الطلب.');
      const fare = data.fixed_fare_egp ?? data.fixedFareEgp ?? data.fare_egp ?? data.fare;
      const distance = data.distance_km ?? data.distanceKm;
      const requestStatus = data.request_status || data.requestStatus || data.status || 'searching';
      $('tripResult').innerHTML = `
        <h3>تم إرسال طلب المشوار</h3>
        <div class="fare-line"><span>السعر الثابت</span><strong>${Number(fare).toLocaleString('ar-EG')} جنيه</strong></div>
        <p>المسافة التقريبية: ${Number(distance).toFixed(1)} كم</p>
        <p>رقم الطلب: <small dir="ltr">${esc(requestId)}</small></p>
        <p class="muted">حالة الطلب: ${esc(requestStatus)}</p>`;
      $('tripResult').hidden = false;
      msg.textContent = 'تم إنشاء الطلب بنجاح.';
      button.textContent = 'تم إرسال الطلب';
    } catch (error) {
      msg.textContent = error.message || 'حصل خطأ غير متوقع. حاول مرة أخرى.';
      button.disabled = false;
      button.textContent = 'احسب السعر واطلب المشوار';
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
