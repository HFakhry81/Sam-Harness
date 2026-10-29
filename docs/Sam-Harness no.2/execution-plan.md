This blueprint establishes the production architecture for the **Sam-Harness Resource Orchestrator**, mapping the conceptual "Booking Triad" to the existing N-tier codebase.

# Production Blueprint: Sam-Harness Resource Orchestrator

**Status:** Production Blueprint / Implementation Guide  
**Alignment:** `docs/project-spec.md`, `docs/DELIVERY_OS.md`, `src/agency/roles.ts`

---

## 1. The BookingType Triad (Logic Layer)
As mandated by `docs/project-spec.md`, the system implements three distinct primitives. 

| Primitive | Focus | Logic Constraint | Evidence Path |
| :--- | :--- | :--- | :--- |
| **APPOINTMENT** | Staff/Service | Calendar collision $\rightarrow$ Staff Availability | `docs/project-spec.md` |
| **RESOURCE_RENTAL** | Physical/Virtual Asset | `session_capacity` $\rightarrow$ Exclusive/Shared | `docs/project-spec.md` |
| **BATCH_SCHEDULE** | Group/Recurring | Max Capacity $\rightarrow$ Bulk Check-in | `docs/project-spec.md` |

**GAP:** While defined in specs, the TypeScript interfaces for these types are **NOT FOUND** in `src/`. Implementation is required in Phase 1.

---

## 2. Deterministic State Machine
To eliminate ambiguity, the system follows a strict linear transition.

**Lifecycle Path:**
`PENDING` $\xrightarrow{Payment/Admin}$ `CONFIRMED` $\xrightarrow{QR Scan}$ `CHECKED_IN` $\xrightarrow{Timer/Staff}$ `COMPLETED` $\xrightarrow{Billing}$ `INVOICED`

**Trigger Mapping:**
- **QR Validation**: Signals found in `docs/Sam-Harness no.1/help-system-spec.md` and `docs/Sam-Harness no.1/marketing-campaign.md`.
- **Audit Trail**: Every transition must be logged to the results ledger per `docs/Sam-Harness no.1/audit-history.md`.

---

## 3. N-Tier Technical Architecture
The system is decoupled to ensure the "No client code edit without GO" boundary.

### Tier 1: UI (Control Plane)
- **Role**: Task composition, live logs, and reporting.
- **Existing Code**: `src/controlplane/public/app.js`
- **Function**: Interface for the `taskSpec.ts` engine to visualize success criteria.

### Tier 2: API (Orchestration)
- **Role**: State transition endpoints and QR token validation.
- **Existing Code**: `src/controlplane/taskLifecycle.ts` (manages the lifecycle of tasks/bookings).

### Tier 3: Business (LangGraph Agency)
- **Role**: Validation of "Definition of Done" (DoD) and agentic review.
- **Existing Code**: `src/agency/reviewGraph.ts` (The core orchestration loop).
- **Logic**: Uses `src/agency/roles.ts` to enforce RBAC (Admin vs. Staff vs. Client).

### Tier 4: Data (Isolated Storage)
- **Role**: Tenant-isolated ledger and resource occupancy.
- **Security**: Enforced via `.cursor/rules/workspace-boundary.mdc` to prevent cross-tenant leakage.

---

## 4. Security & Isolation Model
Implemented via "Least Privilege" as defined in `docs/DELIVERY_OS.md`.

- **Tenant Isolation**: Strict boundaries enforced by `src/controlplane/taskLifecycle.ts` and `.cursor/rules/workspace-boundary.mdc`.
- **RBAC**: Managed via `src/agency/roles.ts`.
- **Token Lifecycle**: 
    - **Issuance**: Signed tokens for QR check-ins (referenced in `docs/Sam-Harness no.1/help-system-spec.md`).
    - **Revocation**: Immediate invalidation upon `COMPLETED` or `CANCELLED` status.

---

## 5. Delivery Roadmap (The "Go/No-Go" Path)
No phases are claimed as shipped. All are targets for implementation.

| Phase | Focus | Dependency | Validation Tool |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Core Engine | `docs/project-spec.md` | `scripts/smoke-delivery.ts` |
| **Phase 2** | QR & Check-in | `docs/Sam-Harness no.1/help-system-spec.md` | `src/agency/evidence.ts` |
| **Phase 3** | Billing Integration | `COMPLETED` $\rightarrow$ `INVOICED` trigger | `src/agency/reviewGraph.ts` |
| **Phase 4** | Tenant Hardening | `.cursor/rules/workspace-boundary.mdc` | `src/agency/delivery/goNoGo.ts` |

**Final Handoff**: Archive under `docs/Sam-Harness no.X` containing the final audit report and execution plan.