# Production Strategy: Sam-Harness Resource Orchestrator

**Role:** Agency Strategist  
**Status:** Production Blueprint  
**Alignment:** `docs/project-spec.md`, `docs/DELIVERY_OS.md`, `src/agency/roles.ts`

---

## BookingType Triad
As mandated by `docs/project-spec.md`, the system implements three distinct booking primitives to handle occupancy and scheduling:

1. **APPOINTMENT**: Time-slotted bookings for specific staff/services. Logic focuses on staff availability and calendar collision detection.
2. **RESOURCE_RENTAL**: Duration-based occupancy of a physical or virtual asset (e.g., room rental). Logic focuses on `session_capacity` and exclusive vs. shared access.
3. **BATCH_SCHEDULE**: Group-based or recurring event scheduling. Logic focuses on maximum capacity thresholds and bulk check-in processing.

---

## Status Machines + Transitions
To eliminate "proceed under caution" ambiguity and align with `docs/project-spec.md`, the system utilizes a deterministic state machine.

**Booking Lifecycle State Machine:**
`PENDING` $\rightarrow$ `CONFIRMED` $\rightarrow$ `CHECKED_IN` $\rightarrow$ `COMPLETED` $\rightarrow$ `INVOICED`

**Transition Triggers:**
- **PENDING $\rightarrow$ CONFIRMED**: Triggered by payment confirmation or admin approval.
- **CONFIRMED $\rightarrow$ CHECKED_IN**: Triggered by QR code validation (see Lifecycle section).
- **CHECKED_IN $\rightarrow$ COMPLETED**: Triggered by session timer expiry or manual staff checkout.
- **COMPLETED $\rightarrow$ INVOICED**: Triggered by the Billing Engine upon session closure.

---

## Lifecycle: service $\rightarrow$ book $\rightarrow$ QR $\rightarrow$ session $\rightarrow$ invoice
The operational flow is a linear pipeline ensuring no step is skipped:

1. **Service Definition**: Admin defines the `BookingType` and assigns staff/resources (referenced in `docs/project-spec.md`).
2. **Booking**: Client selects a slot; system creates a `PENDING` record.
3. **QR Issuance**: Upon `CONFIRMED` status, the system generates a unique, time-bound QR token (signals found in `docs/Sam-Harness no.1/help-system-spec.md` and `docs/Sam-Harness no.1/marketing-campaign.md`).
4. **Session/Attendance**: QR scan at the venue triggers the `CHECKED_IN` state, initiating the active session timer.
5. **Invoice**: Once the session is marked `COMPLETED`, the system aggregates duration/resource costs and generates the final invoice.

---

## N-tier Architecture
The system is structured to separate concerns and ensure the "no client code edit without GO" boundary:

- **UI Tier**: Control Plane interface (`src/controlplane/public/app.js`) for task composition and live logs.
- **API Tier**: REST/SSE endpoints for state transitions and QR validation.
- **Business Tier**: LangGraph orchestration logic (`src/agency/reviewGraph.ts`) and the `taskSpec.ts` engine for validating success criteria.
- **Data Tier**: Tenant-isolated storage for bookings, resource occupancy, and the results ledger.

---

## Security
Security is implemented via a "Least Privilege" model as defined in `docs/DELIVERY_OS.md` and `src/agency/roles.ts`.

- **Tenant Isolation**: Strict workspace boundaries enforced via `.cursor/rules/workspace-boundary.mdc` and `src/controlplane/taskLifecycle.ts` to prevent cross-tenant data leakage.
- **RBAC**: Role-based access control (Admin, Staff, Client) managed via `src/agency/roles.ts`.
- **Token Lifecycle**: 
    - **Issuance**: Short-lived JWTs for API access; single-use signed tokens for QR check-ins.
    - **Validation**: Middleware checks token signature and `BookingType` permissions.
    - **Revocation**: Immediate invalidation upon `COMPLETED` or `CANCELLED` status.
- **Audit**: Every state transition is logged in the results ledger, aligning with the audit signals in `docs/Sam-Harness no.1/audit-history.md`.

---

## Delivery Phases
Delivery follows the `docs/DELIVERY_OS.md` and `src/controlplane/taskLifecycle.ts` framework. **No phases are claimed as shipped; all are targets for implementation.**

- **Phase 1: Core Engine**: Implementation of the BookingType triad and the state machine transitions.
- **Phase 2: QR & Check-in**: Integration of the QR generation and validation logic (referencing `docs/Sam-Harness no.1/help-system-spec.md`).
- **Phase 3: Billing Integration**: Wiring the `COMPLETED` $\rightarrow$ `INVOICED` trigger to the billing engine.
- **Phase 4: Tenant Hardening**: Final audit of workspace isolation using `src/agency/delivery/goNoGo.ts` for production readiness.
- **Handoff**: Final delivery pack archived under `docs/Sam-Harness no.X` containing the audit report and execution plan.