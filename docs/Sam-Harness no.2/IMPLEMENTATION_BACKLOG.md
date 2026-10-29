# IMPLEMENTATION_BACKLOG.md

## 🔴 Priority 0 (Critical Path)
*Immediate implementation required to enable core business functionality.*

### 📅 Booking Engine Core
- [ ] **P0-BOOK-01: Appointment Collision Logic**
    - **Requirement:** Implement `BookingType: APPOINTMENT`.
    - **Task:** Create TypeScript interfaces and validation logic to prevent staff/service double-booking.
    - **Target:** `src/bookings/` (New directory)

- [ ] **P0-BOOK-02: Resource Rental Logic**
    - **Requirement:** Implement `BookingType: RESOURCE_RENTAL`.
    - **Task:** Implement capacity management and exclusive-use locking logic for physical resources.
    - **Target:** `src/bookings/`

- [ ] **P0-BOOK-03: Batch Scheduling Logic**
    - **Requirement:** Implement `BookingType: BATCH_SCHEDULE`.
    - **Task:** Create logic for group bookings and bulk check-in capabilities.
    - **Target:** `src/bookings/`

### ⚡ State Transitions & Triggers
- [ ] **P0-QR-01: QR Validation Trigger**
    - **Requirement:** Transition `CONFIRMED` $\rightarrow$ `CHECKED_IN`.
    - **Task:** Implement QR code validation logic to trigger the state change in the booking lifecycle.
    - **Target:** `src/controlplane/qrHandler.ts` (New)

### 💰 Financials
- [ ] **P0-BILL-01: Billing Engine & Invoicing**
    - **Requirement:** Transition `COMPLETED` $\rightarrow$ `INVOICED`.
    - **Task:** Implement the billing engine and the state transition logic for invoice generation.
    - **Target:** `src/billing/` (New directory)

---

## 🟡 Priority 1 (Functional Enhancement)
*Required for operational maturity and auditability.*

### 🔄 Lifecycle Refinement
- [ ] **P1-STATE-01: Booking State Machine (Pending $\rightarrow$ Confirmed)**
    - **Requirement:** Specific Booking state transitions.
    - **Task:** Extend `src/controlplane/taskLifecycle.ts` to include explicit Booking-specific state transitions.
    - **Target:** `src/controlplane/taskLifecycle.ts`

- [ ] **P1-STATE-02: Session Timer Logic (Checked-In $\rightarrow$ Completed)**
    - **Requirement:** Automated completion based on session duration.
    - **Task:** Implement session timer logic to trigger the `COMPLETED` state.
    - **Target:** `src/controlplane/taskLifecycle.ts`

### 📜 Governance
- [ ] **P1-AUDIT-01: Results Ledger Implementation**
    - **Requirement:** Audit Trail for all booking/task changes.
    - **Task:** Implement the ledger system to record history as defined in `docs/Sam-Harness no.1/audit-history.md`.
    - **Target:** `src/audit/ledger.ts` (New)