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