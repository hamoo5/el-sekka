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