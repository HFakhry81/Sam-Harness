# Rejection v1

[REJECTED]

### Issue 1
- **أسباب الرفض / Rejection reason**: Invention of evidence. The strategy cites `docs/AGENCY_PLATFORM_ROADMAP.md` multiple times (under Alignment, N-Tier Architecture, Security, and Delivery Phases), but this file is **not present** in the provided Evidence Pack.
- **درجة الخطورة / Severity**: Critical
- **طريقة الحل / How to fix**: Remove all references to `docs/AGENCY_PLATFORM_ROADMAP.md` and align the roadmap/delivery phases strictly with `docs/DELIVERY_OS.md` and `src/controlplane/taskLifecycle.ts`.

### Issue 2
- **أسباب الرفض / Rejection reason**: Invention of evidence. The strategy cites `rollback-journal.json` and `project-memory.json` / `daily-ops.json` as part of the Data Tier and Audit logs, but these files are **not present** in the Evidence Pack.
- **درجة الخطورة / Severity**: High
- **طريقة الحل / How to fix**: Remove references to specific `.json` files not found in the scan. Reference `src/agency/evidence.ts` or `agent-memory.md` for state/memory signals.

### Issue 3
- **أسباب الرفض / Rejection reason**: Incomplete Token Lifecycle. While the strategy mentions "Access Tokens" and "Refresh Tokens," it fails to define the **actual lifecycle** (issuance $\rightarrow$ validation $\rightarrow$ expiration $\rightarrow$ revocation) or link it to the RBAC signals in `src/agency/roles.ts` and `src/agency/delivery/goNoGo.ts`. It is a generic description rather than a concrete strategy.
- **درجة الخطورة / Severity**: Medium
- **طريقة الحل / How to fix**: Define the token lifecycle specifically in the context of the `goNoGo.ts` logic (e.g., how a token is upgraded or validated to move a task from `PENDING` to `GO`).

### Issue 4
- **أسباب الرفض / Rejection reason**: Missing concrete link for QR $\rightarrow$ Invoice. The strategy lists the flow as a "linear pipeline" but admits the QR generation is a "gap to be closed." An approved strategy must provide the **concrete mechanism** for how the `CHECKED_IN` status (via QR) triggers the eventual `INVOICED` state, rather than marking it as a future gap.
- **درجة الخطورة / Severity**: High
- **طريقة الحل / How to fix**: Define the trigger mechanism: `QR Scan` $\rightarrow$ `Update Status to CHECKED_IN` $\rightarrow$ `Session End Event` $\rightarrow$ `Trigger Billing Engine` $\rightarrow$ `Status INVOICED`.

---
FIX 1: Purge `docs/AGENCY_PLATFORM_ROADMAP.md` from all sections.
FIX 2: Remove invented `.json` files; use `src/agency/evidence.ts` for data signals.
FIX 3: Detail the token lifecycle tied to `src/agency/delivery/goNoGo.ts`.
FIX 4: Replace "gap to be closed" with a concrete logic flow for QR $\rightarrow$ Invoice.
