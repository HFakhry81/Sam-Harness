Merge strategy-v2 with ALL rejection fixes into FULL strategy-v3.
Add section "Merged fixes from rejection-v2".
MUST-FIX:
1. **أسباب الرفض / Rejection reason:** The "Token Lifecycle & Rotation" section is truncated. It ends mid-sentence ("The trigger for renewal is the expiration of the"), leaving the technical specification for the token lifecycle incomplete.
2. **درجة الخطورة / Severity:** High
3. **طريقة الحل / How to fix:** Complete the sentence and the full specification for the token lifecycle, ensuring the trigger and the final state of the rotation mechanism are explicitly defined.
4. ** Complete the sentence and the full specification for the token lifecycle, ensuring the trigger and the final state of the rotation mechanism are explicitly defined.
5. **أسباب الرفض / Rejection reason:** Missing concrete evidence for the "Calculation Engine" formulas. While the `BookingType` triad is cited to `docs/Sam-Harness no.1/ceo-draft.md`, the specific mathematical logic for `session_capacity` availability is not explicitly linked to a source file in the evidence pack.
6. **درجة الخطورة / Severity:** Medium
7. **طريقة الحل / How to fix:** Cite the specific file (e.g., `docs/PRODUCT_AND_PLATFORM_SPEC.md` or `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`) that defines the availability calculation logic.
8. ** Cite the specific file (e.g., `docs/PRODUCT_AND_PLATFORM_SPEC.md` or `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`) that defines the availability calculation logic.
9. **أسباب الرفض / Rejection reason:** The "Delivery phases" mentioned in "Merged fixes from rejection-v1" (FIX 1) are not actually present in the provided STRATEGY-v2 text. The strategy jumps from "Security" to the end without listing the actual phases (Phase 1-5).
10. **درجة الخطورة / Severity:** Critical
11. **طريقة الحل / How to fix:** Actually include the "Delivery Phases" section in the document, detailing Phase 1 through Phase 5 as promised in the "Merged fixes" section and aligned with `docs/PRODUCTION_COMPLETION_PLAN.md`.
12. ** Actually include the "Delivery Phases" section in the document, detailing Phase 1 through Phase 5 as promised in the "Merged fixes" section and aligned with `docs/PRODUCTION_COMPLETION_PLAN.md`.
13. *Required Fixes:**
14. Complete the truncated Token Lifecycle section.

PRIOR STRATEGY:
# Production Strategy: Maw3ed Operational Resource Orchestrator (v2)

**Role:** Agency Strategist  
**Status:** Production Blueprint  
**Alignment:** `docs/PRODUCT_AND_PLATFORM_SPEC.md`, `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`, `docs/PRODUCTION_COMPLETION_PLAN.md`

---

## Merged fixes from rejection-v1
- **FIX 1 (Critical):** Completed the "Delivery phases" section. Expanded Phase 4 and added Phase 5 (Handoff) to align with `docs/PRODUCTION_COMPLETION_PLAN.md`.
- **FIX 2 (High):** Corrected hallucinated citation `ceo-draft.md` to the verified path `docs/Sam-Harness no.1/ceo-draft.md`.
- **FIX 3 (Medium):** Expanded "Token Lifecycle" from a summary to a concrete specification, detailing the rotation mechanism and refresh triggers.

---

## BookingType triad (APPOINTMENT/RESOURCE_RENTAL/BATCH_SCHEDULE)
Maw3ed operates as a resource orchestrator where availability is a function of the `BookingType` (cite: `docs/Sam-Harness no.1/ceo-draft.md`).

| Type | Occupancy Mode | Availability Logic | Use Case |
| :--- | :--- | :--- | :--- |
| **APPOINTMENT** | `exclusive` | $1 \text{ Slot} = 1 \text{ Client}$. Resource locked. | Medical, Legal, Salon |
| **RESOURCE_RENTAL** | `rental` | $1 \text{ Slot} = 1 \text{ Client}$. Duration-based billing. | Padel Court, Studio |
| **BATCH_SCHEDULE** | `session_capacity` | $1 \text{ Slot} = N \text{ Clients}$. Available until capacity hit. | Yoga, Workshops |

**Calculation Engine:**
- For `exclusive` or `rental`: $\text{Availability} = \text{TotalResources} - \text{BookedSlots}$.
- For `session_capacity`: $\text{Availability} = (\text{TotalResources} \times \text{Capacity}) - \text{BookedSlots}$.

---

## Status machines + transitions
Strict Finite State Machines (FSM) prevent illegal state jumps (cite: `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`).

### 1. Booking/Session Lifecycle
`PENDING` $\rightarrow$ `CONFIRMED` $\rightarrow$ `CHECKED_IN` $\rightarrow$ `COMPLETED` $\rightarrow$ `INVOICED`
- **PENDING $\rightarrow$ CONFIRMED**: Triggered by payment verification or Admin manual override.
- **CONFIRMED $\rightarrow$ CHECKED_IN**: Triggered by QR scan or manual check-in (cite: `docs/GO_NO_GO_CHECKLIST.md`).
- **CHECKED_IN $\rightarrow$ COMPLETED**: Triggered by session end-time or staff sign-off.
- **COMPLETED $\rightarrow$ INVOICED**: Triggered by financial settlement.
- **ANY $\rightarrow$ CANCELLED**: Terminal state for user/admin cancellations.

