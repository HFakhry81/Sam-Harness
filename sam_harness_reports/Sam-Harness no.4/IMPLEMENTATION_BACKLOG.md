# IMPLEMENTATION_BACKLOG.md

## 🔴 Priority 0: Critical Infrastructure & Core Logic
*High severity gaps. These are fundamental business rules and security constraints currently existing only in documentation.*

| Ticket | Requirement | Gap Description | Target Path |
| :--- | :--- | :--- | :--- |
| **T-001** | **Tenant/Workspace Isolation** | Logic exists in docs but not implemented in source. Critical for multi-tenancy security. | `src/controlplane/auth/isolation.ts` |
| **T-002** | **Booking/Occupancy Logic** | Core business logic for resource allocation/booking is missing from implementation. | `src/controlplane/bookingEngine.ts` |
| **T-003** | **QR/Check-in System** | Entry/Exit validation and QR generation logic not implemented. | `src/controlplane/checkin.ts` |

---

## 🟡 Priority 1: Security & Access Control
*Medium severity gaps. Necessary for production readiness and user management.*

| Ticket | Requirement | Gap Description | Target Path |
| :--- | :--- | :--- | :--- |
| **T-004** | **Auth/RBAC** | Role-Based Access Control logic defined in docs but missing from the control plane source. | `src/controlplane/auth/rbac.ts` |

---

## 🟢 Priority 2: Maintenance & Optimization
*Low severity. Features are implemented; requires monitoring and iterative refinement.*

| Ticket | Requirement | Status | Evidence Path |
| :--- | :--- | :--- | :--- |
| **T-005** | Project Memory | ✅ Implemented | `src/controlplane/projectMemory.ts` |
| **T-006** | Daily Ops Ledger | ✅ Implemented | `src/controlplane/dailyOps.ts` |
| **T-007** | Report Viewer | ✅ Implemented | `src/controlplane/artifacts.ts` |
| **T-008** | Control Plane Server | ✅ Implemented | `src/controlplane/server.ts` |
| **T-009** | Control Plane UI | ✅ Implemented | `src/controlplane/public/index.html` |
| **T-010** | UI Logic/Routing | ✅ Implemented | `src/controlplane/public/app.js` |
| **T-011** | Task Specification | ✅ Implemented | `src/controlplane/taskSpec.ts` |
| **T-012** | Lesson Execution | ✅ Implemented | `src/controlplane/runLessons.ts` |