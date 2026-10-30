Merge strategy-v1 with ALL rejection fixes into FULL strategy-v2.
Add section "Merged fixes from rejection-v1".
ORIGINAL USER GOAL (must remain the primary subject — do not pivot to BookingType unless goal asks):
راجع حالة أنظمة Control Plane في Sam-Harness مع التركيز على: (1) project-memory / agent-memory، (2) Daily Ops ledger، (3) اكتساب الدروس بعد التشغيل (run lessons)، (4) عارض التقارير على صفحة الانتهاء.
اكتب تقرير حالة قصير داخل مجلد docs فقط (حزمة Sam-Harness جديدة إن لزم). ممنوع تعديل أي كود مصدر. لا تكتب عن BookingType أو الحجز إلا إذا كان ذلك موضوع الطلب.
MUST-FIX:
1. أسباب الرفض / Rejection reason: **Critical Evidence Gap.** The Evidence Pack explicitly states `Target missing: Sam-Harness`. The strategy proposes to "Scan `src/controlplane/*`" and "Review `daily-ops.json`", but these files are not present in the provided evidence. The strategist is planning to audit files that have not been provided to the agent, which will lead to "invented files" or hallucinations of system state.
2. درجة الخطورة / Severity: Critical
3. طريقة الحل / How to fix: The strategist must first request the `Sam-Harness` source code and the specific JSON files mentioned (`project-memory.json`, `daily-ops.json`, `rollback-journal.json`) before proposing an audit strategy based on their contents.
4. The strategist must first request the `Sam-Harness` source code and the specific JSON files mentioned (`project-memory.json`, `daily-ops.json`, `rollback-journal.json`) before proposing an audit strategy based on their contents.
5. أسباب الرفض / Rejection reason: **Assumption of Roadmap State.** The strategy references "P9 implementation", "P6 implementation", and "P10" from an `AGENCY_PLATFORM_ROADMAP.md` that is not included in the Evidence Pack. It is treating a roadmap as current evidence of implementation without verifying the actual code.
6. درجة الخطورة / Severity: High
7. طريقة الحل / How to fix: Remove references to specific "P-levels" as facts of implementation. Instead, frame them as "Goals to be verified against the actual codebase" once the codebase is provided.
8. Remove references to specific "P-levels" as facts of implementation. Instead, frame them as "Goals to be verified against the actual codebase" once the codebase is provided.
9. Request the `Sam-Harness` repository/files immediately.
10. Pivot the strategy from "Audit Focus" (which assumes existence) to "Verification Plan" (which seeks to prove existence).

PRIOR STRATEGY:
Since the original goal explicitly forbids modifying source code and restricts the output to a status report within the `docs` folder, I will not provide the BookingType/Lifecycle/N-tier sections as they are unrelated to the specific request.

Following the **Sam-Harness Agency** protocol, this is the **Strategist's** proposal for the Control Plane status report.

***

# Strategy: Control Plane Status Audit (Sam-Harness)

## 1. Goal Alignment
The objective is to review the current state of the **Control Plane** systems within `Sam-Harness`, specifically focusing on memory, operational ledgers, learning mechanisms, and the final reporting UI. The output must be a concise status report delivered as a documentation pack.

## 2. Analysis Scope (The 4 Pillars)
I will audit the following components based on the `AGENCY_PLATFORM_ROADMAP.md` and existing project specs:

1.  **Memory Systems (`project-memory` / `agent-memory`):**
    *   **Current State:** P9 implementation.
    *   **Audit Focus:** Verification of `project-memory.json` integration, how the UI reflects this memory, and the distinction between long-term project context vs. short-term agent session memory.
2.  **Daily Ops Ledger:**
    *   **Current State:** P6 implementation.
    *   **Audit Focus:** Review of `daily-ops.json` and `/api/daily-ops*` endpoints. Assessment of the "Results Ledger" principle (every task has a state and a reviewable result).
3.  **Run Lessons (Post-Execution Learning):**
    *   **Current State:** P10 (Rollback/Journaling) and P9 (Evals).
    *   **Audit Focus:** How the system captures "lessons learned" after a Level-3 implementation. Review of the `rollback-journal.json` as a source of failure-analysis and improvement.
4.  **Completion Page Report Viewer:**
    *   **Current State:** P5 (Control Plane UI).
    *   **Audit Focus:** Evaluation of the "Finish Page" UI. Does it effectively display the final report pack, the execution path, and the success criteria validation?

## 3. Deliverables (The Pack)
I will create a new pack directory: `docs/Sam-Harness no.X/` containing:

*   **`control-plane-status.md`**: The primary report.
    *   **Executive Summary**: High-level health of the Control Plane.
    *   **Component Breakdown**: Detailed status of the 4 pillars (Memory, Ops, Lessons, UI).
    *   **Gap Analysis**: What is missing to reach "Global Agency" competitiveness (per the Roadmap).
    *   **Verification**: Evidence of which JSON files/API endpoints are currently active.

## 4. Constraints & Boundaries
*   **No Code Edits**: I will not touch `.js`, `.ts`, or `.sql` files.
*   **Read-Only Evidence**: I will only reference existing files in the `Sam-Harness` repository.
*   **Location**: All writes will be confined to the `docs` folder.
*   **Language**: The report will be written in Arabic (as per the original request) or a bilingual format if technical clarity requires it.

## 5. Delivery Phases
1.  **Evidence Gathering**: Scan `src/controlplane/*`, `project-memory.json`, `daily-ops.json`, and `rollback-journal.json`.
2.  **Audit Synthesis**: Map evidence against the P5-P10 roadmap goals.
3.  **Report Generation**: Draft the `control-plane-status.md`.
4.  **Handoff**: Archive the report in the designated `docs/Sam-Harness no.X` folder for Auditor approval.

REJECTION:
# Audit v1/5
Result: [REJECTED]
goalPassed: true
goalFidelityScore: 0.917
goalFidelityReason: Goal fidelity OK (score=0.92, hits=11/35)

[REJECTED]

### Issue 1
- أسباب الرفض / Rejection reason: **Critical Evidence Gap.** The Evidence Pack explicitly states `Target missing: Sam-Harness`. The strategy proposes to "Scan `src/controlplane/*`" and "Review `daily-ops.json`", but these files are not present in the provided evidence. The strategist is planning to audit files that have not been provided to the agent, which will lead to "invented files" or hallucinations of system state.
- درجة الخطورة / Severity: Critical
- طريقة الحل / How to fix: The strategist must first request the `Sam-Harness` source code and the specific JSON files mentioned (`project-memory.json`, `daily-ops.json`, `rollback-journal.json`) before proposing an audit strategy based on their contents.

### Issue 2
- أسباب الرفض / Rejection reason: **Assumption of Roadmap State.** The strategy references "P9 implementation", "P6 implementation", and "P10" from an `AGENCY_PLATFORM_ROADMAP.md` that is not included in the Evidence Pack. It is treating a roadmap as current evidence of implementation without verifying the actual code.
- درجة الخطورة / Severity: High
- طريقة الحل / How to fix: Remove references to specific "P-levels" as facts of implementation. Instead, frame them as "Goals to be verified against the actual codebase" once the codebase is provided.

FIX 1: Request the `Sam-Harness` repository/files immediately.
FIX 2: Pivot the strategy from "Audit Focus" (which assumes existence) to "Verification Plan" (which seeks to prove existence).

EVIDENCE:
# Evidence pack

Target missing: `Sam-Harness`
