# محلي مقابل سحابة مقابل هجين

المصدر: `src/lib/cost/router.ts`, `difficulty.ts`, `hybridProfile.ts`, `models.ts`, `teamConfig.ts`, `.env.example`.

## قرار الوضع

| الوضع | السلوك |
| --- | --- |
| `local` | لا مدفوع أبداً — يتجاهل مفتاح السحابة |
| `auto` (افتراضي) | رخيص/قياسي → محلي؛ مميز → مدفوع إن وُجد مفتاح وميزانية، وإلا مجاني→محلي |
| `cloud` | يفضّل المدفوع لغير الرخيص عند التوفر؛ قرب/استنفاد السقف → مجاني/محلي؛ قد يرمي `CostCapExceededError` عند استنفاد السقف |

الأسبقية: `FORCE_LOCAL_SPECIALISTS=1` → `HYBRID_MODE` → ملف الهجين في قاعدة البيانات → `auto`.

### خريطة الأدوار في الهجين (المرحلة 8 — حيّة)

`hybrid-profile.roles` (مثل `strategist: "local"`) تُقرأ فعلياً في `resolveModelRoute` عبر `effectiveHybridModeForRole`، مع:

- موجّه الصعوبة (المرحلة 5)
- `prefersCloud` من إعداد الفريق / العقود
- **سقف التكلفة اليومي يفوز دائماً**

لوحة التحكم: تبويب **الهجين** و**الفريق**، و`GET /api/routing/effective`. Doctor يعرض ملخص التوجيه.

## السقف اليومي ٠٫٥٠ دولار

- الثابت: `DEFAULT_COST_CAP_USD = 0.5`
- لكل مستأجر؛ `$0` يمنع كل استدعاءات السحابة
- فقط الرسوم ذات `cloud: true` تُحسب
- لا تجاوز للسقف (`assertWithinCostCap` / `canAffordPaid`)

## سلوك قرب السقف

- عندما `remaining / cap ≤ SAM_COST_NEAR_CAP_RATIO` (افتراضي `0.15`): لا مدفوع؛ مجاني إن وُجد وإلا محلي
- موافقة إنفاق: شحنة ≥ `SAM_TRUST_SPEND_APPROVAL_USD` (٠٫٢٥) تحتاج `APPROVE_SPEND=1` مع بقاء السقف سارياً

## توجيه الصعوبة

| الدرجة | تقريباً | أمثلة |
| --- | --- | --- |
| cheap | ≤0.28 | ceo_router, operator, evidence |
| standard | وسط | help / marketer |
| premium | ≥0.7 | auditor, architect, strategist, coder |

`prefersCloud` قد يرفع القياسي → مميز عندما لا يكون وضع الدور `local` والميزانية تسمح.

`SAM_ROUTING_ENABLED=0` يعطّل توجيه الصعوبة (تراثي)، لكن **السقف وخريطة local لكل دور يبقيان**.

## متغيرات ذات صلة

`HYBRID_MODE`, `FORCE_LOCAL_SPECIALISTS`, `SAM_ROUTING_ENABLED`, `SAM_COST_NEAR_CAP_RATIO`, `SAM_LOCAL_*`, `SAM_FREE_*`, `SAM_PAID_*`, `SAM_ROLE_*_MODEL`, `OLLAMA_API_KEY`, …
