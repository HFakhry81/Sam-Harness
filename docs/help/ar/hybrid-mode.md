# محلي مقابل سحابة مقابل هجين

المصدر: `src/lib/cost/router.ts`, `difficulty.ts`, `config.ts`, `src/controlplane/hybridProfile.ts`, `src/agent/models.ts`, `.env.example`.

## قرار الوضع

| الوضع | السلوك |
| --- | --- |
| `local` | لا مدفوع أبداً — يتجاهل مفتاح السحابة |
| `auto` (افتراضي) | رخيص/قياسي → محلي؛ ممتاز → مدفوع إن وُجد مفتاح وميزانية، وإلا free→local |
| `cloud` | يفضّل المدفوع لغير الرخيص عند القدرة؛ قرب/نفاد السقف ينزل لـ free/local؛ إن نفد السقف أو $0 قد يرمي `CostCapExceededError` بدل تشغيل صامت بلا دفع |

الأسبقية: `FORCE_LOCAL_SPECIALISTS=1` → `HYBRID_MODE` env → ملف الهجين في DB → افتراضي `auto`.

واجهة التحكم: تبويب **الهجين** (`GET/POST /api/hybrid-profile`) و`GET /api/cost-usage`.

## السقف اليومي $0.50

- الثابت: `DEFAULT_COST_CAP_USD = 0.5` في `hybridProfile.ts`
- يُخزَّن لكل tenant؛ `$0` يمنع كل استدعاءات السحابة
- فقط الاستدعاءات بـ `cloud: true` تُحسب ضمن السقف
- لا يُسمح بتجاوز السقف (`assertWithinCostCap` / `canAffordPaid`)

## سلوك قرب السقف

- عندما `المتبقي / السقف ≤ SAM_COST_NEAR_CAP_RATIO` (افتراضي `0.15` أي بعد صرف ≈٨٥٪): `shouldDegradeToLocal` → **لا مدفوع**؛ يفضّل free إن وُجد وإلا local
- موافقة إنفاق: شحنة واحدة ≥ `SAM_TRUST_SPEND_APPROVAL_USD` (افتراضي `0.25`) تحتاج `APPROVE_SPEND=1` مع بقاء فرض السقف

## التوجيه بالصعوبة

| الدرجة | درجة تقريبية | أمثلة أدوار |
| --- | --- | --- |
| cheap | ≤0.28 | ceo_router, operator, evidence |
| standard | وسط | افتراضي / help / marketer |
| premium | ≥0.7 | auditor, architect, strategist, coder |

تصعيد: ثقة أقل من `SAM_ESCALATE_CONFIDENCE_BELOW` (0.55) أو فشل تحقق → رفع درجة واحدة.

`SAM_ROUTING_ENABLED=0` يعطّل التوجيه بالصعوبة (سلوك تراثي: سحابة إن وُجد مفتاح وميزانية).

## متغيرات ذات صلة

`HYBRID_MODE`, `FORCE_LOCAL_SPECIALISTS`, `SAM_ROUTING_ENABLED`, `SAM_COST_NEAR_CAP_RATIO`, `SAM_LOCAL_*`, `SAM_FREE_*`, `SAM_PAID_*`, `SAM_ESCALATE_CONFIDENCE_BELOW`, `SAM_PREFER_FREE_FOR_STANDARD`, `OLLAMA_API_KEY`, التخزين المؤقت `SAM_CACHE_*`.
