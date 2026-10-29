# Production Strategy: Sam-Harness Resource Orchestrator

**Role:** Agency Strategist  
**Status:** Production Blueprint  
**Alignment:** `docs/project-spec.md`, `docs/AGENCY_PLATFORM_ROADMAP.md`

---

## BookingType Triad
To handle diverse occupancy and scheduling needs, the system implements three distinct booking primitives as defined in `docs/project-spec.md`:

1.  **APPOINTMENT**: Time-slotted bookings for specific staff/services (e.g., 1:1 consultation). Logic focuses on staff availability and calendar collisions.
2.  **RESOURCE_RENTAL**: Duration-based occupancy of a physical or virtual asset (e.g., room rental). Logic focuses on `session_capacity` and exclusive vs. shared access.
3.  **BATCH_SCHEDULE**: Group-based or recurring event scheduling. Logic focuses on maximum capacity thresholds and bulk check-ins.

---

## Status Machines + Transitions
The system follows a strict state-transition model to prevent "proceed under caution" errors, aligning with `review-loop/audit-v1.md` and `docs/project-spec.md`.

**Booking State Machine:**
`PENDING` $\rightarrow$ `CONFIRMED` $\rightarrow$ `CHECKED_IN` $\rightarrow$ `COMPLETED` $\rightarrow$ `INVOICED`

**Transitions:**
- **PENDING $\rightarrow$ CONFIRMED**: Triggered by payment verification or admin approval.
- **CONFIRMED $\rightarrow$ CHECKED_IN**: Triggered by QR validation (see Lifecycle).
- **CHECKED_IN $\rightarrow$ COMPLETED**: Triggered by session end-time or manual staff sign-off.
- **COMPLETED $\rightarrow$ INVOICED**: Triggered by the billing engine upon session closure.

---

## Lifecycle: Service $\rightarrow$ Book $\rightarrow$ QR $\rightarrow$ Session $\rightarrow$ Invoice
The operational flow is a linear pipeline ensuring no step is skipped:

1.  **Service Definition**: Admin defines the `BookingType`, staff assignment, and pricing in the catalog.
2.  **Booking**: Client selects a slot; system validates occupancy via `docs/project-spec.md` logic.
3.  **QR Generation**: Upon `CONFIRMED` status, a unique, time-bound QR token is generated (referenced as a gap to be closed in `review-loop/audit-v5.md`).
4.  **Session/Attendance**: QR is scanned $\rightarrow$ status moves to `CHECKED_IN` $\rightarrow$ session timer starts.
5.  **Invoice**: On `COMPLETED` status, the system aggregates duration/resource costs and generates the final invoice.

---

## N-Tier Architecture
The system is decoupled to ensure the "near-zero-cost" hybrid goal (`docs/AGENCY_PLATFORM_ROADMAP.md`):

- **UI Tier**: Control Plane (`src/controlplane/public/app.js`) providing a natural-language interface for task composition and live logs.
- **API Tier**: REST/SSE layer handling requests between the UI and the orchestration engine.
- **Business Tier**: 
    - **Orchestrator**: LangGraph-based review loops (`src/agency/reviewGraph.ts`).
    - **Task Engine**: `src/controlplane/taskSpec.ts` managing intent, risk, and success criteria.
- **Data Tier**: Hybrid storage (Local JSON/SQLite for `project-memory.json` and `daily-ops.json`; Cloud for optional persistence).

---

## Security
Security is implemented via a "Least Privilege" model as mandated by `docs/DELIVERY_OS.md` and `src/agency/roles.ts`.

- **Tenant/Workspace Isolation**: Enforced via `.cursor/rules/workspace-boundary.mdc` and `src/agency/capabilities.ts`. Data access is scoped strictly to the active workspace.
- **RBAC (Role-Based Access Control)**: Defined in `src/agency/roles.ts` and `src/agency/delivery/goNoGo.ts`. Level-3 implementation requires explicit `GO` from an authorized admin.
- **Token Lifecycle**: 
    - **Access Tokens**: Short-lived for API requests.
    - **Refresh Tokens**: Used to rotate access tokens; invalidated upon logout or security breach.
- **Audit**: Every state transition and "Go/No-Go" decision is logged in the `rollback-journal.json` (P10 Roadmap).

---

## Delivery Phases
Delivery follows the `docs/AGENCY_PLATFORM_ROADMAP.md` and `docs/DELIVERY_OS.md` framework. No code is edited without a gated approval.

- **Phase 1: Intake & Evidence**: Scout repository for existing signals (e.g., `src/agency/evidence.ts`).
- **Phase 2: Strategy & Review**: Strategist $\leftrightarrow$ Auditor loop (max 5 iterations) to produce `APPROVED` strategy.
- **Phase 3: Architectural Blueprint**: Architect defines the technical spec based on the approved strategy.
- **Phase 4: Gated Implementation**: Execution of tasks via `src/controlplane/taskLifecycle.ts` only after `GO` signal.
- **Phase 5: Handoff & Archive**: Final reports and evidence packed into `docs/Sam-Harness no.X` for owner review.