Merge strategy-v2 with ALL rejection fixes into FULL strategy-v3.
Add section "Merged fixes from rejection-v2".
ORIGINAL USER GOAL (must remain the primary subject — do not pivot to BookingType unless goal asks):
راجع حالة أنظمة Control Plane في Sam-Harness مع التركيز على: (1) project-memory / agent-memory، (2) Daily Ops ledger، (3) اكتساب الدروس بعد التشغيل (run lessons)، (4) عارض التقارير على صفحة الانتهاء.
اكتب تقرير حالة قصير داخل مجلد docs فقط (حزمة Sam-Harness جديدة إن لزم). ممنوع تعديل أي كود مصدر. لا تكتب عن BookingType أو الحجز إلا إذا كان ذلك موضوع الطلب.
MUST-FIX:
1. أسباب الرفض / Rejection reason: **Failure to acknowledge the "Target missing" state in the execution path.** The Evidence Pack explicitly states `Target missing: Sam-Harness`. The strategy proposes a "Verification Plan" and "Execution Phases" that assume the agent can simply "request" the repository or "scan" it, but it does not provide a concrete path for how to handle the current total absence of evidence. An auditor cannot approve a strategy that plans to "verify" things that are explicitly marked as missing in the current context without a mechanism to acquire them first.
2. درجة الخطورة / Severity: Critical
3. طريقة الحل / How to fix: The strategy must explicitly state that since the target `Sam-Harness` is missing from the evidence pack, the immediate and only possible action is to halt and request the specific codebase. It should not outline "Verification Goals" as if the files are imminent; it must treat the current state as "Zero Evidence."
4. The strategy must explicitly state that since the target `Sam-Harness` is missing from the evidence pack, the immediate and only possible action is to halt and request the specific codebase. It should not outline "Verification Goals" as if the files are imminent; it must treat the current state as "Zero Evidence."
5. أسباب الرفض / Rejection reason: **Presumptive File Naming.** The strategy lists specific filenames like `project-memory.json`, `daily-ops.json`, and `rollback-journal.json` as the primary targets for verification. These files are not present in the evidence pack. By naming them as the "Verification Goal," the strategy is bordering on "inventing files" or relying on external assumptions not grounded in the provided evidence.
6. درجة الخطورة / Severity: High
7. طريقة الحل / How to fix: Change the verification goals from "Search for [Specific Filename]" to "Search for implementation of [Functional Requirement]." For example, instead of searching for `daily-ops.json`, search for "any ledger-based logging system for daily operations."
8. Change the verification goals from "Search for [Specific Filename]" to "Search for implementation of [Functional Requirement]." For example, instead of searching for `daily-ops.json`, search for "any ledger-based logging system for daily operations."
9. أسباب الرفض / Rejection reason: **Goal Fidelity - Output Location.** The user requested the report "inside the docs folder only (new Sam-Harness pack if needed)." The strategy proposes `docs/Sam-Harness no.X/`. While close, it introduces a numbering convention (`no.X`) not requested and fails to confirm if it will create a *new* pack or use an existing one based on the actual directory structure (which is currently unknown because the target is missing).
10. درجة الخطورة / Severity: Low
11. طريقة الحل / How to fix: Simplify the deliverable path to `docs/sam-harness-control-plane-status/` or similar, ensuring it adheres strictly to the "docs folder" constraint without adding arbitrary versioning.
12. Simplify the deliverable path to `docs/sam-harness-control-plane-status/` or similar, ensuring it adheres strictly to the "docs folder" constraint without adding arbitrary versioning.
13. Explicitly state that no analysis can occur until the `Sam-Harness` target is provided.
14. Remove specific `.json` filenames from the "Verification Goals" and replace them with functional descriptions.

PRIOR STRATEGY:
# Strategy: Control Plane Status Verification (Sam-Harness) - v2

## 1. Goal Alignment
The objective is to review the current state of the **Control Plane** systems within `Sam-Harness`, specifically focusing on: (1) project-memory/agent-memory, (2) Daily Ops ledger, (3) run lessons, and (4) the report viewer on the completion page. The output must be a concise status report delivered exclusively within the `docs` folder.

## 2. Merged Fixes from rejection-v1
To address the critical failures of v1, the following corrections have been integrated:
*   **Elimination of Hallucinated Evidence:** Removed all assumptions that `src/controlplane/*`, `project-memory.json`, `daily-ops.json`, or `rollback-journal.json` are currently available.
*   **Roadmap Decoupling:** Removed references to "P-levels" (P5, P6, P9, P10) as established facts. These are now treated as **hypothetical goals** to be verified against actual code, not as evidence of implementation.
*   **Pivot to Verification:** The strategy has shifted from an "Audit" (which assumes existence) to a "Verification Plan" (which seeks to prove existence).
*   **Immediate Resource Request:** The primary first step is now the formal request for the missing `Sam-Harness` source code and configuration files.

## 3. Verification Plan (The 4 Pillars)
Once the codebase is provided, I will verify the following:

