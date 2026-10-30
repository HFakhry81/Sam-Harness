# NEXT_SPRINT.md

## 🎯 Primary Objective
Close the gap between the Project Specification and the Technical Implementation, focusing on the **Booking Engine**, **State Machine transitions**, and **Billing integration**.

---

## 🚨 High Priority (P0) - Critical Gaps
### 📅 Booking Logic Implementation
- [ ] **P0-BOOK-01**: Implement `APPOINTMENT` logic (Staff/Service collision detection).
- [ ] **P0-BOOK-02**: Implement `RESOURCE_RENTAL` logic (Capacity & Exclusive access).
- [ ] **P0-BOOK-03**: Implement `BATCH_SCHEDULE` logic (Group/Bulk check-in).

### ⚡ State Machine & Integration
- [ ] **P0-QR-01**: Develop QR validation logic to trigger `CONFIRMED` $\rightarrow$ `CHECKED_IN`.
- [ ] **P0-BILL-01**: Architect and implement the Billing Engine for `COMPLETED` $\rightarrow$ `INVOICED` transition.

---

## 🛠️ Medium Priority (P1) - Refinement
### 🔄 Lifecycle Enhancements
- [ ] **P1-STATE-01**: Define specific `Booking` state transitions (extending `taskLifecycle.ts`).
- [ ] **P1-STATE-02**: Implement session timer logic for `CHECKED_IN` $\rightarrow$ `COMPLETED`.

### 📜 Compliance & Tracking
- [ ] **P1-AUDIT-01**: Implement the Results Ledger for the Audit Trail.

---

## ✅ Verified (No Action Required)
- Tenant/Workspace Isolation
- RBAC (Admin/Staff/Client)
- UI Control Plane
- Business Logic Orchestration (LangGraph)