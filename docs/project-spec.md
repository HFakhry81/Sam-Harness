# Project Spec — Sam-Harness Agency (LangGraph)

## Goal
Build a **near-zero-cost hybrid AI agency** competitive with global multi-agent platforms:
local + cloud specialists, safe PC daily ops, email/results later, system analysis → executable report packs → gated implementation.

Runtime path today: intake → evidence scout → LangGraph review loop → gated Architect/Help/Marketer → archive under:

`{targetRepo}/docs/Sam-Harness no.X\`

North star + phases: `docs/AGENCY_PLATFORM_ROADMAP.md`. Ops: `docs/AGENCY_OPS.md`.

## Mode
architecture / report-only by default — **no** client application code edits without owner auth.
Runtime: `AGENCY_MODE=1` (default) uses LangGraph agency; `AGENCY_MODE=0` = legacy swarm.

## Prior reports to improve
Sam-Harness cwd: `ceo-draft.md`, `audit-*.md`, `execution-plan.md`, `help-system-spec.md`, `marketing-campaign.md`, `final-report.md`

## Must align to
- `OPERATIONAL_FLOWS_AND_STATUS_MACHINES.md`
- `PRODUCTION_COMPLETION_PLAN.md`
- `PRODUCT_AND_PLATFORM_SPEC.md`

BookingTypes: APPOINTMENT | RESOURCE_RENTAL | BATCH_SCHEDULE  
Lifecycle: service+staff → book → QR → session/attendance → invoice

## Quality
Aim for Auditor **APPROVED on attempt 1**. Rejections must include أسباب الرفض · درجة الخطورة · طريقة الحل.

## Non-goals
- Editing Maw3ed `.js` / UI / app SQL
- Overwriting a previous `Sam-Harness no.X`
