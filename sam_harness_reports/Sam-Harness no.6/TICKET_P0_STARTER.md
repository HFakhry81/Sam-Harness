Based on the `IMPLEMENTATION_BACKLOG.md`, here is the detailed starter ticket for the first P0 item.

***

# TICKET_P0_01: Implement RBAC and Authentication Signals

## 📋 Overview
**Ticket ID:** P0-01  
**Priority:** 🔴 Critical (Blocker)  
**Status:** To Do  
**Requirement:** Full Authentication and Role-Based Access Control (RBAC) implementation.  
**Gap:** Current codebase lacks a verified, complete auth implementation that aligns with the project specifications.

## 🎯 Objective
Implement a robust Authentication and Authorization system that ensures users are identified and granted access only to the resources permitted by their assigned roles, as defined in the `docs/sam-harness/PACK_HANDOFF.md` signals.

## 🛠 Technical Requirements

### 1. Authentication Layer
- [ ] **Identity Provider:** Implement/Configure the auth provider (e.g., Auth0, Firebase Auth, or custom JWT implementation) as specified in the handoff docs.
- [ ] **Session Management:** Implement secure token handling (HttpOnly cookies or secure local storage) and session expiration/refresh logic.
- [ ] **Middleware:** Create a global authentication middleware to protect private routes and validate JWTs/Sessions.

### 2. RBAC (Role-Based Access Control)
- [ ] **Role Definition:** Implement the following roles (verify against `PACK_HANDOFF.md`):
    - `SuperAdmin`: Full system access.
    - `Admin`: Workspace/Tenant management.
    - `Staff/Operator`: Check-in/Check-out and booking management.
    - `User/Customer`: Public booking and personal profile management.
- [ ] **Permission Mapping:** Create a mapping of roles to specific API endpoints and UI components.
- [ ] **Authorization Guard:** Implement a `checkRole(['role1', 'role2'])` guard/decorator for backend controllers and frontend route guards.

### 3. Integration with Tenant Isolation (P0-02 Linkage)
- [ ] Ensure the Auth token contains the `tenant_id` or `workspace_id` to prevent cross-tenant data leakage.

## 📖 Reference Documents
- `docs/sam-harness/PACK_HANDOFF.md` (Primary source for auth signals)
- `IMPLEMENTATION_BACKLOG.md` (Priority context)

## ✅ Acceptance Criteria
- [ ] **Verified Login:** Users can authenticate and receive a valid session token.
- [ ] **Role Enforcement:** A user with the `User` role cannot access `/admin` endpoints (returns 403 Forbidden).
- [ ] **Token Validation:** Expired or malformed tokens are rejected with a 401 Unauthorized response.
- [ ] **Role Persistence:** User roles are correctly stored in the database and reflected in the auth token.
- [ ] **Documentation:** Update the API documentation to reflect which endpoints require which roles.

## 🧪 Testing Plan
- **Unit Tests:** Test the `checkRole` utility with various role combinations.
- **Integration Tests:** 
    - Attempt to access an Admin route with a User token.
    - Attempt to access a protected route without any token.
    - Verify that a SuperAdmin can access all restricted areas.
- **Manual QA:** Log in as different personas and verify UI elements (buttons/links) are hidden/shown based on role.