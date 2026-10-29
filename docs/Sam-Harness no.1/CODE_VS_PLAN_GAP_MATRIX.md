# CODE_VS_PLAN_GAP_MATRIX.md

| Requirement | Evidence path (from pack or "not found") | Gap | Severity | Ticket |
| :--- | :--- | :--- | :--- | :--- |
| **Booking Primitives** (`APPOINTMENT`, `RESOURCE_RENTAL`, `BATCH_SCHEDULE`) | `docs/project-spec.md` | Logic defined in spec; implementation in code not found | High | TICKET-BOOK-01 |
| **Booking State Machine** (`PENDING` $\rightarrow$ `INVOICED`) | `review-loop/audit-v1.md` | State transitions defined in audit/spec; logic not found in `src/` | High | TICKET-STATE-01 |
| **QR Token Generation** (Time-bound tokens for `CONFIRMED` status) | not found | No evidence of QR generation logic in provided paths | Critical | TICKET-QR-01 |
| **QR Validation Trigger** (`QR Scan` $\rightarrow$ `CHECKED_IN`) | `src/agency/delivery/goNoGo.ts` | Validation signal exists, but specific QR-to-Status mapping not found | Medium | TICKET-QR-02 |
| **Billing Engine** (Duration $\rightarrow$ Cost $\rightarrow$ Invoice) | not found | Explicitly marked as GAP in Blueprint; no code evidence | Critical | TICKET-BILL-01 |
| **Occupancy Validation** (Capacity/Collision checks) | `docs/project-spec.md` | Defined in spec; implementation not found in `src/` | High | TICKET-OCC-01 |
| **Workspace Isolation** (Tenant/Workspace boundaries) | `.cursor/rules/workspace-boundary.mdc`, `src/agency/capabilities.ts` | Implemented via rules and capabilities | Low | N/A |
| **RBAC / Role Definitions** | `src/agency/roles.ts`, `docs/DELIVERY_OS.md` | Implemented via roles and OS spec | Low | N/A |
| **Task Lifecycle Management** | `src/controlplane/taskLifecycle.ts`, `src/controlplane/taskSpec.ts` | Implemented in control plane | Low | N/A |
| **Evidence/Audit Trail** | `src/agency/evidence.ts`, `src/agency/reviewGraph.ts` | Implemented via evidence store and review graph | Low | N/A |
| **Agent Memory/Context** | `agent-memory.md` | Implemented via memory layer | Low | N/A |