Since you are starting with the first P0 ticket (**T-001: Tenant/Workspace Isolation**), we need to establish the security boundary that prevents one customer (tenant) from accessing another customer's data.

Below is the **`TICKET_P0_STARTER.md`**. This document serves as the technical specification and implementation checklist for the developer/AI to execute the task.

***

# TICKET_P0_STARTER.md: T-001 Tenant/Workspace Isolation

## 📋 Ticket Overview
- **Ticket ID:** T-001
- **Priority:** 🔴 P0 (Critical)
- **Requirement:** Tenant/Workspace Isolation
- **Target Path:** `src/controlplane/auth/isolation.ts`
- **Objective:** Implement a strict isolation layer to ensure that every request to the control plane is scoped to a specific `tenantId` or `workspaceId`, preventing cross-tenant data leakage.

## 🎯 Technical Goals
1. **Context Injection:** Create a mechanism to extract `tenantId` from the request (JWT or Header) and inject it into the request context.
2. **Isolation Middleware:** Implement a middleware that validates the user's membership/permissions for the requested workspace.
3. **Data Access Layer (DAL) Guard:** Ensure that all database queries for resources (bookings, users, settings) include a mandatory `WHERE tenant_id = ?` clause.
4. **Error Handling:** Implement a specific `ForbiddenError` (403) when a user attempts to access a resource outside their tenant boundary.

## 🛠 Implementation Plan

### Phase 1: Type Definitions & Interface
- [ ] Define `TenantContext` interface.
- [ ] Define `IsolationError` custom error class.
- [ ] Create the `isolation.ts` file.

### Phase 2: The Isolation Middleware
- [ ] Implement `tenantIsolationMiddleware`:
    - Extract `tenantId` from the authenticated user session/token.
    - Verify that the `tenantId` is present and valid.
    - Attach the `tenantId` to the request object (e.g., `req.tenantId`).

### Phase 3: Integration with Control Plane
- [ ] Apply the middleware to all protected routes in `src/controlplane/server.ts`.
- [ ] Update existing service calls to accept `tenantId` as a required parameter.

### Phase 4: Validation & Testing
- [ ] **Test Case A:** Valid user accessing their own tenant $\rightarrow$ `200 OK`.
- [ ] **Test Case B:** Valid user attempting to access another tenant's ID $\rightarrow$ `403 Forbidden`.
- [ ] **Test Case C:** Request missing tenant identifier $\rightarrow$ `401 Unauthorized`.

## ⚠️ Critical Constraints
- **No Defaults:** Never default to a "global" tenant. If no tenant is identified, the request must fail.
- **Immutable Context:** Once the `tenantId` is set in the request context by the middleware, it should be read-only for the remainder of the request lifecycle.
- **Performance:** The isolation check must be $O(1)$ or $O(\log n)$ to avoid adding significant latency to every API call.

## 🔗 Dependencies
- Requires `src/controlplane/auth/rbac.ts` (T-004) for advanced permission checks, but basic isolation must be functional first.
- Impacts all subsequent P0s (T-002, T-003) as they rely on isolated data.