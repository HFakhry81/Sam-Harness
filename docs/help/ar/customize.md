# تخصيص سير العمل والفريق

نعم — يمكن للمالك التعديل عبر **إعداد الفريق** والبيئة وواجهة/API لوحة التحكم، والكود عند الحاجة المتقدمة.

## ١) إعداد الفريق (المرحلة 8 — بدون كود)

الملف: `config/team.json` (المخطط: `config/team.schema.json`).

- إضافة / تعديل / تعطيل أدوار (الأدوار المخصّصة تحتاج `prompt` ونماذج)
- نموذج لكل دور: محلي + سحابة + مجاني اختياري
- إعادة ترتيب أو تعطيل خطوات ما بعد `APPROVED`
- **ثوابت:** حلقة المراجعة (strategist ↔ auditor ≤5) وبوابة GO لا تُلغى

لوحة التحكم → تبويب **الفريق** (عربي RTL)، أو:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/team
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://127.0.0.1:8787/api/team/pipeline \
  -d '{"downstreamOrder":["architect","help","marketer","verifier"]}'
```

سجل التدقيق: `team_config.save` / `team_role.upsert` / `team_role.delete`.

تجاوزات النماذج: `SAM_ROLE_<ROLE>_MODEL` / `_CLOUD_MODEL` / `_FREE_MODEL`.

## ١‑ب) المحرّر الرسومي (المرحلة 9)

لوحة التحكم → تبويب **المسار الرسومي**: لوحة SVG محلية (بدون CDN) تعرض الراوتر والمسار التشغيلي والاستقبال والأدلة وحلقة المراجعة وبوابة GO والمتخصصين والتسليم وLevel-3.

- اسحب العقد، أعد ترتيب المتخصصين، أضف أدواراً مخصّصة، عطّل/احذف المخصّص
- لوحة جانبية للخصائص (مطالبة، نماذج، prefersCloud، أدوات) مع تحقق
- **مقفلة:** حلقة المراجعة وبوابة GO — أخطاء واضحة عند التجاوز
- مسودة مقابل تطبيق، تراجع/إعادة، تصدير/استيراد JSON، إعادة للافتراضي
- التخطيط في `config/workflow-layout.json` منفصل عن الدلالة في `team.json`
- شارات التوجيه الحي من `/api/routing/effective`

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/workflow
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://127.0.0.1:8787/api/workflow/graph \
  -d '{"graph":{…}}'
```

تفاصيل: `docs/PHASE9_VISUAL_EDITOR.md`.

## ٢) البيئة (`.env`)

انسخ `.env.example` → `.env`. أهم المفاتيح: `AGENCY_MODE`, `HYBRID_MODE`, `SAM_ROLE_*`, `APPROVE_*`, `SAM_DESKTOP_*`, `SAM_LOCALE`.

## ٣) ملف الهجين

Control Plane → الهجين، أو `/api/hybrid-profile`. خريطة `roles` **تُقرأ حياً** (السقف يفوز دائماً). انظر أيضاً `/api/routing/effective`.

## ٤) Go/No-Go وMCP والجذور

كما سبق: `go-nogo.json` / `--go`، `mcp.json`، `workspace-roots.json`.

## ٥) تغيير المسار وخطة Level-3 وDaily Ops

من الواجهة أو `task.ts` أو CLI — بدون كود للمهام اليومية/الذاكرة/البريد.

## ما يزال غير منفّذ

- تكافؤ AT-SPI كامل مع Windows UIA على كل توزيعات لينكس دون تثبيت حزم النظام
- تحرير حرّ لكل حافة LangGraph خارج عمود المسار المسموح (المتخصصون بعد GO فقط)
