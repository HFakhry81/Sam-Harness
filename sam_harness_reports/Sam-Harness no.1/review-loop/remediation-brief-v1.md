Merge strategy-v1 with ALL rejection fixes into FULL strategy-v2.
Add section "Merged fixes from rejection-v1".
MUST-FIX:
1. **أسباب الرفض / Rejection reason**: Invention of evidence. The strategy cites `docs/AGENCY_PLATFORM_ROADMAP.md` multiple times (under Alignment, N-Tier Architecture, Security, and Delivery Phases), but this file is **not present** in the provided Evidence Pack.
2. **درجة الخطورة / Severity**: Critical
3. **طريقة الحل / How to fix**: Remove all references to `docs/AGENCY_PLATFORM_ROADMAP.md` and align the roadmap/delivery phases strictly with `docs/DELIVERY_OS.md` and `src/controlplane/taskLifecycle.ts`.
4. **أسباب الرفض / Rejection reason**: Invention of evidence. The strategy cites `rollback-journal.json` and `project-memory.json` / `daily-ops.json` as part of the Data Tier and Audit logs, but these files are **not present** in the Evidence Pack.
5. **درجة الخطورة / Severity**: High
6. **طريقة الحل / How to fix**: Remove references to specific `.json` files not found in the scan. Reference `src/agency/evidence.ts` or `agent-memory.md` for state/memory signals.
7. **أسباب الرفض / Rejection reason**: Incomplete Token Lifecycle. While the strategy mentions "Access Tokens" and "Refresh Tokens," it fails to define the **actual lifecycle** (issuance $\rightarrow$ validation $\rightarrow$ expiration $\rightarrow$ revocation) or link it to the RBAC signals in `src/agency/roles.ts` and `src/agency/delivery/goNoGo.ts`. It is a generic description rather than a concrete strategy.
8. **درجة الخطورة / Severity**: Medium
9. **طريقة الحل / How to fix**: Define the token lifecycle specifically in the context of the `goNoGo.ts` logic (e.g., how a token is upgraded or validated to move a task from `PENDING` to `GO`).
10. **أسباب الرفض / Rejection reason**: Missing concrete link for QR $\rightarrow$ Invoice. The strategy lists the flow as a "linear pipeline" but admits the QR generation is a "gap to be closed." An approved strategy must provide the **concrete mechanism** for how the `CHECKED_IN` status (via QR) triggers the eventual `INVOICED` state, rather than marking it as a future gap.
11. **طريقة الحل / How to fix**: Define the trigger mechanism: `QR Scan` $\rightarrow$ `Update Status to CHECKED_IN` $\rightarrow$ `Session End Event` $\rightarrow$ `Trigger Billing Engine` $\rightarrow$ `Status INVOICED`.
12. Purge `docs/AGENCY_PLATFORM_ROADMAP.md` from all sections.
13. Remove invented `.json` files; use `src/agency/evidence.ts` for data signals.
14. Detail the token lifecycle tied to `src/agency/delivery/goNoGo.ts`.

PRIOR STRATEGY:
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

REJECTION:
# Audit v1/5
Result: [REJECTED]

[REJECTED]

### Issue 1
- **أسباب الرفض / Rejection reason**: Invention of evidence. The strategy cites `docs/AGENCY_PLATFORM_ROADMAP.md` multiple times (under Alignment, N-Tier Architecture, Security, and Delivery Phases), but this file is **not present** in the provided Evidence Pack.
- **درجة الخطورة / Severity**: Critical
- **طريقة الحل / How to fix**: Remove all references to `docs/AGENCY_PLATFORM_ROADMAP.md` and align the roadmap/delivery phases strictly with `docs/DELIVERY_OS.md` and `src/controlplane/taskLifecycle.ts`.

### Issue 2
- **أسباب الرفض / Rejection reason**: Invention of evidence. The strategy cites `rollback-journal.json` and `project-memory.json` / `daily-ops.json` as part of the Data Tier and Audit logs, but these files are **not present** in the Evidence Pack.
- **درجة الخطورة / Severity**: High
- **طريقة الحل / How to fix**: Remove references to specific `.json` files not found in the scan. Reference `src/agency/evidence.ts` or `agent-memory.md` for state/memory signals.

### Issue 3
- **أسباب الرفض / Rejection reason**: Incomplete Token Lifecycle. While the strategy mentions "Access Tokens" and "Refresh Tokens," it fails to define the **actual lifecycle** (issuance $\rightarrow$ validation $\rightarrow$ expiration $\rightarrow$ revocation) or link it to the RBAC signals in `src/agency/roles.ts` and `src/agency/delivery/goNoGo.ts`. It is a generic description rather than a concrete strategy.
- **درجة الخطورة / Severity**: Medium
- **طريقة الحل / How to fix**: Define the token lifecycle specifically in the context of the `goNoGo.ts` logic (e.g., how a token is upgraded or validated to move a task from `PENDING` to `GO`).

