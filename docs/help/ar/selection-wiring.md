# الاختيار والتوصيل حسب نظام التشغيل

## كيف يُختار النموذج

1. `FORCE_LOCAL_SPECIALISTS=1` → دائماً محلي  
2. وإلا `HYBRID_MODE` من البيئة إن وُجد (`local` | `cloud` | `auto`)  
3. وإلا ملف الهجين من قاعدة البيانات / `hybrid-profile.json`  
4. الافتراضي: `auto`  
5. ثم `resolveModelRoute` حسب الصعوبة والمفتاح والميزانية المتبقية و`SAM_COST_NEAR_CAP_RATIO`

ملف الهجين يحمل خريطة أدوار (`ceo_router`→local، متخصصون→auto) لكن الدالة `cloudAllowedForRole` **معرّفة وغير مستخدمة** في التوجيه الحي حالياً — التوجيه عالمي + صعوبة.

## المزودون وعناوين الأساس

| الطبقة | Base URL | المفتاح | التكلفة |
| --- | --- | --- | --- |
| local | `SAM_LOCAL_BASE_URL` | لا يلزم | $0 |
| free | `SAM_FREE_BASE_URL` | `SAM_FREE_API_KEY` | $0 إن ضُبطت |
| paid | `SAM_PAID_BASE_URL` | `OLLAMA_API_KEY` | تُحسب ضمن السقف اليومي |

التفعيل البرمجي: `ChatOllama` من `@langchain/ollama` في `makeCeoModel` / `makeSpecialistModel`.

## MCP

- الإعداد: انسخ `mcp.example.json` → `mcp.json` أو عيّن `MCP_CONFIG`
- العميل: `src/tools/mcp.ts` (stdio وHTTP)
- الأدوات تظهر كـ `mcp_call` أو `mcp:server:name`
- تُصفّى حسب مصفوفة الدور؛ بيئة العمليات الفرعية تُجرَّد من الأسرار

## سجل الأدوات

`src/tools/registry.ts` ينفّذ الأدوات بعد `assertToolAllowed`. تشمل: ملفات، Excel، صدفة محدودة، `run_node_sandbox`، MCP، وسطح المكتب `desktop_*`.

## فروقات أنظمة التشغيل في التوصيل

| المكوّن | Ubuntu/Linux | Windows | macOS |
| --- | --- | --- | --- |
| Ollama محلي على 11434 | يعمل إن نُصِّب | يعمل إن نُصِّب | يعمل إن نُصِّب |
| مشغّل UIA | **stub — غير منفّذ** | PowerShell/.NET UIA | **stub — غير منفّذ** |
| `screenshot` (أداة بسيطة) | لا | نعم (GDI) | لا |
| `open_path` | `xdg-open` | `start` | `open` |
| `run_shell` | بادئات مسموحة موجّهة لأوامر ويندوز/PowerShell — فائدة محدودة على يونكس | نعم ضمن القائمة البيضاء | محدود كالينكس |
| تثبيت بنقرة | `scripts/install/install.sh` | `install.ps1` / `.cmd` | `install.sh` |
| قاعدة البيانات | SQLite افتراضي؛ Postgres اختياري عبر `DATABASE_URL` | نفسها | نفسها |

لا يوجد «اختيار وكيل حسب نظام التشغيل» منفصل — نفس الأدوار على كل المنصات؛ ما يختلف هو **خلفيات الأدوات** (سطح المكتب خصوصاً).
