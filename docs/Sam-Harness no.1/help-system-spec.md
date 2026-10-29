To implement **In-App Help** for a system as complex as the Sam-Harness Resource Orchestrator—which serves both high-level Ops (Admin/Supervisors) and end-customers—you cannot use a static FAQ. 

Because your architecture is **state-driven** (Deterministic State Machine) and **role-based** (RBAC), your help system must be **Context-Aware**.

Here is the proposed design for the In-App Help layer, integrated into your N-Tier Blueprint.

---

### 1. The "Contextual Help" Architecture
Instead of a separate manual, help is treated as a **Metadata Layer** that sits on top of the UI Tier and Business Tier.

| Component | Responsibility | Integration Point |
| :--- | :--- | :--- |
| **Help Registry** | A JSON map linking `State` + `Role` $\rightarrow$ `Guidance` | `src/agency/helpRegistry.ts` (New) |
| **Context Provider** | Detects current `BookingStatus` and `UserRole` | `src/controlplane/app.js` |
| **Guidance UI** | Non-intrusive overlays (Tooltips, Side-panels, "What happens next?") | UI Tier (Control Plane) |

---

### 2. Role-Based Help Logic (The "Who sees what")

Since you have a strict RBAC model (`src/agency/roles.ts`), the help content must pivot based on the user's perspective.

#### A. For the Customer (The "End-User")
*Focus: Friction reduction and clarity of the state machine.*
* **State: `PENDING`** $\rightarrow$ "Your request is being reviewed. You will receive a QR token once confirmed."
* **State: `CONFIRMED`** $\rightarrow$ "Show this QR code at the entrance to check in."
* **State: `CHECKED_IN`** $\rightarrow$ "Your session is active. Need help? Contact the Ops Desk."

#### B. For the Ops Desk (The "Orchestrator")
*Focus: Governance, Risk, and the `goNoGo.ts` logic.*
* **State: `PENDING`** $\rightarrow$ "Review the Evidence Pack. Check for calendar collisions before promoting to `CONFIRMED`."
* **State: `CHECKED_IN`** $\rightarrow$ "Resource is currently occupied. Monitor duration to prevent over-stay."
* **Gap Alert (Billing)** $\rightarrow$ "Note: Billing is currently manual. Ensure duration is logged for invoicing."

---

### 3. Technical Implementation (The "Help-Loop")

To keep this performant and maintainable, implement a **Help-Hook** in your API Tier.

**The Logic Flow:**
1. **Request**: UI requests the current state of a booking.
2. **Enrichment**: The API Gateway calls `helpRegistry.ts`.
3. **Payload**: The API returns the `State` **PLUS** a `help_context` object.

**Example JSON Payload:**
```json
{
  "booking_id": "SH-102",
  "status": "PENDING",
  "user_role": "OPS_DESK",
  "help_context": {
    "title": "Pending Approval",
    "instruction": "Verify the Resource Rental capacity in the Evidence Store.",
    "action_hint": "Click 'GO' to generate the QR Token.",
    "documentation_link": "/docs/governance/approval-process"
  }
}
```

---

### 4. Mapping Help to your Blueprint Gaps

You can use the In-App Help system to "bridge" the current technical gaps (like the Billing Engine) so the users aren't confused by missing features.

| Blueprint Gap | Help Strategy (The "Stop-Gap") |
| :--- | :--- |
| **Billing Engine** | When a session hits `COMPLETED`, trigger a help notification: *"Automatic invoicing is currently in P4 implementation. Please manually trigger the invoice via the Admin Panel."* |
| **Risk Scoring** | In the `Task Engine` UI, add a tooltip explaining *why* a task was flagged as "High Risk" based on `src/controlplane/taskSpec.ts`. |

### 5. Summary of Integration Points
*   **UI Tier**: Add a `HelpPanel` component that listens to the `help_context` payload.
*   **Business Tier**: Create `src/agency/helpRegistry.ts` to house the mapping of `Status