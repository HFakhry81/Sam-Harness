To implement an **In-App Help System** for a multi-purpose Ops Desk (handling both internal staff and external customers), the help architecture must be as deterministic as the Booking Triad. 

Because your system uses a **LangGraph Agency** and a **Deterministic State Machine**, the help system should not be a static FAQ, but a **Context-Aware Guidance Layer** that knows exactly where the user is in the lifecycle.

### 1. Help Architecture: The "Contextual Overlay"
Instead of a separate "Help" page, implement a **Help-as-a-Service (HaaS)** layer that maps to your N-Tier architecture.

| Layer | Help Implementation | Purpose |
| :--- | :--- | :--- |
| **UI (Control Plane)** | **Contextual Tooltips & Guided Tours** | "How do I check in this client?" (UI-level guidance) |
| **API (Orchestration)** | **State-Based Error Messaging** | "Cannot transition to `CHECKED_IN` because QR token is expired." |
| **Business (Agency)** | **Agentic Support (The "Help Agent")** | "I see you're trying to book a `RESOURCE_RENTAL` but the capacity is full. Should I find an alternative?" |
| **Data (Ledger)** | **Audit-Linked Help** | "Why was this marked `CANCELLED`?" $\rightarrow$ Link to audit log. |

---

### 2. Mapping Help to the Booking Triad
The help system must change its vocabulary based on the `BookingType`.

*   **For APPOINTMENT**: Help focuses on **Calendar & Staff**.
    *   *Staff View:* "How to manage no-shows."
    *   *Customer View:* "How to reschedule my session."
*   **For RESOURCE_RENTAL**: Help focuses on **Capacity & Assets**.
    *   *Staff View:* "How to mark a resource as 'Out of Order'."
    *   *Customer View:* "What are the terms of use for this asset?"
*   **For BATCH_SCHEDULE**: Help focuses on **Bulk Actions**.
    *   *Staff View:* "How to perform a bulk check-in for 20+ people."
    *   *Customer View:* "How to join a group session."

---

### 3. Integration with the State Machine
The help system should trigger "Proactive Guidance" based on the `Lifecycle Path`.

**Example: The `PENDING` $\rightarrow$ `CONFIRMED` Transition**
*   **Trigger**: User is stuck in `PENDING` for > 24 hours.
*   **Help Action**: The system surfaces a "Help Tip" to the Ops Desk: *"This booking is pending payment. Click here to send a payment reminder to the customer."*

**Example: The `QR Scan` $\rightarrow$ `CHECKED_IN` Transition**
*   **Trigger**: QR Scan fails 3 times.
*   **Help Action**: Surface a "Manual Override" guide: *"QR failed. To manually check in, verify the Customer ID in the ledger and click 'Force Check-in'."*

---

### 4. Technical Implementation (The "Help-Graph")
Since you are using `src/agency/reviewGraph.ts`, you should implement a **Help-Graph** as a parallel node.

```typescript
// Conceptual addition to src/agency/roles.ts or a new helpGraph.ts
interface HelpContext {
  role: 'ADMIN' | 'STAFF' | 'CLIENT';
  bookingType: 'APPOINTMENT' | 'RESOURCE_RENTAL' | 'BATCH_SCHEDULE';
  currentState: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'INVOICED';
  errorCode?: string;
}

// The Help Agent uses this context to fetch the correct documentation snippet
// from docs/Sam-Harness no.1/help-system-spec.md
```

### 5. Delivery Roadmap for Help System
Add these to your existing phases to ensure the help system isn't an afterthought:

| Phase | Help Integration | Validation |
| :--- | :--- | :--- |
| **Phase 1** | **Static Context Maps**: Map `BookingType` to basic help docs. | `scripts/smoke-delivery.ts` |
| **Phase 2** | **QR Troubleshooting**: In-app guides for failed scans. | `src/agency/evidence.ts` |
| **Phase 3** | **Billing Guidance**: Help for `IN