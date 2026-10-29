Merge strategy-v1 with ALL rejection fixes into FULL strategy-v2.
Add section "Merged fixes from rejection-v1".
ORIGINAL USER GOAL (must remain the primary subject — do not pivot to BookingType unless goal asks):
عاوزك تكتب لي تقرير حن نفسك فيه اسمك وحدود امكانيات وتقدر تعمل ايه وتعرضة عليا
PROJECT MEMORY / LESSONS:
## Project memory
- lesson:no-task-overwrite-while-running: Do not replace task.ts/md while a run is active — causes wrong-goal contamination in LangGraph loops.
- lesson:target-repo-absolute: targetRepo label Sam-Harness must resolve to this workspace absolute path — never nest packs under ./Sam-Harness/docs.
- lesson:excel-inventory-write: Excel inventory on a drive: after run_shell/list_dir always write_file the .txt report — scan alone is not success.
- lesson:run-shell-powershell: run_shell PowerShell must exec powershell.exe directly — never cmd /c (pipes like Select-Object break).
- lesson:goal-fidelity: Reject strategies that drift from ## Goal (e.g. BookingType when goal is memory/Daily Ops/UI).
- last-run:architecture: OK · L3 — تقرير Control Plane + ذاكرة/تعلم · # Agency Result - engine: LangGraph - auditPassed: true - goalPassed: true - goalFidelityScore: 0.917 - gate: OPEN - loops: 3 --- [VERIFIED]
- last-run:operational: OK · تقرير جرد Excel على D: · - [OK] run_shell: Shell command finished - [OK] write_file: Created file C:\Users\Sam\Desktop\excel-report-D.txt (442 chars) --- { "success": true, "summary": "

## Recent run lessons
- [2026-10-29T20:07:04.563Z] route=operational mode=agency success=false goal=false title="تقرير جرد Excel على D:" lesson=retry: - [FAIL] run_shell: Command failed: cmd /c powershell -NoProfile -Command Get-ChildItem D:\ -Recurse -Include *.xls,*.xlsx,*.xlsm -File -ErrorAction SilentlyContinue | Select-Object -First 80 FullName 'Select-Object' is
- [2026-10-29T20:11:27.716Z] route=operational mode=agency success=false goal=false title="تقرير جرد Excel على D:" lesson=retry: - [OK] run_shell: Shell command finished --- { "success": true, "summary": "Excel report generated successfully.", "steps": 3, "tools": [ { "ok": true, "tool": "run_shell", "message": "Shell command finished", "data": {
- [2026-10-29T20:15:38.724Z] route=operational mode=agency success=true goal=true title="تقرير جرد Excel على D:" lesson=ok: - [OK] run_shel
...(truncated)
MUST-FIX:
1. أسباب الرفض / Rejection reason: **Invented Evidence / Hallucinated Paths.** The strategy cites several files and paths that do NOT exist in the provided Evidence Pack. Specifically: `docs/WORKFLOW_REVIEW_LOOP.md`, `docs/AGENCY_PLATFORM_ROADMAP.md`, `src/controlplane/`, and `src/controlplane/projectMemory.ts`. The Auditor is strictly forbidden from inventing files not in the evidence.
2. درجة الخطورة / Severity: Critical
3. طريقة الحل / How to fix: Remove all references to files and directories not listed in the Evidence Pack. Use only the provided paths (e.g., `docs/LOCAL_ISOLATION.md` for Control Plane/Memory signals).
4. Remove all references to files and directories not listed in the Evidence Pack. Use only the provided paths (e.g., `docs/LOCAL_ISOLATION.md` for Control Plane/Memory signals).
5. أسباب الرفض / Rejection reason: **Topic Drift / Goal Fidelity.** The user asked for a report introducing the agent, its capabilities, and limits. The strategy shifted into a "Product Roadmap/Gap Analysis" format (Current state vs gaps table) and "Technical Recommendations" which were not requested. It treated the request as a system audit rather than a personal introduction report.
6. درجة الخطورة / Severity: High
7. طريقة الحل / How to fix: Refocus the response on the ORIGINAL USER GOAL: A report introducing the agent, its name, its limits, and what it can do. Remove the "Current state vs gaps" and "Concrete recommendations" sections unless they directly serve the introduction.
8. Refocus the response on the ORIGINAL USER GOAL: A report introducing the agent, its name, its limits, and what it can do. Remove the "Current state vs gaps" and "Concrete recommendations" sections unless they directly serve the introduction.
9. أسباب الرفض / Rejection reason: **Lack of Evidence Grounding for Capabilities.** The strategy claims capabilities (e.g., "Hybrid Mode via Ollama", "LangGraph architecture") without citing the specific evidence paths from the pack that prove these features are implemented in the current environment.
10. درجة الخطورة / Severity: Medium
11. طريقة الحل / How to fix: When mentioning capabilities (like Control Plane or Memory), cite the corresponding evidence path from the pack (e.g., `docs/LOCAL_ISOLATION.md`).
12. When mentioning capabilities (like Control Plane or Memory), cite the corresponding evidence path from the pack (e.g., `docs/LOCAL_ISOLATION.md`).
13. Strip all hallucinated paths (`src/...`, `WORKFLOW_REVIEW_LOOP.md`, etc.).
14. Revert the structure to a direct report/introduction as requested by the user.
PRIOR STRATEGY:
## Direct answer to ORIGINAL USER GOAL

أهلاً بك. أنا **Sam-Harness**، وكالتك الشخصية الذكية (Personal Agency) التي تعمل مباشرة على جهازك. أنا لست مجرد "شات بوت"، بل أنا نظام تشغيل للوكلاء (Agentic OS) مصمم لتحليل، تخطيط، وتنفيذ المهام التقنية والإدارية بدقة هندسية.

إليك التقرير التفصيلي عن هويتي، قدراتي، وحدود عملي:

### 1. من أنا؟ (الهوية والمنطق)
أنا نظام مبني على هندسة **LangGraph**، مما يعني أنني لا أجيب بشكل عشوائي، بل أعمل وفق "رسم بياني" (Graph) من الأدوار المتخصصة. عندما تطلب مني مهمة، أقوم بتشغيل دورة حياة كاملة:
**Strategist (مخطط) $\rightarrow$ Auditor (مدقق) $\rightarrow$ Architect/Executor (منفذ).**
هذا يضمن أن أي مخرج أقدمه لك قد تمت مراجعته ونقده داخلياً قبل أن يصل إليك.

### 2. ماذا يمكنني أن أفعل؟ (القدرات التشغيلية)
أمتلك قدرات تتجاوز توليد النصوص، حيث يمكنني التفاعل مع بيئتك المحلية:

*   **تحليل الأنظمة والملفات (Evidence-Based):** يمكنني مسح المجلدات، قراءة ملفات الكود والوثائق، واستخراج أدلة حقيقية (Citations) من مسارات ملفاتك بدلاً من التخمين.
*   **إدارة المهام اليومية (Daily Ops):** أستطيع إدارة جداول مهام يومية، تتبع النتائج، وتحديث حالة العمل في لوحة تحكم (Control Plane).
*   **التخطيط الهندسي (Architecture):** تحويل طلباتك من لغة طبيعية إلى مواصفات تقنية دقيقة (`task.spec.json`) تشمل معايير النجاح (Success Criteria) ومستوى الخطورة.
*   **التنفيذ الآمن (Safe Execution):** يمكنني كتابة الملفات، تشغيل أوامر PowerShell/Shell، وإدارة الذاكرة الخاصة بالمشروع، ولكن **فقط** بعد الحصول على موافقة صريحة منك (GO).
*   **العمل الهجين (Hybrid Mode):** أستطيع التنقل بين النماذج المحلية (عبر Ollama) لتقليل التكلفة والخصوصية، والنماذج السحابية للمهام المعقدة.
*   **ذاكرة المشروع (Project Memory):** أحتفظ بالدروس المستفادة من المهام السابقة لضمان عدم تكرار الأخطاء.

### 3. حدود إمكانياتي (القيود والضوابط)
لضمان أمان جهازك وجودة العمل، ألتزم بالحدود التالية:
*   **بوابة الموافقة (Human-in-the-loop):** لا أقوم بتعديل كود أساسي أو إرسال إيميلات أو تنفيذ أوامر خطيرة دون "إذن تنفيذ" صريح.
*   **رفض الهلوسة:** إذا لم أجد دليلاً في ملفاتك (Evidence)، سأخبرك بأن المعلومة "غير موجودة" بدلاً من اختراع إجابة.
*   **دورة المراجعة:** إذا رفض "المدقق" (Auditor) خطتي، يجب عليّ إعادة صياغتها حتى يتم قبولها؛ لا يمكنني "تجاوز" التدقيق.
*   **نطاق الوصول:** أعمل ضمن المجلدات والمصرحات التي تحددها لي في بيئة التشغيل.

---

## Current state vs gaps

| الميزة | الحالة الحالية (Current State) | الفجوة (Gap) | الدليل (Evidence Path) |
| :--- | :--- | :--- | :--- |
| **التخطيط والتدقيق** | مفعل بالكامل (L2 Review Loop) | تحسين سرعة الوصول لـ APPROVED | `docs/WORKFLOW_REVIEW_LOOP.md` |
| **الوصول للملفات** | مسح وقراءة دقيقة (Evidence Gate) | أتمتة أعمق لربط الأدلة بالكود | `docs/AGENCY_PLATFORM_ROADMAP.md` |
| **الواجهة (UI)** | لوحة تحكم (Control Plane) موجودة | صقل بصري وتجربة مستخدم أسلس | `src/controlplane/` |
| **التنفيذ المحلي** | تشغيل أوامر Shell/PowerShell | توسيع قائمة الأدوات المسموحة (Allowlist) | `docs/AGENCY_PLATFORM_ROADMAP.md` |
| **الذاكرة** | تخزين دروس مستفادة (P9 Memory) | ربط الذاكرة بشكل استباقي بكل مهمة | `src/controlplane/projectMemory.ts` |

---

## Concrete recommendations / next actions

لكي تستفيد مني بأقصى درجة، أقترح الآتي:
1.  **تحديد مهمة معقدة:** ابدأ بإعطائي مهمة تتطلب تحليل عدة ملفات (مثلاً: "راجع ثغرات الأمان في مجلد X واقترح حلولاً").
2.  **استخدام Control Plane:** قم بتشغيل `pnpm run ui` لإدارة مهامك ومراقبة سجل التنفيذ بدلاً من الشات التقليدي.
3.  **تفعيل الذاكرة:** اطلب مني تسجيل "درس مستفاد" بعد كل مهمة ناجحة لضمان تطوري في مشروعك.
4.  **اختبار الـ Hybrid Mode:** جرب توزيع المهام بين المحلي (للسرعة) والسحابي (للجودة العالية).

---

## Risks & verification

*   **الخطر:** تنفيذ أمر Shell خاطئ قد يؤثر على الملفات.
    *   **التحقق:** أستخدم `safeExecute` ومصفوفة صلاحيات، ولا يتم التنفيذ إلا بعد ظهور حالة `[APPROVED]` في التقرير.
*   **الخطر:** هلوسة في تحليل الكود.
    *   **التحقق:** إجبار الوكيل على ذكر المسار الكامل للملف `(Path/to/file.ts)` كدليل على كل معلومة.

---

## Delivery / handoff notes

*   **طريقة الاستخدام:** أنا متاح الآن عبر واجهة التحكم أو من خلال ملفات `task.ts`.
*   **المخرجات:** كل مهمة أقوم بها تنتهي بإنشاء "حزمة" (Pack) في مجلد `docs/Sam-Harness no.X` تحتوي على (الاستراتيجية $\rightarrow$ التدقيق $\rightarrow$ خطة التنفيذ).
*   **الحالة:** جاهز للعمل (Ready for Operation).
REJECTION:
# Audit v1/5
Result: [REJECTED]
goalPassed: false
goalFidelityScore: 0.200
goalFidelityReason: Goal fidelity FAIL (score=0.20; hits=وحدود|تعمل)

[REJECTED]

### Issue 1
- أسباب الرفض / Rejection reason: **Invented Evidence / Hallucinated Paths.** The strategy cites several files and paths that do NOT exist in the provided Evidence Pack. Specifically: `docs/WORKFLOW_REVIEW_LOOP.md`, `docs/AGENCY_PLATFORM_ROADMAP.md`, `src/controlplane/`, and `src/controlplane/projectMemory.ts`. The Auditor is strictly forbidden from inventing files not in the evidence.
- درجة الخطورة / Severity: Critical
- طريقة الحل / How to fix: Remove all references to files and directories not listed in the Evidence Pack. Use only the provided paths (e.g., `docs/LOCAL_ISOLATION.md` for Control Plane/Memory signals).

### Issue 2
- أسباب الرفض / Rejection reason: **Topic Drift / Goal Fidelity.** The user asked for a report introducing the agent, its capabilities, and limits. The strategy shifted into a "Product Roadmap/Gap Analysis" format (Current state vs gaps table) and "Technical Recommendations" which were not requested. It treated the request as a system audit rather than a personal introduction report.
- درجة الخطورة / Severity: High
- طريقة الحل / How to fix: Refocus the response on the ORIGINAL USER GOAL: A report introducing the agent, its name, its limits, and what it can do. Remove the "Current state vs gaps" and "Concrete recommendations" sections unless they directly serve the introduction.

### Issue 3
- أسباب الرفض / Rejection reason: **Lack of Evidence Grounding for Capabilities.** The strategy claims capabilities (e.g., "Hybrid Mode via Ollama", "LangGraph architecture") without citing the specific evidence paths from the pack that prove these features are implemented in the current environment.
- درجة الخطورة / Severity: Medium
- طريقة الحل / How to fix: When mentioning capabilities (like Control Plane or Memory), cite the corresponding evidence path from the pack (e.g., `docs/LOCAL_ISOLATION.md`).

FIX 1: Strip all hallucinated paths (`src/...`, `WORKFLOW_REVIEW_LOOP.md`, etc.).
FIX 2: Revert the structure to a direct report/introduction as requested by the user.
FIX 3: Map all claimed capabilities to the provided Evidence Pack paths.
EVIDENCE:
# Evidence pack (local scout)

Target: `E:\UpNexa.com\maw3ed`
Scanned: 2026-10-29T22:25:50.097Z
Hits: 80

Auditor MUST cite these paths (or mark "not found") — do not invent frameworks.

- `docs/admin-dashboard.md` — tenant/workspace isolation signals (content)
- `docs/ARCHITECTURE_AND_SECURITY_BASELINE.md` — tenant/workspace isolation signals (content)
- `docs/BOOKING_PORTAL_HOSTING_DOMAIN.md` — tenant/workspace isolation signals (content)
- `docs/DEPARTMENT_DESK.md` — tenant/workspace isolation signals (content)
- `docs/DEVELOPMENT_LOG.md` — schema/migration artifact (content)
- `docs/GO_NO_GO_CHECKLIST.md` — QR/check-in signals (content)
- `docs/IMPLEMENTATION_EXECUTION_LOG.md` — booking/occupancy signals (content)
- `docs/IMPLEMENTATION_ROADMAP.md` — booking/occupancy signals (content)
- `docs/INCOMPLETE_LOGIC.md` — QR/check-in signals (content)
- `docs/LOCAL_ISOLATION.md` — Control Plane / memory / ops signals (content)
- `docs/MEDICAL_DEMO_SEED.md` — tenant/workspace isolation signals (content)
- `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md` — booking/occupancy signals (content)
- `docs/OPS_BACKUP_RESTORE_RUNBOOK.md` — tenant/workspace isolation signals (content)
- `docs/PHASE_0_API_INVENTORY_AND_DECISIONS.md` — tenant/workspace isolation signals (content)
- `docs/PLATFORM_GOVERNANCE.md` — booking/occupancy signals (content)
- `docs/PRE_LAUNCH_ACCEPTANCE_CHECKLIST.md` — QR/check-in signals (content)
- `docs/PRIVACY_REQUESTS_RUNBOOK.md` — tenant/workspace isolation signals (content)
- `docs/PRODUCTION_COMPLETION_PLAN.md` — booking/occupancy signals (content)
- `docs/PRODUCTION_READINESS_REPORT.md` — tenant/workspace isolation signals (content)
- `docs/PRODUCT_AND_PLATFORM_SPEC.md` — booking/occupancy signals (content)
- `docs/PROJECT_DOCUMENTATION_INDEX.md` — booking/occupancy signals (content)
- `docs/public-booking-page.md` — tenant/workspace isolation signals (content)
- `docs/REFERENCE_PLATFORM_BENCHMARK.md` — tenant/workspace isolation signals (content)
- `docs/refresh-and-test.md` — booking/occupancy signals (content)
- `docs/sam-harness/audit-history.md` — booking/occupancy signals (content)
- `docs/sam-harness/audit-report.md` — booking/occupancy signals (content)
- `docs/sam-harness/CODE_VS_PLAN_GAP_MATRIX.md` — tenant/workspace isolation signals (content)
- `docs/sam-harness/EXECUTION_JOURNAL.md` — booking/occupancy signals (content)
- `docs/sam-harness/IMPLEMENTATION_BACKLOG.md` — tenant/workspace isolation signals (content)
- `docs/sam-harness/marketing-campaign.md` — QR/check-in signals (content)
- `docs/sam-harness/NEXT_SPRINT.md` — tenant/workspace isolation signals (content)
- `docs/sam-harness/PACK_HANDOFF.md` — RBAC/auth signals (content)
- `docs/sam-harness/TICKET_P0_STARTER.md` — tenant/workspace isolation signals (content)
- `docs/Sam-Harness no.1/audit-attempt-1.md` — booking/occupancy signals (content)
- `docs/Sam-Harness no.1/audit-attempt-2.md` — booking/occupancy signals (content)
- `docs/Sam-Harness no.1/audit-at
...(truncated)