### Issue 4
- **أسباب الرفض / Rejection reason**: Missing concrete link for QR $\rightarrow$ Invoice. The strategy lists the flow as a "linear pipeline" but admits the QR generation is a "gap to be closed." An approved strategy must provide the **concrete mechanism** for how the `CHECKED_IN` status (via QR) triggers the eventual `INVOICED` state, rather than marking it as a future gap.
- **درجة الخطورة / Severity**: High
- **طريقة الحل / How to fix**: Define the trigger mechanism: `QR Scan` $\rightarrow$ `Update Status to CHECKED_IN` $\rightarrow$ `Session End Event` $\rightarrow$ `Trigger Billing Engine` $\rightarrow$ `Status INVOICED`.

---
FIX 1: Purge `docs/AGENCY_PLATFORM_ROADMAP.md` from all sections.
FIX 2: Remove invented `.json` files; use `src/agency/evidence.ts` for data signals.
FIX 3: Detail the token lifecycle tied to `src/agency/delivery/goNoGo.ts`.
FIX 4: Replace "gap to be closed" with a concrete logic flow for QR $\rightarrow$ Invoice.

EVIDENCE:
# Evidence pack (local scout)

Target: `E:\UpNexa.com\Sam-Harness`
Scanned: 2026-10-29T16:55:12.976Z
Hits: 59

Auditor MUST cite these paths (or mark "not found") — do not invent frameworks.

- `docs/DELIVERY_OS.md` — RBAC/auth signals (content)
- `docs/project-spec.md` — booking/occupancy signals (content)
- `src/agency/capabilities.ts` — tenant/workspace isolation signals (content)
- `src/agency/delivery/goNoGo.ts` — RBAC/auth signals (content)
- `src/agency/evidence.ts` — booking/occupancy signals (content)
- `src/agency/reviewGraph.ts` — booking/occupancy signals (content)
- `src/agency/roles.ts` — RBAC/auth signals (content)
- `src/agent/level2Swarm.ts` — tenant/workspace isolation signals (content)
- `src/controlplane/public/app.js` — tenant/workspace isolation signals (content)
- `src/controlplane/taskLifecycle.ts` — tenant/workspace isolation signals (content)
- `src/controlplane/taskSpec.ts` — tenant/workspace isolation signals (content)
- `scripts/eval-task-spec.ts` — tenant/workspace isolation signals (content)
- `scripts/smoke-delivery.ts` — booking/occupancy signals (content)
- `.cursor/rules/workspace-boundary.mdc` — tenant/workspace isolation signals
- `agent-memory.md` — tenant/workspace isolation signals (content)
- `audit-attempt-1.md` — booking/occupancy signals (content)
- `audit-attempt-2.md` — booking/occupancy signals (content)
- `audit-attempt-3.md` — booking/occupancy signals (content)
- `audit-history.md` — booking/occupancy signals (content)
- `audit-report.md` — QR/check-in signals (content)
- `capabilities.smoke.md` — tenant/workspace isolation signals (content)
- `ceo-draft-attempt-1.md` — booking/occupancy signals (content)
- `ceo-draft-attempt-2.md` — tenant/workspace isolation signals (content)
- `ceo-draft-attempt-3.md` — tenant/workspace isolation signals (content)
- `ceo-draft.md` — booking/occupancy signals (content)
- `CODE_VS_PLAN_GAP_MATRIX.md` — booking/occupancy signals (content)
- `DELIVERY_BOARD.md` — tenant/workspace isolation signals (content)
- `evidence-pack.md` — tenant/workspace isolation signals (content)
- `evidence-pack.smoke.md` — tenant/workspace isolation signals (content)
- `execution-plan.md` — booking/occupancy signals (content)
- `help-system-spec.md` — tenant/workspace isolation signals (content)
- `IMPLEMENTATION_BACKLOG.md` — booking/occupancy signals (content)
- `index.ts` — tenant/workspace isolation signals (content)
- `marketing-campaign.md` — booking/occupancy signals (content)
- `NEXT_SPRINT.md` — booking/occupancy signals (content)
- `pnpm-workspace.yaml` — tenant/workspace isolation signals
- `review-loop/audit-v1.md` — activity template / status machine signals (content)
- `review-loop/audit-v2.md` — booking/occupancy signals (content)
- `review-loop/audit-v3.md` — tenant/workspace isolation signals (content)
- `review-loop/audit-v4.md` — tenant/workspace isolation signals (content)
- `review-loop/audit-v5.md` — QR/check-in signals (content)
- `review-loop/rejection-v1.md` — 
...(truncated)