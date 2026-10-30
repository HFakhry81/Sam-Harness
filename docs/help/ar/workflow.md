# خطة سير العمل والأدوار

المصدر: `src/agency/roles.ts`, `src/agency/runner.ts`, `src/agency/reviewGraph.ts`, `src/agent/level2Swarm.ts`, `src/agent/level3Implement.ts`, `src/agent/ceoLoop.ts`, `index.ts`.

## الأدوار (عقد الوكالة)

من `AGENCY_ROLES` — أحد عشر دوراً:

| المعرّف | العنوان | مخرجات معلنة |
| --- | --- | --- |
| `ceo_router` | CEO Router | تصنيف المسار وقرار البوابة |
| `intake` | Intake Analyst | `engagement.json` |
| `evidence` | Evidence Scout | `evidence-pack.md` |
| `strategist` | Strategist | `strategy-vN.md` |
| `auditor` | Security & Logic Auditor | `audit-vN.md`, `rejection-vN.md` |
| `architect` | Solution Architect | `execution-plan.md`, فجوة الكود/الخطة |
| `help` | Help Systems | `help-system-spec.md` داخل حزمة التقارير |
| `marketer` | GTM Marketer | `marketing-campaign.md` |
| `verifier` | CEO Verifier | `final-report.md` |
| `implementer` | Implementer | `EXECUTION_JOURNAL.md` (بعد GO فقط) |
| `operator` | Desktop Operator | نتائج أدوات سطح المكتب (مسار تشغيلي L1) |

> **المرحلة 8:** `prefersCloud` وخريطة `roles` في ملف الهجين تُستشار في التوجيه الحي (سقف التكلفة يفوز دائماً). نماذج الأدوار وترتيب خطوات ما بعد الموافقة من `config/team.json`. مصفوفة الأدوات في `ROLE_CAPABILITIES` / `OPERATOR_CAPABILITIES`.

دور `help` في الوكالة يكتب مواصفة مساعدة داخل الحزمة بعد موافقة المدقق — هذا **غير** نفس نظام المساعدة داخل المنتج (`docs/help` + CLI/API/UI) الذي تقرأه الآن.

## خريطة المسارات من CLI

```mermaid
flowchart TD
  TASK[task.ts / CLI / واجهة] --> RTR{CEO Router<br/>operational مقابل architecture}
  RTR -->|operational| L1[CEO Loop + Heuristic<br/>دور operator]
  L1 --> VER[verifyAgainstTask]
  RTR -->|architecture| AMODE{AGENCY_MODE}
  AMODE -->|1 افتراضي| AG[runAgencyArchitecture]
  AMODE -->|0| L2[runArchitectureSwarm تراثي]
  AG --> IN[Intake]
  IN --> EV[Evidence Scout]
  EV --> RG[LangGraph Review ≤5]
  RG -->|مرفوض بعد 5| FAIL[FAILED_AUDIT_GATE]
  RG -->|APPROVED + goalPassed| DOWN[Architect → Help → Marketer → Verifier]
  DOWN --> DEL[لوحة التسليم + go-nogo PENDING]
  DEL --> PACK[أرشفة Sam-Harness no.N]
  PACK --> L3Q{shouldRunLevel3 + GO؟}
  L3Q -->|نعم| L3[runImplementationCrew]
  L3Q -->|لا| STOP[حزمة تقارير فقط]
```

- المسار الافتراضي للتحليل: `AGENCY_MODE=1` (LangGraph).
- `--implement-only` يتخطى L1/L2 ويذهب لـ Level-3 بعد تفويض GO.
- قيم المسار `intake` / `review_only` موجودة في الأنواع فقط — **CLI لا يختارها مباشرة** (**مخطط / غير منفّذ كمسارات CLI**).

## حلقة المراجعة (LangGraph)

`MAX_LOOPS = 5` في `reviewGraph.ts`.

```mermaid
flowchart TD
  START([START]) --> strategize
  strategize --> audit
  audit -->|approved| END1([END])
  audit -->|failed و loop ≥ 5| END2([END])
  audit -->|remediate و loop < 5| strategize
```

- بعد موافقة نموذج المدقق تُطبَّق بوابة صلبة `scoreGoalFidelity` — يمكن قلب الموافقة إلى رفض إن فشلت مطابقة الهدف.
- يُنشأ checkpointer للتشغيلات القابلة للاستئناف.

## السرب Level-2 (تراثي)

عند `AGENCY_MODE=0`: حلقة خطية Strategist↔Auditor حتى 5 مرات، ثم Architect/Help/Marketer إن وُوفق.  
**بدون** بوابة goal-fidelity و**بدون** لوحة تسليم من هذا المسار. بعض المطالبات ما زالت مرتبطة بسياق Maw3ed/حجز (**ميراث**).

```mermaid
flowchart TD
  A[Strategist] --> B[Auditor]
  B -->|APPROVED| C[Architect → Help → Marketer → Verifier]
  C --> G[فجوة + backlog + أرشفة]
  B -->|REJECT و N < 5| A
  B -->|REJECT و N = 5| I[فشل البوابة]
```

## Level-3 تنفيذ

يتطلب تفويضاً: `--go` أو `IMPLEMENT_GO=1` أو `go-nogo.json` بقرار `GO`.  
الخطة من `level3-plan.json` (أو أسماء بديلة). يرفض الكتابة إن القرار ≠ GO.

```mermaid
flowchart TD
  P[تحميل الخطة] --> G{مستودع Git؟}
  G -->|نعم| B[فرع + لقطة تراجع]
  G -->|لا| W
  B --> W{هل توجد كتابات؟}
  W -->|نعم| A[تطبيق writes/patches]
  W -->|لا| L[اقتراح كتابة واحدة من نموذج المبرمج أو finish]
  L --> A
  A --> T[اختبارات]
  T -->|فشل + git| R[rollback]
  T -->|نجاح/تخطي| V[مراجع MATCH/NOT_MATCH]
  V --> J[مجلة التنفيذ]
```

## مسار تشغيلي L1 (سطح المكتب)

`runOperationalCeoLoop` حتى ٨ خطوات: Task Spec أو heuristic → أدوات عبر `executeToolAsRole("operator", …)` أو حلقة LLM محلية.

```mermaid
flowchart TD
  T[مهمة] --> F[focusTask]
  F --> S{Task Spec؟}
  S -->|نعم/لا| C{خطة عالية الثقة؟}
  C -->|نعم| D[تنفيذ أدوات operator]
  C -->|لا| L[حلقة LLM ≤8]
  L --> V[verifyAgainstTask]
  D --> V
```
