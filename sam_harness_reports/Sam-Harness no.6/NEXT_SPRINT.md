# NEXT_SPRINT.md

## 🎯 Sprint Goal
Close critical gaps between architectural planning and functional implementation, focusing on security, core booking logic, and the public-facing portal.

## 🔴 High Priority (Critical Path)
- [ ] **Auth & RBAC Implementation**: Move from "signals" to full functional authentication and role-based access control.
- [ ] **Tenant/Workspace Isolation**: Implement and verify code-level isolation to ensure data privacy between tenants.
- [ ] **QR/Check-in Logic**: Resolve incomplete logic for failed check-in scenarios.
- [ ] **Pre-Launch Validation**: Execute and document the `PRE_LAUNCH_ACCEPTANCE_CHECKLIST.md`.

## 🟡 Medium Priority (Functional Gaps)
- [ ] **Public Booking Portal**: Develop functional code paths based on `public-booking-page.md`.
- [ ] **Admin Dashboard**: Develop functional code paths based on `admin-dashboard.md`.
- [ ] **Booking Logic Stress Test**: Implement edge-case testing for occupancy and booking flows.
- [ ] **API Implementation**: Map `PHASE_0_API_INVENTORY` to actual implemented endpoints.
- [ ] **Ops Validation**: Execute and log a test run of the Backup & Restore Runbook.

## 🔵 Low Priority (Maintenance & Polish)
- [ ] **Schema Validation**: Perform final validation of database migrations against the intended schema.
- [ ] **Infrastructure Confirmation**: Verify DNS/SSL configurations for hosting.
- [ ] **Privacy Workflow**: Explore automation for the Privacy Request Runbook.

## 📈 Success Metrics
- [ ] Zero "High" severity gaps remaining in `CODE_VS_PLAN_GAP_MATRIX.md`.
- [ ] Functional end-to-end flow: Public Booking $\rightarrow$ Admin Approval $\rightarrow$ QR Check-in.
- [ ] Verified tenant isolation via automated tests.