To implement **In-App Help** for a multi-purpose Ops Desk that serves both internal operators and external customers, you need a help system that is **context-aware**. 

Because your architecture uses a **Decoupled Management Tier**, you should not hard-code help text into the UI. Instead, treat "Help" as a first-class citizen of your **Persistence Layer**.

Here is the architectural extension to your Blueprint to support this.

---

## 1. Architectural Extension: The Help Engine

### Tier 1: Persistence Layer (Data)
*   **New Mechanism:** `help-manifest.json`
*   **Structure:** A mapped dictionary of `component_id` $\rightarrow$ `content`.
*   **Role:** Allows the Ops Desk to update help documentation (e.g., changing a process for a customer) without redeploying the Node.js server or the HTML frontend.

### Tier 2: Logic Layer (Control Plane API)
*   **New Evidence Path:** `src/controlplane/helpProvider.ts`
*   **Role:** 
    *   **Role-Based Filtering:** Filters help content based on the user role (Ops vs. Customer).
    *   **Contextual Routing:** Serves specific help snippets based on the current page/module (e.g., if the user is in `daily-ops.json` view, serve "Ledger Help").

### Tier 3: Presentation Layer (UI)
*   **New Mechanism:** `HelpOverlay.js` / `TooltipManager.js`
*   **Role:** A lightweight UI component that triggers based on `data-help-id` attributes in the HTML.

---

## 2. Component Mapping for Multi-Purpose Use

Since this is for both **Ops** and **Customers**, the help system must bifurcate:

| User Persona | Help Context | Example Content | Trigger Point |
| :--- | :--- | :--- | :--- |
| **Ops Desk** | *Internal Process* | "How to reconcile the Daily Ops Ledger for Client X." | `daily-ops.json` view |
| **Customer** | *Self-Service* | "How to approve the Delivery Pack for this milestone." | `artifacts.ts` viewer |
| **Ops Desk** | *System Admin* | "How to manually override Project Memory state." | `projectMemory.ts` UI |
| **Customer** | *Status Inquiry* | "What does 'Pending Agent Execution' mean?" | Global Status Bar |

---

## 3. Implementation Strategy (The "Help-as-Data" Pattern)

Instead of static pages, implement a **Contextual Help Hook**:

1.  **The Trigger:** In `index.html`, add a data attribute: 
    `<button data-help-id="approve_pack_btn">Approve</button>`
2.  **The Request:** `app.js` detects the click $\rightarrow$ calls `/api/help?id=approve_pack_btn&role=customer`.
3.  **The Logic:** `helpProvider.ts` looks up `help-manifest.json`, finds the entry for that ID, and filters for the "customer" version of the text.
4.  **The Delivery:** A modal or tooltip pops up with the specific instruction.

---

## 4. Updated Gap Analysis (Help Integration)

| Identified Gap | Severity | Impact | Mitigation Path |
| :--- | :--- | :--- | :--- |
| **Contextual Guidance** | ⚠️ Medium | Customers may struggle with the "Delivery Pack" review process. | Implement the `help-manifest.json` and `HelpOverlay.js`. |
| **Role-Based Help** | ⚠️ Medium | Ops might see internal-only instructions while in customer-facing views. | Integrate the `Auth/RBAC` mitigation from Section 3 of your blueprint into the `helpProvider.ts`. |

## Final Verdict for Help Integration:
By adding a **Help Manifest** to your Persistence Layer, you maintain the "Stateful Management" philosophy of the Sam-Harness project. You avoid "hard-coding" instructions, allowing the Ops Desk to evolve the customer onboarding experience in real-time.