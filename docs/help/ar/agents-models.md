# الوكلاء والنماذج لكل دور

المصدر: `config/team.json`, `src/agency/teamConfig.ts`, `src/agent/models.ts`, `src/lib/cost/config.ts`, `.env.example`.

## إعداد نموذج لكل دور (المرحلة 8)

لكل دور نماذج قابلة للضبط: **محلي** و**سحابة/مدفوع** و**مجاني** اختياري:

1. الافتراضيات في `config/team.json` (مُتحقَّق عبر `config/team.schema.json`)
2. تجاوزات البيئة:
   - `SAM_ROLE_<ROLE>_MODEL` → محلي
   - `SAM_ROLE_<ROLE>_CLOUD_MODEL` → سحابة
   - `SAM_ROLE_<ROLE>_FREE_MODEL` → مجاني
3. تجاوزات مواقع الاستدعاء اختيارية؛ المصانع تفضّل إعداد الفريق

`<ROLE>` هو معرّف الدور بأحرف كبيرة (`strategist` → `SAM_ROLE_STRATEGIST_MODEL`).

## الجدول الافتراضي (يحافظ على سلوك ما قبل المرحلة 8)

| الدور / الوكيل | سحابة (افتراضي) | محلي (افتراضي) | المصنع |
| --- | --- | --- | --- |
| CEO Router | `gemma4:cloud` | `CEO_MODEL` أو `qwen2.5-coder:1.5b` | `makeCeoModel` |
| Strategist | `gemma4:cloud` | `CEO_MODEL` أو `qwen2.5-coder:1.5b` | `makeSpecialistModel` `role:"strategist"` |
| Auditor | `gemma4:cloud` | `gemma3:1b` | `role:"auditor"` |
| Architect | `gemma4:cloud` | `qwen2.5:1.5b` | `role:"architect"` |
| Help (حزمة التقارير) | `gemma4:cloud` | `qwen2.5:1.5b` | `role:"help"` |
| Marketer | `gemma4:cloud` | `qwen2.5:1.5b` | `role:"marketer"` |
| L3 Coder | `gemma4:cloud` | `qwen2.5-coder:1.5b` | `role:"coder"` |
| Verifier | مسار CEO | محلي رخيص | `makeCeoModel` |
| Intake / Evidence | بلا LLM | — | ملفات / `scanRepoEvidence` |

عدّل النماذج من لوحة التحكم → **الفريق**، أو `config/team.json`، أو متغيرات البيئة.

## افتراضيات المزود العالمية

| متغير | افتراضي |
| --- | --- |
| `CEO_MODEL` | `qwen2.5-coder:1.5b` |
| `SAM_LOCAL_BASE_URL` | `http://localhost:11434` |
| `SAM_LOCAL_MODEL` | فارغ → `CEO_MODEL` ثم الافتراضي أعلاه |
| `SAM_PAID_BASE_URL` | `https://ollama.com` |
| `SAM_PAID_MODEL` | `gemma4:cloud` |
| `SAM_FREE_*` | فارغ حتى يُضبط |
| `OLLAMA_API_KEY` | مطلوب للسحابة المدفوعة |

## صعوبة الدور (للتوجيه)

من `difficulty.ts` (+ تلميح `prefersCloud` في المرحلة 8):

- **رخيص:** `ceo_router`, `ceo`, `operator`, `evidence`, `router`
- **أرضية مميزة:** `auditor`, `architect`, `strategist`, `coder`, `reviewer`
- **قياسي:** `help`, `marketer`, `verifier`, … ما لم ترفع التعقيد / prefersCloud الدرجة

التوجيه الحي لكل دور: `GET /api/routing/effective` أو `pnpm run doctor`.
