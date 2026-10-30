# IMPLEMENTATION_BACKLOG.md

## 🔴 P0: Critical Path (Blockers)
*Immediate implementation required. These represent missing core engines and security-critical features.*

| Ticket | Requirement | Gap Description | Priority |
| :--- | :--- | :--- | :--- |
| **TICKET-BILL-01** | **Billing Engine** | Complete absence of logic to convert Duration $\rightarrow$ Cost $\rightarrow$ Invoice. No code evidence found. | Critical |
| **TICKET-QR-01** | **QR Token Generation** | No logic exists to generate time-bound tokens for `CONFIRMED` status bookings. | Critical |

---

## 🟡 P1: High Priority (Core Logic)
*Required for system viability. These bridge the gap between the Project Spec and the actual codebase.*

| Ticket | Requirement | Gap Description | Priority |
| :--- | :--- | :--- | :--- |
| **TICKET-BOOK-01** | **Booking Primitives** | `APPOINTMENT`, `RESOURCE_RENTAL`, and `BATCH_SCHEDULE` are defined in spec but missing in `src/`. | High |
| **TICKET-STATE-01** | **Booking State Machine** | State transition logic (`PENDING` $\rightarrow$ `INVOICED`) is missing from the implementation layer. | High |
| **TICKET-OCC-01** | **Occupancy Validation** | Capacity and collision check logic defined in spec is not implemented in `src/`. | High |
| **TICKET-QR-02** | **QR Validation Trigger** | While `goNoGo.ts` exists, the specific mapping of `QR Scan` $\rightarrow$ `CHECKED_IN` status is missing. | Medium |

---

## 🟢 Completed / Low Risk
*Verified as implemented or handled by existing architectural rules.*

- [x] **Workspace Isolation** (Verified via `.cursor/rules/workspace-boundary.mdc`)
- [x] **RBAC / Role Definitions** (Verified via `src/agency/roles.ts`)
- [x] **Task Lifecycle Management** (Verified via `src/controlplane/taskLifecycle.ts`)
- [x] **Evidence/Audit Trail** (Verified via `src/agency/evidence.ts`)
- [x] **Agent Memory/Context** (Verified via `agent-memory.md`)