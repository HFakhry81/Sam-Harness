# CODE_VS_PLAN_GAP_MATRIX.md

| Requirement | Evidence path (from pack or "not found") | Gap | Severity | Ticket |
| :--- | :--- | :--- | :--- | :--- |
| **BookingType: APPOINTMENT** (Staff/Service collision logic) | `docs/project-spec.md` | Defined in spec; TS interfaces/logic not found in `src/` | High | P0-BOOK-01 |
| **BookingType: RESOURCE_RENTAL** (Capacity/Exclusive logic) | `docs/project-spec.md` | Defined in spec; TS interfaces/logic not found in `src/` | High | P0-BOOK-02 |
| **BookingType: BATCH_SCHEDULE** (Group/Bulk check-in) | `docs/project-spec.md` | Defined in spec; TS interfaces/logic not found in `src/` | High | P0-BOOK-03 |
| **State Machine: PENDING $\rightarrow$ CONFIRMED** | `src/controlplane/taskLifecycle.ts` | Lifecycle exists for tasks, but specific Booking state transitions not found | Medium | P1-STATE-01 |
| **State Machine: CONFIRMED $\rightarrow$ CHECKED_IN** (QR Trigger) | `docs/Sam-Harness no.1/help-system-spec.md`, `docs/Sam-Harness no.1/marketing-campaign.md` | QR signals exist in docs; QR validation logic not found in `src/` | High | P0-QR-01 |
| **State Machine: CHECKED_IN $\rightarrow$ COMPLETED** | `src/controlplane/taskLifecycle.ts` | Generic task completion exists; session timer logic not found | Medium | P1-STATE-02 |
| **State Machine: COMPLETED $\rightarrow$ INVOICED** | not found | No evidence of billing engine or invoice transition in `src/` or `docs/` | High | P0-BILL-01 |
| **Tenant/Workspace Isolation** | `.cursor/rules/workspace-boundary.mdc`, `src/controlplane/taskLifecycle.ts` | Implemented via workspace boundaries and lifecycle management | None | N/A |
| **RBAC (Admin/Staff/Client)** | `src/agency/roles.ts`, `docs/DELIVERY_OS.md` | Implemented via roles definition and delivery OS signals | None | N/A |
| **Audit Trail (Results Ledger)** | `docs/Sam-Harness no.1/audit-history.md` | Defined in audit docs; ledger implementation not found in `src/` | Medium | P1-AUDIT-01 |
| **UI Control Plane (Task Composition)** | `src/controlplane/public/app.js` | Implemented as the primary interface | None | N/A |
| **Business Logic Orchestration** | `src/agency/reviewGraph.ts` | Implemented via LangGraph agency loop | None | N/A |