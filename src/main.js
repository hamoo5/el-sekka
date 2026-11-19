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

function tripForm() {
  const types = [
    ['private_car','ملاكي'],['taxi','تاكسي'],['suzuki','سوزوكي'],
    ['microbus','ميكروباص'],['scooter','اسكوتر'],['motorcycle','موتوسيكل']
  ];
  layout(`
    <main class="wrap narrow">
      <button class="back" id="back">→ الرئيسية</button>
      <section class="hero compact"><span class="tag">مشوار عادي · سعر ثابت</span><h1>اطلب مشوارك</h1><p>حدد نقطة الركوب والوجهة، والنظام يحسب السعر قبل إرسال الطلب.</p></section>
      <form class="panel form" id="tripForm">
        <label>نوع المركبة
          <select name="vehicle_type" id="vehicleType" required>${types.map(([v,n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        </label>
        <label>مكان الركوب
          <input id="originName" required placeholder="مثال: التجمع الخامس، شارع التسعين" autocomplete="street-address">
        </label>
        <div class="place-actions">
          <button class="btn outline" type="button" id="findOrigin">تحديد العنوان</button>
          <button class="btn outline" type="button" id="useLocation">استخدم موقعي الحالي</button>
        </div>
        <p class="place-status" id="originStatus">لم يتم تحديد الموقع بعد.</p>
        <label>الوجهة
          <input id="destinationName" required placeholder="مثال: مدينة نصر، عباس العقاد" autocomplete="off">
        </label>
        <button class="btn outline" type="button" id="findDestination">تحديد الوجهة على الخريطة النصية</button>
        <p class="place-status" id="destinationStatus">اكتب الوجهة واضغط تحديد الوجهة.</p>
        <label>عدد الركاب
          <select name="passenger_count" id="passengerCount">
            ${Array.from({length:13},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}
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
  const $ = id => document.getElementById(id);
  $('back').addEventListener('click', () => { page = 'home'; render(); });
  const status = (id, message, bad=false) => { $(id).textContent = message; $(id).classList.toggle('error', bad); };
  const locate = async (field, statusId) => {
    const value = $(field).value.trim();
    if (!value) { status(statusId, 'اكتب العنوان أولاً.', true); return null; }
    status(statusId, 'جارٍ تحديد العنوان...');
    try {
      const point = await findPlace(value);
      if (field === 'originName') origin = point; else destination = point;
      status(statusId, 'تم تحديد: ' + point.name);
      return point;
    } catch (e) { status(statusId, e.message, true); return null; }
  };
  $('findOrigin').addEventListener('click', () => locate('originName','originStatus'));
  $('findDestination').addEventListener('click', () => locate('destinationName','destinationStatus'));
  $('originName').addEventListener('input', () => { origin = null; status('originStatus','العنوان اتغير؛ اضغط تحديد العنوان مرة أخرى.'); });
  $('destinationName').addEventListener('input', () => { destination = null; status('destinationStatus','الوجهة اتغيرت؛ اضغط تحديد الوجهة مرة أخرى.'); });
  $('useLocation').addEventListener('click', () => {
    if (!navigator.geolocation) { status('originStatus','تحديد الموقع غير مدعوم على هذا الجهاز.',true); return; }
    status('originStatus','جارٍ تحديد موقعك...');
    navigator.geolocation.getCurrentPosition(async pos => {
      origin = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: 'موقعي الحالي' };
      try {
        const u = new URL('https://nominatim.openstreetmap.org/reverse');
        u.search = new URLSearchParams({lat:String(origin.lat),lon:String(origin.lng),format:'jsonv2'});
        const r = await fetch(u);
        if (r.ok) { const d = await r.json(); if (d.display_name) origin.name = d.display_name; }
      } catch (_) {}
      $('originName').value = origin.name;
      status('originStatus','تم تحديد موقع الركوب بنجاح.');
    }, err => status('originStatus', err.code === 1 ? 'اسمح للموقع بالوصول إلى موقعك من إعدادات المتصفح.' : 'تعذر تحديد موقعك. اكتب العنوان يدوياً.', true), {enableHighAccuracy:true,timeout:15000});
  });
  $('scheduleToggle').addEventListener('change', e => {
    $('scheduleField').hidden = !e.target.checked;
    $('scheduledAt').required = e.target.checked;
  });
  $('vehicleType').addEventListener('change', e => {
    const caps = {private_car:3,taxi:4,suzuki:6,microbus:13,scooter:1,motorcycle:1};
    const max = caps[e.target.value] || 1;
    $('passengerCount').innerHTML = Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
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
      if (!data || !data.request_id) throw new Error(data?.error || 'الخادم لم يرجع تأكيداً بإنشاء الطلب.');
      $('tripResult').innerHTML = `
        <h3>تم إرسال طلب المشوار</h3>
        <div class="fare-line"><span>السعر الثابت</span><strong>${Number(data.fixed_fare_egp).toLocaleString('ar-EG')} جنيه</strong></div>
        <p>المسافة التقريبية: ${Number(data.distance_km).toFixed(1)} كم</p>
        <p>رقم الطلب: <small dir="ltr">${esc(data.request_id)}</small></p>
        <p class="muted">حالة الطلب: ${esc(data.request_status || 'searching')}</p>`;
      $('tripResult').hidden = false;
      msg.textContent = 'تم إنشاء الطلب بنجاح.';
      button.textContent = 'تم إرسال الطلب';
    } catch (err) {
      msg.textContent = err.message || 'حصل خطأ غير متوقع. حاول مرة أخرى.';
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