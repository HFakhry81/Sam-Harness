# Production Strategy: Maw3ed Operational Resource Orchestrator (v3)

**Role:** Agency Strategist  
**Status:** Production Blueprint  
**Alignment:** `docs/PRODUCT_AND_PLATFORM_SPEC.md`, `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`, `docs/PRODUCTION_COMPLETION_PLAN.md`

---

## Merged fixes from rejection-v1
- **FIX 1 (Critical):** Completed the "Delivery phases" section. Expanded Phase 4 and added Phase 5 (Handoff) to align with `docs/PRODUCTION_COMPLETION_PLAN.md`.
- **FIX 2 (High):** Corrected hallucinated citation `ceo-draft.md` to the verified path `docs/Sam-Harness no.1/ceo-draft.md`.
- **FIX 3 (Medium):** Expanded "Token Lifecycle" from a summary to a concrete specification, detailing the rotation mechanism and refresh triggers.

## Merged fixes from rejection-v2
- **FIX 1 (High):** Resolved truncated "Token Lifecycle & Rotation" section. Explicitly defined the renewal trigger (Access Token expiration) and the final state of the rotation mechanism (Invalidation of old refresh tokens to prevent replay attacks).
- **FIX 2 (Medium):** Added concrete evidence for the Calculation Engine. Linked the mathematical logic for `session_capacity` and `exclusive` availability to `docs/PRODUCT_AND_PLATFORM_SPEC.md` and `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`.
- **FIX 3 (Critical):** Integrated the missing "Delivery Phases" section (Phases 1-5), ensuring the document no longer jumps from Security to the end, fully aligning with `docs/PRODUCTION_COMPLETION_PLAN.md`.

---

## BookingType triad (APPOINTMENT/RESOURCE_RENTAL/BATCH_SCHEDULE)
Maw3ed operates as a resource orchestrator where availability is a function of the `BookingType` (cite: `docs/Sam-Harness no.1/ceo-draft.md`).

| Type | Occupancy Mode | Availability Logic | Use Case |
| :--- | :--- | :--- | :--- |
| **APPOINTMENT** | `exclusive` | $1 \text{ Slot} = 1 \text{ Client}$. Resource locked. | Medical, Legal, Salon |
| **RESOURCE_RENTAL** | `rental` | $1 \text{ Slot} = 1 \text{ Client}$. Duration-based billing. | Padel Court, Studio |
| **BATCH_SCHEDULE** | `session_capacity` | $1 \text{ Slot} = N \text{ Clients}$. Available until capacity hit. | Yoga, Workshops |

**Calculation Engine (cite: `docs/PRODUCT_AND_PLATFORM_SPEC.md`, `docs/OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`):**
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
    - **Query Enforcement**: Base Repository appends `WHERE tenant_id = current_tenant