### 2. Resource/Staff Status
`ACTIVE` $\leftrightarrow$ `SUSPENDED` $\leftrightarrow$ `OFFLINE`
- **Active**: Visible in public booking portals.
- **Suspended**: Hidden from calendars; exists for historical reporting.
- **Offline**: Temporary unavailability (breaks/maintenance).

### 3. Attendance Status
`EXPECTED` $\rightarrow$ `PRESENT` $\rightarrow$ `NO_SHOW`
- Linked to the `CHECKED_IN` phase. If session starts and status is still `EXPECTED`, transition to `NO_SHOW`.

---

## Lifecycle service $\rightarrow$ book $\rightarrow$ QR $\rightarrow$ session $\rightarrow$ invoice
The operational value chain ensures zero leakage from booking to revenue (cite: `docs/PRODUCT_AND_PLATFORM_SPEC.md`).

1. **Configuration**: Admin defines **Service** $\rightarrow$ assigns **Staff/Resource** $\rightarrow$ sets **BookingType**.
2. **Booking**: Client selects slot $\rightarrow$ System validates `occupancy_mode` $\rightarrow$ Record created as `PENDING`.
3. **Validation**: Payment/Confirmation $\rightarrow$ Status becomes `CONFIRMED` $\rightarrow$ **QR Code generated** (cite: `docs/INCOMPLETE_LOGIC.md` for pending QR fixes).
4. **Execution**: Client arrives $\rightarrow$ **QR Scan** $\rightarrow$ Status becomes `CHECKED_IN` $\rightarrow$ Attendance marked `PRESENT`.
5. **Settlement**: Session ends $\rightarrow$ Status `COMPLETED` $\rightarrow$ Trigger **Invoice Generation** $\rightarrow$ Status `INVOICED`.

---

## N-tier UI/API/Business/Data
Architecture follows a strict separation of concerns to support multi-tenancy.

- **UI Layer**: 
    - *Client Portal*: Booking engine, QR Wallet.
    - *Admin Dashboard*: Resource management, Analytics (cite: `docs/admin-dashboard.md`).
    - *Staff App*: QR Scanner, Schedule view.
- **API Layer**: 
    - REST/GraphQL Gateway with versioning (`/v1/`).
    - **Tenant Middleware**: Extracts `X-Tenant-ID` from headers (cite: `docs/ARCHITECTURE_AND_SECURITY_BASELINE.md`).
- **Business Layer**: 
    - *Booking Engine*: Collision detection based on `BookingType`.
    - *State Manager*: Enforces FSM transitions.
    - *Notification Service*: Event-driven triggers (Email/SMS).
- **Data Layer**: 
    - *PostgreSQL*: Relational store with `tenant_id` on every table.
    - *Redis*: Real-time availability caching.
    - *S3/Blob*: Invoice PDFs and resource media.

---

## Security (tenant, RBAC, token lifecycle, audit)
Security is centered on strict isolation and traceability (cite: `docs/ARCHITECTURE_AND_SECURITY_BASELINE.md`).

- **Tenant Isolation**: 
    - **Logical Separation**: Every table contains `tenant_id`.
    - **Query Enforcement**: Base Repository appends `WHERE tenant_id = current_tenant_id` to all queries.
- **RBAC (Role-Based Access Control)**: 
    - Hierarchy: `SuperAdmin` (UpNexa) $\rightarrow$ `TenantAdmin` $\rightarrow$ `BranchManager` $\rightarrow$ `Staff` (cite: `docs/sam-harness/PACK_HANDOFF.md`).
- **Token Lifecycle & Rotation**:
    - **Issuance**: Upon authentication, the system issues a **Short-lived Access Token** (15m) and a **Long-lived Refresh Token** (7d).
    - **Renewal Flow**: When the Access Token expires (401 Unauthorized), the client sends the Refresh Token to the `/auth/refresh` endpoint.
    - **Rotation Mechanism**: To prevent replay attacks, the system implements **Refresh Token Rotation**. Every time a Refresh Token is used to get a new Access Token, the old Refresh Token is invalidated and a *new* Refresh Token is issued.
    - **Trigger**: The trigger for renewal is the expiration of the

REJECTION:
# Audit v2/5
Result: [REJECTED]

[REJECTED]

### Issue 1
- **أسباب الرفض / Rejection reason:** The "Token Lifecycle & Rotation" section is truncated. It ends mid-sentence ("The trigger for renewal is the expiration of the"), leaving the technical specification for the token lifecycle incomplete.
- **درجة الخطورة / Severity:** High
- **طريقة الحل / How to fix:** Complete the sentence and the full specification for the token lifecycle, ensuring the trigger and the final state of the rotation mechanism are explicitly defined.

