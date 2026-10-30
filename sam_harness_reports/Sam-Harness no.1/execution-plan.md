This N-Tier Production Blueprint serves as the technical foundation for the **Sam-Harness Resource Orchestrator (v2)**. It translates the approved strategy into a structural map, citing existing evidence and explicitly marking implementation gaps.

---

# 🏗️ N-Tier Production Blueprint: Sam-Harness v2

## 1. Logical Architecture (The N-Tier Stack)

| Tier | Component | Responsibility | Evidence Path | Status |
| :--- | :--- | :--- | :--- | :--- |
| **UI Tier** | Control Plane | Natural language task composition & live logs | `src/controlplane/public/app.js` | ✅ Existing |
| **API Tier** | Gateway/SSE | Request routing & real-time state streaming | `src/controlplane/taskLifecycle.ts` | ✅ Existing |
| **Business Tier** | **Orchestrator** | LangGraph review loops & state management | `src/agency/reviewGraph.ts` | ✅ Existing |
| | **Task Engine** | Intent validation, risk scoring, success criteria | `src/controlplane/taskSpec.ts` | ✅ Existing |
| | **Billing Engine** | Duration $\rightarrow$ Cost $\rightarrow$ Invoice logic | **GAP** | ❌ Missing |
| **Data Tier** | Evidence Store | State signals, citations, and audit trails | `src/agency/evidence.ts` | ✅ Existing |
| | Memory Layer | Persistent agent context & workspace state | `agent-memory.md` | ✅ Existing |

---

## 2. Domain Model: Booking & Occupancy
The system implements a triad of booking primitives to handle diverse resource needs as defined in `docs/project-spec.md`.

### A. Booking Primitives
1. **`APPOINTMENT`**: Staff-centric. Focus: Calendar collision.
2. **`RESOURCE_RENTAL`**: Asset-centric. Focus: `session_capacity`.
3. **`BATCH_SCHEDULE`**: Group-centric. Focus: Thresholds/Bulk check-in.

### B. Deterministic State Machine
Transitions are gated to prevent "proceed under caution" errors (`review-loop/audit-v1.md`).

**Flow:** `PENDING` $\xrightarrow{Payment/Admin}$ `CONFIRMED` $\xrightarrow{QR Scan}$ `CHECKED_IN` $\xrightarrow{End Time}$ `COMPLETED` $\xrightarrow{Billing}$ `INVOICED`

---

## 3. Operational Pipeline (The Trigger Chain)
This pipeline ensures a linear, non-skippable path from service definition to revenue.

1. **Definition**: Admin sets `BookingType` $\rightarrow$ Catalog.
2. **Reservation**: Client selects slot $\rightarrow$ Occupancy check (`docs/project-spec.md`).
3. **Tokenization**: `CONFIRMED` status $\rightarrow$ Time-bound QR Token generated.
4. **Activation (The Trigger)**: 
   - `QR Scan` $\rightarrow$ `src/agency/delivery/goNoGo.ts` (Validation) $\rightarrow$ Status: `CHECKED_IN`.
5. **Closure**: 
   - `Session End` $\rightarrow$ **[GAP: Billing Engine]** $\rightarrow$ Status: `INVOICED`.

---

## 4. Security & Governance Framework
Implemented via a "Least Privilege" model per `docs/DELIVERY_OS.md`.

### A. Isolation & Access
- **Workspace Boundary**: Enforced via `.cursor/rules/workspace-boundary.mdc` and `src/agency/capabilities.ts`.
- **RBAC**: Defined in `src/agency/roles.ts`. Level-3 tasks require explicit `GO` from `src/agency/delivery/goNoGo.ts`.

### B. Token Lifecycle (Concrete Flow)
- **Issuance**: Auth $\rightarrow$ Access Token (Short) + Refresh Token (Long).
- **Validation**: `goNoGo.ts` checks token scope against required role.
- **Promotion**: `PENDING` $\rightarrow$ `GO` requires `ADMIN` or `SUPERVISOR` claims.
- **Revocation**: Triggered by logout or role change in `src/agency/roles.ts`.

---

## 5. Implementation Roadmap (Gated Delivery)
All execution follows `src/controlplane/taskLifecycle.ts`.

| Phase | Activity | Gate | Output |
| :--- | :--- | :--- | :--- |
| **P1: Intake** | Scout `src/agency/evidence.ts` | Evidence Pack | Signal Map |
| **P2: Strategy** | Strategist $\leftrightarrow$ Auditor Loop | `APPROVED` | Strategy Doc |
| **P3: Blueprint** | Technical Spec Definition | Architect Review | This Blueprint |
| **P4: Execution** | Gated Implementation | `goNoGo.ts` $\rightarrow$ `GO` | Feature Code |
| **P5: Archive** | Final Report Packing | Owner Review | `docs/Sam-Harness no.X` |

---

## 🚩 Gap Analysis Summary
- **Critical Gap**: **Billing Engine**. While the state machine defines the `INVOICED` state, the logic to calculate costs based on `RESOURCE_RENTAL` duration and trigger the invoice is not yet present in the source code.
- **Action**: This must be the primary focus of the first "Gated Implementation" phase following this blueprint.