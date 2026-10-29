# Sam-Harness — Agency Platform Roadmap

## North star (owner charter)

منافسة الوكالات العالمية المعروفة، لكن بـ:

| مبدأ | المعنى العملي |
| --- | --- |
| **≈ 0 تكلفة هامشية** | Ollama محلي افتراضياً؛ سحابة اختيارية عند الحاجة فقط |
| **هجين** | عملاء/وكلاء محليون + سحابيون على نفس الرسم البياني والصلاحيات |
| **تحكم أجهزة** | مهام يومية على PC حقيقي (ملفات، نوافذ، لقطات، أوامر آمنة) |
| **إيميل ونتيجة** | قراءة/صياغة/إرسال ضمن سياسة؛ تتبّع نتيجة كل مهمة |
| **تحليل أنظمة** | Evidence + مراجعة LangGraph + تقارير محكمة |
| **قابلة للتنفيذ** | Delivery OS + DoD + backlog حي |
| **التنفيذ** | Level-3 بعد Go/No-Go صريح فقط |

**شعار المنتج:** وكالة شخصية على جهازك — تحلّل، تخطّط، تنفّذ — بدون قفل سحابي وبدون فاتورة لكل توكن إن اكتفيت بالمحلي.

## Competitive frame (ماذا ننافس)

| قدرة عالمية شائعة | Sam-Harness الآن | الهدف |
| --- | --- | --- |
| Orchestration graphs (LangGraph-class) | ✅ P1 | تعزيز ذاكرة التشغيل + استئناف |
| Specialist crews | ✅ أدوار | عقود أوضح + تقييم جودة |
| Evidence / citations | ✅ P2 أساسي | Evals + رفض آلي للهلوسة |
| Delivery / tickets | ✅ P3 | لوحة حية + إشعارات |
| Safe tool use | ✅ P4 جزئي | سياسات أدق + موافقات متعددة المستويات |
| Desktop / daily ops | ⚠️ L1 محدود | مشغّل يومي قوي ضمن allowlist |
| Email / calendar / results | ❌ | موصلات + سجل نتائج |
| Control plane UI | ✅ P5 + UI refresh | صقل بصري + أقسام المنصة |
| Multi-client hybrid | ✅ P8 أساسي | بروفايل local/cloud/auto + سقف تكلفة |
| Self-serve install | ⚠️ bat + pnpm | حزمة محمولة أوضح |

## Phases

| Phase | Name | Outcome | Status |
| --- | --- | --- | --- |
| **P0** | Charter + Org | أدوار، engagement، عقود تشغيل | ✅ |
| **P1** | LangGraph review | حلقة critique→remediate→audit ≤5 + بوابة APPROVED | ✅ |
| **P2** | Evidence gate | مسح مستودع؛ اقتباس مسارات حقيقية | ✅ |
| **P3** | Delivery OS | تذاكر + DoD + Go/No-Go | ✅ |
| **P4** | Safe execution | مصفوفة صلاحيات + safeExecute + مسارات/شل | ✅ |
| **P5** | Control plane | واجهة compose→task.ts→run + سجل حي | ✅ (+ تصميم أنيق) |
| **P6** | Daily Ops Agent | جداول مهام يومية + سجل نتائج في UI/API | ✅ أساسي |
| **P7** | Comms connectors | مسودات إيميل/إشعار + بوابة موافقة (stub إرسال) | ✅ أساسي |
| **P8** | Hybrid client profiles | بروفايل `local` / `cloud` / `auto` + سقف تكلفة | ✅ أساسي |
| **P9** | Evals + memory | eval:task-spec + ذاكرة مشروع في UI | ✅ أساسي / روبريكات أوسع لاحقاً |
| **P10** | Hardened implement | rollback journal بعد Level-3 (مسار تدقيق) | ✅ أساسي / snapshots لاحقاً |
| **P0b** | Production hardening | عزل حزم الذات، evals انحدار، حقن ذاكرة، منع تلوث الهدف | ✅ أساسي — `pnpm run smoke:prod-gates` |

## Design principles
1. **Graph orchestration** (LangGraph): حالة دائمة، حواف شرطية، لا “proceed under caution”.
2. **Specialist roles** بعقود مخرجات — ليس mega-prompt واحد.
3. **Evidence before approval**.
4. **Hybrid cost:** محلي للراوتر والمهام الرخيصة؛ سحابة للمراجعة الثقيلة عند وجود مفتاح.
5. **Portable PC runtime:** Node + Ollama؛ بدون قفل بائع.
6. **Least privilege + human GO** قبل أي أثر دائم على كود العميل أو الإرسال الخارجي.
7. **Results ledger:** كل مهمة لها حالة ونتيجة قابلة للمراجعة لاحقاً.

## Current implementation detail
- [x] P0–P4 as shipped in `src/agency/*`, `docs/AGENCY_OPS.md`, `SamHarness.bat`
- [x] P5 Control plane v1 — `src/controlplane/*` + `pnpm run ui`
  - Compose natural-language task → structured `task.ts` / `task.md`
  - Run options: agency / implement(+GO) / smoke / legacy
  - Live log via SSE; launcher default mode = UI
- [x] Task Spec Engine — `taskSpec.ts` source of truth (`task.spec.json`)
  - Intent/entities/risk/success_criteria + confidence gate + clarify UI
  - Executor prefers Spec plan; verifier checks success_criteria
  - Golden evals: `pnpm run eval:task-spec` (target ≥95%)
- [x] P6 Daily Ops — `daily-ops.json` + `/api/daily-ops*` + UI tab
- [x] P7 Comms stubs — `comms-drafts.json` + approval-gated send stub
- [x] P8 Hybrid profile — `hybrid-profile.json` + UI cards
- [x] P9 Memory — `project-memory.json` + UI (+ existing task-spec evals)
- [x] P10 Rollback journal — `rollback-journal.json` wired from Level-3

**Test-ready today:** Control Plane (مهمة / يومي / هجين / ذاكرة / rollback) + agency packs.  
**Next hardening:** scheduler tick for due jobs, real SMTP/notify, binary rollback snapshots, broader review evals.

## Success metrics (منافسة حقيقية)
- تكلفة توكن لكل تقرير ناجح → أقرب ما يكون للصفر عبر المحلي.
- زمن أول حزمة صالحة / نسبة APPROVED من أول أو ثاني لفة.
- عدد مهام يومية مكتملة بأثر آمن على الجهاز.
- صفر تجاوزات Go/No-Go أو مسار نظام محظور.