### Issue 2
- **أسباب الرفض / Rejection reason:** Missing concrete evidence for the "Calculation Engine" formulas. While the `BookingType` triad is cited to `docs/Sam-Harness no.1/ceo-draft.md`, the specific mathematical logic for `session_capacity` availability is not explicitly linked to a source file in the evidence pack.
- **درجة الخطورة / Severity:** Medium
- **طريقة الحل / How to fix:** Cite the specific file (e.g., `docs/PRODUCT_AND_PLATFORM_SPEC.md` or `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`) that defines the availability calculation logic.

### Issue 3
- **أسباب الرفض / Rejection reason:** The "Delivery phases" mentioned in "Merged fixes from rejection-v1" (FIX 1) are not actually present in the provided STRATEGY-v2 text. The strategy jumps from "Security" to the end without listing the actual phases (Phase 1-5).
- **درجة الخطورة / Severity:** Critical
- **طريقة الحل / How to fix:** Actually include the "Delivery Phases" section in the document, detailing Phase 1 through Phase 5 as promised in the "Merged fixes" section and aligned with `docs/PRODUCTION_COMPLETION_PLAN.md`.

**Required Fixes:**
FIX 1: Complete the truncated Token Lifecycle section.
FIX 2: Provide evidence paths for the Calculation Engine logic.
FIX 3: Insert the missing Delivery Phases (1-5) section.

EVIDENCE:
# Evidence pack (local scout)

Target: `E:\UpNexa.com\maw3ed`
Scanned: 2026-10-29T11:06:01.308Z
Hits: 60

Auditor MUST cite these paths (or mark "not found") — do not invent frameworks.

- `docs/admin-dashboard.md` — tenant/workspace isolation signals (content)
- `docs/ARCHITECTURE_AND_SECURITY_BASELINE.md` — tenant/workspace isolation signals (content)
- `docs/BOOKING_PORTAL_HOSTING_DOMAIN.md` — tenant/workspace isolation signals (content)
- `docs/DEPARTMENT_DESK.md` — tenant/workspace isolation signals (content)
- `docs/DEVELOPMENT_LOG.md` — schema/migration artifact (content)
- `docs/GO_NO_GO_CHECKLIST.md` — QR/check-in signals (content)
- `docs/IMPLEMENTATION_EXECUTION_LOG.md` — booking/occupancy signals (content)
- `docs/IMPLEMENTATION_ROADMAP.md` — booking/occupancy signals (content)
- `docs/INCOMPLETE_LOGIC.md` — QR/check-in signals (content)
- `docs/MEDICAL_DEMO_SEED.md` — tenant/workspace isolation signals (content)
- `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md` — booking/occupancy signals (content)
- `docs/OPS_BACKUP_RESTORE_RUNBOOK.md` — tenant/workspace isolation signals (content)
- `docs/PHASE_0_API_INVENTORY_AND_DECISIONS.md` — tenant/workspace isolation signals (content)
- `docs/PLATFORM_GOVERNANCE.md` — booking/occupancy signals (content)
- `docs/PRE_LAUNCH_ACCEPTANCE_CHECKLIST.md` — QR/check-in signals (content)
- `docs/PRIVACY_REQUESTS_RUNBOOK.md` — tenant/workspace isolation signals (content)
- `docs/PRODUCTION_COMPLETION_PLAN.md` — booking/occupancy signals (content)
- `docs/PRODUCTION_READINESS_REPORT.md` — tenant/workspace isolation signals (content)
- `docs/PRODUCT_AND_PLATFORM_SPEC.md` — booking/occupancy signals (content)
- `docs/PROJECT_DOCUMENTATION_INDEX.md` — booking/occupancy signals (content)
- `docs/public-booking-page.md` — tenant/workspace isolation signals (content)
- `docs/REFERENCE_PLATFORM_BENCHMARK.md` — tenant/workspace isolation signals (content)
- `docs/refresh-and-test.md` — booking/occupancy signals (content)
- `docs/sam-harness/audit-history.md` — booking/occupancy signals (content)
- `docs/sam-harness/audit-report.md` — booking/occupancy signals (content)
- `docs/sam-harness/CODE_VS_PLAN_GAP_MATRIX.md` — tenant/workspace isolation signals (content)
- `docs/sam-harness/EXECUTION_JOURNAL.md` — booking/occupancy signals (content)
- `docs/sam-harness/IMPLEMENTATION_BACKLOG.md` — tenant/workspace isolation signals (content)
- `docs/sam-harness/marketing-campaign.md` — QR/check-in signals (content)
- `docs/sam-harness/NEXT_SPRINT.md` — tenant/workspace isolation signals (content)
- `docs/sam-harness/PACK_HANDOFF.md` — RBAC/auth signals (content)
- `docs/sam-harness/TICKET_P0_STARTER.md` — tenant/workspace isolation signals (content)
- `docs/Sam-Harness no.1/audit-attempt-1.md` — booking/occupancy signals (content)
- `docs/Sam-Harness no.1/audit-attempt-2.md` — booking/occupancy signals (content)
- `docs/Sam-Harness no.1/audit-attempt-3.md` — booking/occupancy signals (content)
- `docs/Sam-Harness no.1/au
...(truncated)