# السكة V2

تطبيق ويب تقدمي عربي RTL لمنصة التنقل ومشاركة الطريق.

## التقنيات
- Vite
- Supabase Auth وDatabase
- Cloudflare Pages
- Leaflet وOpenStreetMap (مرحلة الخرائط)

## إعداد المتغيرات
أضف في إعدادات المشروع:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (مفتاح Publishable)

لا تضع service_role أو أي Secret Key في الواجهة أو GitHub.

## Cloudflare Pages
- Build command: `npm run build`
- Build output directory: `dist`

هذه النسخة هي هيكل الواجهة وتسجيل الدخول. صفحات الطلب والحجز والإدارة ستُستكمل بعد مراجعة واختبار سياسات قاعدة البيانات ودوال RPC.

## منطق الرحلات
- المشوار الفوري يستخدم `create-fixed-trip` ويحسب النظام السعر تلقائياً من قواعد `trip_pricing_rules`.
- الرحلة المجدولة تستخدم `create-scheduled-trip`؛ يبدأ الراكب بعرض سعر، ويستطيع الكابتن القبول أو تقديم عرض مقابل، ثم يوافق الراكب أو يفاوض مرة أخرى.
- لا يُثبت سعر الرحلة المجدولة ولا تتحول إلى `accepted` إلا بعد قبول أحد الطرفين آخر عرض معلّق.
- خطوط السير الثابتة ستستخدم منطق التفاوض نفسه، مع إعدادات الخط والتكرار والسعة في مرحلة الخطوط.
- مشاركة السكة تظل مستقلة عن الرحلات العادية والمجدولة.

## تحديث الرحلات المجدولة
1. طبّق ملف SQL الإضافي `supabase/migrations/202611200002_scheduled_trip_negotiation.sql` على قاعدة Supabase الحالية. الملف إضافي ولا يحذف أو يعيد إنشاء الجداول الحالية.
2. انشر Edge Function باسم `create-scheduled-trip` من `supabase/functions/create-scheduled-trip/index.ts` مع نفس أسرار Supabase الموجودة في دالة المشوار العادي.
3. حدّث Edge Function `create-fixed-trip` من ملفها في المستودع حتى ترفض تمرير الرحلات المجدولة إلى مسار السعر الثابت.
4. Cloudflare Pages ينشر واجهة الموقع من فرع `main` تلقائياً إذا كان الربط التلقائي مفعلاً.

ملاحظة: وجود الملفات في GitHub لا يعني أن SQL أو Edge Functions قد طُبقت على مشروع Supabase الحي.
