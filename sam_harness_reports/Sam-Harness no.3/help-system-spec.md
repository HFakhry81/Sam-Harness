To implement **In-App Help** for a multi-purpose Ops Desk that serves both internal operators and external customers, you cannot use a static FAQ. You need a **Context-Aware Help Layer** that integrates directly into the "Sam-Harness" Control Plane.

Since your architecture relies on a **Daily Ops Ledger** and **Project-Memory**, your help system should not just be a manual—it should be a **Diagnostic Assistant**.

Here is the architectural extension to your blueprint to support this:

---

## 1. Architectural Extension: The "Help-Plane"

To avoid cluttering the Logic Layer, introduce a **Help-Plane** that sits between the Presentation Tier and the Logic Tier.

### Tier 1: Data Persistence (Help Knowledge Base)
*   **Contextual Wiki (Vector Store):** Instead of a JSON file, use a lightweight vector store (e.g., ChromaDB or a structured Markdown library) containing:
    *   *Ops-Desk Guides:* Technical SOPs for internal staff.
    *   *Customer Guides:* Simplified, outcome-oriented help for clients.
    *   *Tool-Tips:* Mapping of specific `LangGraph` node IDs to "What is happening now" explanations.

### Tier 2: Logic & Orchestration (Help Engine)
*   **Persona Switcher:** A middleware that detects the user role (`Operator` vs. `Customer`) and filters the help content accordingly.
*   **State-Aware Resolver:** A service that queries the **Project-Memory** to see where the user is in the workflow. 
    *   *Example:* If the user clicks "Help" while the Ledger shows a "Failed Validation" state, the help engine prioritizes "How to fix validation errors" over "General Overview."
*   **Feedback Loop:** A mechanism to log "Help Requests" back into the **Daily Ops Ledger** so developers can see where users are getting stuck.

### Tier 3: Presentation (UI Layer)
*   **Contextual Overlay:** A slide-out panel (not a new page) that renders Markdown from the Help Engine.
*   **"Explain This Step" Button:** A UI element tied to the **Completion Page Viewer** that translates the technical `audit-report.md` into plain language for the customer.

---

## 2. Updated Gap Analysis (Help Integration)

| Component | Status | Requirement | Integration Point |
| :--- | :--- | :--- | :--- |
| **Persona-Based Filtering** | ⚪ **GAP** | Logic to distinguish Ops vs. Customer help content. | Tier 2 (Logic Layer) |
| **State-Linked Help** | ⚪ **GAP** | Ability to map `Project-Memory` state $\rightarrow$ Help Article. | Tier 1 $\rightarrow$ Tier 2 |
| **Help-to-Ledger Log** | ⚪ **GAP** | Recording when/where help was accessed for UX auditing. | Tier 2 $\rightarrow$ Daily Ops Ledger |

---

## 3. Implementation Roadmap (Help-Specific)

To integrate this into your existing sprint, add these steps:

1.  **Schema Expansion:** Add a `help_context` field to the `control-plane-spec.md`. This maps specific system states to help documentation IDs.
2.  **Knowledge Base Setup:** Create `docs/help/ops/` and `docs/help/customer/` directories.
3.  **The "Translator" Node:** Implement a LangGraph node that can take a technical entry from the **Daily Ops Ledger** and summarize it into a "Customer-Friendly" status update.
4.  **UI Trigger:** Add a global `Help` trigger in the Presentation Layer that sends the current `ProjectID` and `UserRole` to the Help Engine.

### Summary of the User Experience:
*   **The Operator** clicks help $\rightarrow$ Sees: *"The Ledger shows a timeout at Node X. Check the API credentials in Project-Memory."*
*   **The Customer** clicks help $\rightarrow$ Sees: *"We are currently verifying your documents. This usually takes 5 minutes."*