1.  **Memory Systems (`project-memory` / `agent-memory`):**
    *   **Verification Goal:** Locate and analyze the implementation of `project-memory.json`. Determine if there is a functional distinction between long-term project context and short-term session memory.
2.  **Daily Ops Ledger:**
    *   **Verification Goal:** Search for `daily-ops.json` and associated `/api/daily-ops*` endpoints. Verify if the "Results Ledger" principle is active (i.e., every task has a recorded state and result).
3.  **Run Lessons (Post-Execution Learning):**
    *   **Verification Goal:** Identify mechanisms for capturing "lessons learned." Search for `rollback-journal.json` or similar failure-analysis logs used for system improvement.
4.  **Completion Page Report Viewer:**
    *   **Verification Goal:** Inspect the UI code for the "Finish Page." Verify if it renders the final report pack, execution path, and success criteria validation.

## 4. Deliverables (The Pack)
I will create a new pack directory: `docs/Sam-Harness no.X/` containing:

*   **`control-plane-status.md`**: The primary report (written in Arabic as requested).
    *   **Executive Summary**: High-level health of the Control Plane.
    *   **Verification Results**: Detailed findings for the 4 pillars (Confirmed / Partial / Missing).
    *   **Gap Analysis**: Discrepancies between the intended roadmap and the actual codebase.
    *   **Evidence Log**: List of specific files and lines of code that prove the existence of these features.

## 5. Constraints & Boundaries
*   **No Code Edits**: Strictly forbidden to modify `.js`, `.ts`, or `.sql` files.
*   **Read-Only Evidence**: Only reference files provided in the `Sam-Harness` repository.
*   **Location**: All writes are confined to the `docs` folder.
*   **Subject Focus**: No mention of `BookingType` or booking logic.

## 6. Execution Phases
1.  **Resource Acquisition (CRITICAL)**: Request the `Sam-Harness` repository and the specific files: `project-memory.json`, `daily-ops.json`, and `rollback-journal.json`.
2.  **Existence Verification**: Scan the provided source code to confirm which of the 4 pillars are actually implemented.
3.  **Synthesis**: Compare the actual implementation against the desired Control Plane specifications.
4.  **Report Generation**: Draft the `control-plane-status.md` in the `docs` folder.
5.  **Handoff**: Archive for Auditor approval.

REJECTION:
# Audit v2/5
Result: [REJECTED]
goalPassed: true
goalFidelityScore: 0.917
goalFidelityReason: Goal fidelity OK (score=0.92, hits=11/35)

[REJECTED]

### Issue 1
- أسباب الرفض / Rejection reason: **Failure to acknowledge the "Target missing" state in the execution path.** The Evidence Pack explicitly states `Target missing: Sam-Harness`. The strategy proposes a "Verification Plan" and "Execution Phases" that assume the agent can simply "request" the repository or "scan" it, but it does not provide a concrete path for how to handle the current total absence of evidence. An auditor cannot approve a strategy that plans to "verify" things that are explicitly marked as missing in the current context without a mechanism to acquire them first.
- درجة الخطورة / Severity: Critical
- طريقة الحل / How to fix: The strategy must explicitly state that since the target `Sam-Harness` is missing from the evidence pack, the immediate and only possible action is to halt and request the specific codebase. It should not outline "Verification Goals" as if the files are imminent; it must treat the current state as "Zero Evidence."

### Issue 2
- أسباب الرفض / Rejection reason: **Presumptive File Naming.** The strategy lists specific filenames like `project-memory.json`, `daily-ops.json`, and `rollback-journal.json` as the primary targets for verification. These files are not present in the evidence pack. By naming them as the "Verification Goal," the strategy is bordering on "inventing files" or relying on external assumptions not grounded in the provided evidence.
- درجة الخطورة / Severity: High
- طريقة الحل / How to fix: Change the verification goals from "Search for [Specific Filename]" to "Search for implementation of [Functional Requirement]." For example, instead of searching for `daily-ops.json`, search for "any ledger-based logging system for daily operations."

### Issue 3
- أسباب الرفض / Rejection reason: **Goal Fidelity - Output Location.** The user requested the report "inside the docs folder only (new Sam-Harness pack if needed)." The strategy proposes `docs/Sam-Harness no.X/`. While close, it introduces a numbering convention (`no.X`) not requested and fails to confirm if it will create a *new* pack or use an existing one based on the actual directory structure (which is currently unknown because the target is missing).
- درجة الخطورة / Severity: Low
- طريقة الحل / How to fix: Simplify the deliverable path to `docs/sam-harness-control-plane-status/` or similar, ensuring it adheres strictly to the "docs folder" constraint without adding arbitrary versioning.

FIX 1: Explicitly state that no analysis can occur until the `Sam-Harness` target is provided.
FIX 2: Remove specific `.json` filenames from the "Verification Goals" and replace them with functional descriptions.
FIX 3: Align the output path strictly to the `docs` folder without invented numbering.

EVIDENCE:
# Evidence pack

Target missing: `Sam-Harness`
