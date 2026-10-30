# الوكلاء والنماذج لكل دور

المصدر: `src/agent/models.ts`, مواقع الاستدعاء في `runner.ts` / `reviewGraph.ts` / `level2Swarm.ts` / `level3Implement.ts` / `ceoLoop.ts` / `index.ts`, و`src/lib/cost/config.ts`, و`.env.example`.

## لا توجد متغيرات بيئة لكل دور

**غير منفّذ:** لا يوجد `HELP_MODEL` أو `AUDITOR_MODEL`. الربط ثابت في مواقع الاستدعاء؛ السحابة مقابل المحلي يقرره `resolveModelRoute` + السقف + وضع الهجين.

## الجدول الفعلي (أسماء من الكود)

| الدور / الوكيل | نموذج السحابة (ثابت) | نموذج محلي (ثابت / بيئة) | المصنع |
| --- | --- | --- | --- |
| CEO Router (`index.ts`) | — محلي فقط | `CEO_MODEL` أو `qwen2.5-coder:1.5b` | `ChatOllama` مباشرة |
| CEO Loop L1 | — محلي فقط | `CEO_MODEL` أو `qwen2.5-coder:1.5b` | `ChatOllama` على `localhost:11434` |
| `makeCeoModel` (مُتحقق / رخيص) | عبر التوجيه؛ `forceCheap` | `CEO_MODEL` أو `SAM_LOCAL_MODEL` أو الافتراضي أعلاه | `makeCeoModel` |
| Strategist | `gemma4:cloud` | `CEO_MODEL` أو `qwen2.5-coder:1.5b` | `makeSpecialistModel` |
| Auditor | `gemma4:cloud` | `gemma3:1b` | `makeSpecialistModel` |
| Architect | `gemma4:cloud` | `qwen2.5:1.5b` | `makeSpecialistModel` |
| Help (حزمة التقارير) | `gemma4:cloud` | `qwen2.5:1.5b` | `makeSpecialistModel` `role:"help"` |
| Marketer | `gemma4:cloud` | `qwen2.5:1.5b` | `makeSpecialistModel` |
| L3 Coder | `gemma4:cloud` | `qwen2.5-coder:1.5b` | `makeSpecialistModel` `role:"coder"` |
| L3 Reviewer | مسار CEO | محلي رخيص | `makeCeoModel` |
| Intake / Evidence | بلا LLM | — | ملفات / `scanRepoEvidence` |

## افتراضيات المزود العالمية

| متغير | افتراضي |
| --- | --- |
| `CEO_MODEL` | `qwen2.5-coder:1.5b` |
| `SAM_LOCAL_BASE_URL` | `http://localhost:11434` |
| `SAM_LOCAL_MODEL` | فارغ → سلسلة `CEO_MODEL` ثم `qwen2.5-coder:1.5b` |
| `SAM_PAID_BASE_URL` | `https://ollama.com` |
| `SAM_PAID_MODEL` | `gemma4:cloud` |
| `SAM_FREE_*` | فارغ (الطبقة المجانية غير مستخدمة حتى تُضبط) |
| `OLLAMA_API_KEY` | مطلوب للسحابة المدفوعة |

مفاتيح أخرى في المثال: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY` — موجودة في `.env.example`؛ مسار المتخصصين الحي عبر Ollama (`ChatOllama`) والتوجيه في `models.ts`.

## صعوبة الدور (للتوجيه)

من `difficulty.ts`:

- **رخيص:** `ceo_router`, `ceo`, `operator`, `evidence`, `router`
- **ممتاز (أرضية):** `auditor`, `architect`, `strategist`, `coder`, `reviewer`
- **قياسي:** `help`, `marketer`, `verifier`, … ما لم ترفع تعقيد المطالبة الدرجة
