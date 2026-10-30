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
| Desktop / daily ops | ✅ Phase 4 UIA operator | توسيع Excel/Word COM + evals ≥20 |
| Email / calendar / results | ✅ إيميل (SMTP/Resend/dry-run) · تقويم لاحقاً | موصلات أوسع + تقويم |
| Control plane UI | ✅ P5 + UI refresh | صقل بصري + أقسام المنصة |
| Multi-client hybrid | ✅ P8 أساسي | بروفايل local/cloud/auto + سقف تكلفة |
| Self-serve install | ✅ Phase 7 one-click (PS1 + sh) + bat | MSI لاحقاً اختياري |

## Phases

| Phase | Name | Outcome | Status |
| --- | --- | --- | --- |
| **P0** | Charter + Org | أدوار، engagement، عقود تشغيل | ✅ |
| **P1** | LangGraph review | حلقة critique→remediate→audit ≤5 + بوابة APPROVED | ✅ |
| **P2** | Evidence gate | مسح مستودع؛ اقتباس مسارات حقيقية | ✅ |
| **P3** | Delivery OS | تذاكر + DoD + Go/No-Go | ✅ |
| **P4** | Safe execution | مصفوفة صلاحيات + safeExecute + مسارات/شل | ✅ |
| **P5** | Control plane | واجهة compose→task.ts→run + سجل حي | ✅ (+ تصميم أنيق) |
| **P6** | Daily Ops Agent | جداول cron ثابتة + مجدول داخل Control Plane + سجل تحت `runs/daily-ops/` | ✅ Phase 2 |
| **P7** | Comms connectors | مسودات + موافقة مالك؛ SMTP (nodemailer) / Resend / dry-run | ✅ Phase 2 |
| **P8** | Hybrid client profiles | بروفايل `local` / `cloud` / `auto` + سقف تكلفة **مفروض** (Phase 1 ledger) | ✅ مفروض |
| **P9** | Evals + memory | eval:task-spec + ذاكرة مشروع في UI | ✅ أساسي / روبريكات أوسع لاحقاً |
| **P10** | Hardened implement | Level-3 عام عبر `level3-plan.json` + git branch/rollback + journal | ✅ Phase 2 |
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
- [x] P6 Daily Ops — persistent cron schedules + in-process scheduler + `/api/daily-ops*` + UI enable/disable/run
- [x] P7 Comms — `comms-drafts.json` + approval gate + SMTP/Resend/dry-run (`emailProvider.ts`)
- [x] P8 Hybrid profile — `hybrid-profile.json` + UI cards + **runtime cost-cap ledger** (`cost-ledger.json`)
- [x] Phase 1 security — Control Plane owner token/session + CSRF; filesystem sandbox via `WORKSPACE_ROOTS`
- [x] Phase 2 gaps — MCP client (`mcp.json`), `run_node_sandbox`, generic Level-3, git snapshots
- [x] P9 Memory — `project-memory.json` + UI (+ existing task-spec evals)
- [x] P10 Rollback journal — file backups + git-snapshot entries from Level-3
- [x] Phase 3 — SQLite (`node:sqlite`) + optional Postgres, LangGraph checkpointer, durable runs, tenant groundwork, pino/OTel/`/healthz`, timeline UI; `EMAIL_PROVIDER=smtp` default (see `docs/PHASE3_PRODUCTION_OPS.md`)
- [x] Phase 4 — Windows desktop operator: UIA-first (`src/tools/desktop/`), verify-after-act, approvals, dry-run, kill switch, timeline screenshots; macOS/Linux stubs; Notepad CI on `windows-latest` (see `docs/PHASE4_DESKTOP_OPERATOR.md`)
- [x] Phase 5 — Near-zero cost: difficulty routing (`src/lib/cost/`), SQLite prompt cache, context compaction, near-cap local degradation tied to $0.50 daily ledger (see `docs/PHASE5_NEAR_ZERO_COST.md`)
- [x] Phase 6 — Verifiable gates & trust: step acceptance gates, HITL approvals, hash-chained `audit_log`, evidence bundles, `/api/trust/*` + `pnpm run trust:*` (see `docs/PHASE6_GATES_TRUST.md`)
- [x] Phase 7 — Arabic-first i18n (RTL UI, locale env, agent/report Arabic) + one-click install (Windows/macOS/Linux) + `pnpm run doctor` (see `docs/PHASE7_ARABIC_INSTALL.md`)

**Test-ready today:** Control Plane + agency packs + `pnpm test` + smokes + `/healthz` + desktop mock + Windows Notepad integration + near-zero cost + gates/trust + Arabic/install/doctor unit tests.  
**Next (Phase 8+):** wider connectors / packaging polish.

## Success metrics (منافسة حقيقية)
- تكلفة توكن لكل تقرير ناجح → أقرب ما يكون للصفر عبر المحلي.
- زمن أول حزمة صالحة / نسبة APPROVED من أول أو ثاني لفة.
- عدد مهام يومية مكتملة بأثر آمن على الجهاز.
- صفر تجاوزات Go/No-Go أو مسار نظام محظور.
