Based on the provided Evidence Pack and the approved strategy, here is the N-tier production blueprint for the Control Plane components.

# Control Plane Production Blueprint: Sam-Harness
**Date:** 2026-10-29
**Status:** Gap Analysis / Blueprint Phase
**Target:** `E:\UpNexa.com\Sam-Harness`
**Output Location:** `docs/Sam-Harness no.1/audit-report.md`

---

## 1. Architectural Blueprint (N-Tier)

Since the components are currently **not found in the evidence**, the following blueprint defines the required production structure to move these from "Unknown" to "Implemented."

### Tier 1: Data Persistence (Storage Layer)
*   **Project-Memory:** A structured JSON or NoSQL store mapping `ProjectID` $\rightarrow$ `Context/State/Decisions`.
*   **Daily Ops Ledger:** An append-only immutable log (ledger) recording every system action, tool execution, and result.
*   **Report Store:** A document store for finalized audit reports and execution plans.

### Tier 2: Logic & Orchestration (Control Plane Layer)
*   **Memory Manager:** Service to inject/retrieve project context into LangGraph nodes.
*   **Ledger Service:** Middleware that intercepts tool outputs and writes them to the Daily Ops Ledger.
*   **Report Generator:** Logic to aggregate ledger entries into a human-readable format for the Completion Page.

### Tier 3: Presentation (UI Layer)
*   **Completion Page Viewer:** A read-only dashboard that fetches the latest report from the Report Store and displays the "Execution Result" to the user.

---

## 2. Evidence & Gap Analysis

| Component | Status | Evidence Path | Gap / Requirement |
| :--- | :--- | :--- | :--- |
| **Project-Memory** | ⚪ **GAP** | Not found in `docs/` | No evidence of a state-persistence mechanism for project context. |
| **Daily Ops Ledger** | ⚪ **GAP** | Not found in `docs/` | No evidence of an immutable action log or operational ledger. |
| **Report Viewer** | ⚪ **GAP** | Not found in `docs/` | No evidence of a UI component on the completion page for report visualization. |

---

## 3. Implementation Roadmap (Proposed)

To resolve these gaps, the following sequence is proposed for the next sprint:

1.  **Define Schema:** Create `docs/control-plane-spec.md` defining the JSON structure for Memory and Ledger.
2.  **Implement Ledger:** Create a utility to log all `LangGraph` transitions to a local file (Daily Ops Ledger).
3.  **Integrate Memory:** Implement a "Context Loader" that reads previous project-memory before starting a new task.
4.  **Build Viewer:** Develop the frontend route for the Completion Page to render the `audit-report.md` content.

**Conclusion:** The Control Plane systems (Project-Memory, Daily Ops Ledger, and Report Viewer) are currently **absent** from the provided evidence. This blueprint serves as the technical requirement for their implementation.