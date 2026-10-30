# تخصيص سير العمل والفريق

نعم — يمكن للمالك تعديل السلوك عبر الإعدادات والبيئة والكود. لا توجد واجهة «اسحب وأسقط أعضاء فريق جدد»؛ التوسيع يكون عبر الملفات أدناه.

## ١) البيئة (`.env`)

انسخ `.env.example` → `.env`. أهم المفاتيح للفريق/المسار:

- `AGENCY_MODE=1|0` — LangGraph مقابل السرب التراثي  
- `HYBRID_MODE`, `FORCE_LOCAL_SPECIALISTS`, نماذج `CEO_MODEL` / `SAM_*`  
- `IMPLEMENT_GO`, `RUN_LEVEL3`, `TARGET_REPO`  
- موافقات `APPROVE_*` و`SAM_TRUST_*`  
- سطح المكتب `SAM_DESKTOP_*`  
- `SAM_LOCALE=ar|en`

## ٢) ملف الهجين (واجهة أو API)

Control Plane → تبويب الهجين، أو:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/hybrid-profile
```

يضبط `mode`, `costCapUsd`, وملاحظات. خريطة `roles` في الملف موجودة لكن **التوجيه الحي لا يقرأها بعد** (`cloudAllowedForRole` غير مستخدم) — **مخطط / جزئي**.

## ٣) تفويض التنفيذ Go/No-Go

```json
{ "decision": "GO", "by": "owner", "at": "2026-01-01T00:00:00.000Z", "reason": "…" }
```

من `go-nogo.example.json`. أو `--go` / `IMPLEMENT_GO=1`.

## ٤) MCP — إضافة أدوات خارجية

```bash
cp mcp.example.json mcp.json
# أضف خوادم stdio أو HTTP تحت mcpServers
```

تظهر للـ operator/implementer بعد اجتياز المصفوفة.

## ٥) جذور مساحة العمل

`workspace-roots.example.json` → `workspace-roots.json` أو `WORKSPACE_ROOTS` / `WORKSPACE_DENY`.

## ٦) توسيع الأدوار في الكود (خطوة بخطوة)

1. أضف `RoleId` في `src/agency/types.ts`  
2. أضف عقداً في `AGENCY_ROLES` داخل `roles.ts`  
3. عرّف أدواته في `ROLE_CAPABILITIES` (`capabilities.ts`)  
4. استدعِ النموذج من `runner.ts` أو مسار جديد عبر `makeSpecialistModel({ role: "…" })`  
5. أضف اختباراً في `tests/capabilities.test.ts` أو smoke  
6. وثّق القدرة في `docs/help` (هذا المجلد) حتى لا تُخترع لاحقاً  

## ٧) تغيير مسار المهمة

- في الواجهة: مسار auto / architecture / operational / implement  
- في `task.ts`: حقل `route`  
- CLI: نص المهمة + `--implement` / `--implement-only` / `--go`

## ٨) خطة Level-3

ضع `level3-plan.json` في مجلد الحزمة:

```json
{
  "title": "patch",
  "branchPrefix": "sam-harness/l3",
  "writes": [{ "path": "src/x.ts", "content": "…" }],
  "patches": [],
  "testCommand": "pnpm",
  "testArgs": ["test"]
}
```

## ٩) Daily Ops / الذاكرة / الاتصالات

من لوحة التحكم — لا حاجة لتعديل كود لإضافة مهمة يومية أو ملاحظة ذاكرة أو مسودة بريد.

## ما ليس منفّذاً

- محرّر رسومي لمخطط LangGraph  
- تعيين نموذج مختلف لكل دور من الواجهة  
- فرض خريطة `roles` في ملف الهجين على التوجيه الحي (موجودة كبيانات فقط حالياً)
