# NEXT_SPRINT.md

## 🎯 Sprint Goal
Bridge the gap between architectural documentation and functional code, focusing on high-severity core business logic and security.

## 🛠 High Priority (Critical Gaps)
- [ ] **Tenant/Workspace Isolation**
  - Implement logic to ensure data separation between different tenants/workspaces.
  - *Source:* `docs/Sam-Harness no.1/DELIVERY_BOARD.md`
- [ ] **Booking & Occupancy Logic**
  - Develop the core engine for managing bookings and tracking occupancy.
  - *Source:* `docs/project-spec.md`
- [ ] **QR/Check-in System**
  - Implement the check-in workflow and QR code validation logic.
  - *Source:* `docs/Sam-Harness no.1/help-system-spec.md`

## 🛡 Medium Priority (Security & Access)
- [ ] **Auth/RBAC Implementation**
  - Translate RBAC (Role-Based Access Control) definitions from docs into `src/controlplane/`.
  - *Source:* `docs/DELIVERY_OS.md`

## ✅ Maintenance (Low Gap)
- [ ] **Control Plane Audit**
  - Review existing implementations of Project Memory, Daily Ops, and Report Viewer to ensure they align with the latest specs.