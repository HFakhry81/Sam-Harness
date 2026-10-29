# CODE_VS_PLAN_GAP_MATRIX.md

| Requirement | Evidence path (from pack or "not found") | Gap | Severity | Ticket |
| :--- | :--- | :--- | :--- | :--- |
| **Project Memory (P9)** | `src/controlplane/projectMemory.ts` | None | Low | N/A |
| **Daily Ops Ledger (P6)** | `src/controlplane/dailyOps.ts` | None | Low | N/A |
| **Report Viewer (P5)** | `src/controlplane/artifacts.ts` | None | Low | N/A |
| **Control Plane Server** | `src/controlplane/server.ts` | None | Low | N/A |
| **Control Plane UI** | `src/controlplane/public/index.html` | None | Low | N/A |
| **UI Logic/Routing** | `src/controlplane/public/app.js` | None | Low | N/A |
| **Task Specification** | `src/controlplane/taskSpec.ts` | None | Low | N/A |
| **Lesson Execution** | `src/controlplane/runLessons.ts` | None | Low | N/A |
| **Auth/RBAC** | `docs/DELIVERY_OS.md` | Logic exists in docs but not in `src/controlplane/` | Medium | TBD |
| **Tenant/Workspace Isolation** | `docs/Sam-Harness no.1/DELIVERY_BOARD.md` | Logic exists in docs but not in `src/controlplane/` | High | TBD |
| **Booking/Occupancy Logic** | `docs/project-spec.md` | Logic exists in docs but not in `src/controlplane/` | High | TBD |
| **QR/Check-in System** | `docs/Sam-Harness no.1/help-system-spec.md` | Logic exists in docs but not in `src/controlplane/` | High | TBD |