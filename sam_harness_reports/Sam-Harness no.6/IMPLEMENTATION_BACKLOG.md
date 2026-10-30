# IMPLEMENTATION_BACKLOG.md

This backlog is derived from the `CODE_VS_PLAN_GAP_MATRIX.md`. It prioritizes the transition from documentation/specification to verified, functional code.

## 🔴 Priority 0: Critical Path & Security
*Immediate action required. These items represent fundamental security risks or "blockers" for a viable product launch.*

| Ticket | Requirement | Gap | Action Item |
| :--- | :--- | :--- | :--- |
| **P0-01** | **RBAC/Auth Signals** | Full auth implementation not found. | Implement complete Authentication and Role-Based Access Control (RBAC) based on signals in `docs/sam-harness/PACK_HANDOFF.md`. |
| **P0-02** | **Tenant/Workspace Isolation** | Implementation verification not found. | Audit and implement strict data isolation layers to ensure tenants cannot access other workspace data. |
| **P0-03** | **QR/Check-in System** | Incomplete logic for failed check-ins. | Resolve logic gaps in `docs/INCOMPLETE_LOGIC.md` specifically for error handling and failure states during QR check-ins. |
| **P0-04** | **Pre-Launch Checklist** | Completion status not found. | Execute and document the `docs/PRE_LAUNCH_ACCEPTANCE_CHECKLIST.md` to identify remaining critical holes. |

---

## 🟡 Priority 1: Core Functional Delivery
*Required for a Minimum Viable Product (MVP). These items move the project from "planned" to "functional".*

| Ticket | Requirement | Gap | Action Item |
| :--- | :--- | :--- | :--- |
| **P1-01** | **Public Booking Portal** | Functional code path not found. | Develop the public-facing booking interface based on `docs/public-booking-page.md`. |
| **P1-02** | **Admin Dashboard** | Functional code path not found. | Develop the administrative management interface based on `docs/admin-dashboard.md`. |
| **P1-03** | **Booking & Occupancy Logic** | Edge-case stress testing not found. | Implement and document stress tests for booking collisions and occupancy limits defined in `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`. |
| **P1-04** | **API Inventory/Decisions** | Implementation status not found. | Map the inventory in `docs/PHASE_0_API_INVENTORY_AND_DECISIONS.md` to actual endpoints; implement missing routes. |
| **P1-05** | **Backup & Restore Runbook** | Execution logs/test results not found. | Perform a live test of the `docs/OPS_BACKUP_RESTORE_RUNBOOK.md` and archive the success logs. |

---

## 🔵 Priority 2: Stability & Compliance
*Low severity/Maintenance. To be addressed after P0 and P1 are closed.*

| Ticket | Requirement | Gap | Action Item |
| :--- | :--- | :--- | :--- |
| **P2-01** | **Database Schema/Migrations** | Final schema validation not found. | Perform a final audit of the database schema against the `docs/DEVELOPMENT_LOG.md` artifacts. |
| **P2-02** | **Hosting/Domain Strategy** | DNS/SSL confirmation not found. | Finalize DNS records and SSL certificate installation as per `docs/BOOKING_PORTAL_HOSTING_DOMAIN.md`. |
| **P2-03** | **Privacy Request Handling** | Automated workflow not found. | Build a basic automated trigger or standardized process for `docs/PRIVACY_REQUESTS_RUNBOOK.md`. |