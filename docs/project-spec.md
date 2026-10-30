# Project Spec — Sam-Harness Agency (LangGraph)

## Goal
Build a **near-zero-cost hybrid AI agency** competitive with global multi-agent platforms:
local + cloud specialists, safe PC daily ops, email/results, system analysis → executable report packs → gated implementation.

Runtime path today: intake → evidence scout → LangGraph review loop → gated Architect/Help/Marketer → archive under:

`{SAM_OUTPUT_HOME}/reports/` (default `~/Documents/Sam-Harness/reports`) or pack dir from the run.

North star + phases: `docs/AGENCY_PLATFORM_ROADMAP.md`. Ops: `docs/AGENCY_OPS.md`.

## Mode
architecture / report-only by default — **no** client application code edits without owner auth (Go/No-Go).
Runtime: `AGENCY_MODE=1` (default) uses LangGraph agency; `AGENCY_MODE=0` = legacy swarm.

## Prior reports to improve
Sam-Harness cwd / output home: `ceo-draft.md`, `audit-*.md`, `execution-plan.md`, `help-system-spec.md`, `marketing-campaign.md`, `final-report.md`

## Must align to
Platform docs in this repo (`AGENCY_OPS`, Delivery OS, vision). **Client-specific** product rules (booking types, domain lifecycles, etc.) live under `docs/engagements/` — not in this platform spec.

## Quality
Aim for Auditor **APPROVED on attempt 1**. Rejections must include أسباب الرفض · درجة الخطورة · طريقة الحل.

## Level-3
Implementation is **spec-driven** via `level3-plan.json` in the pack (writes/patches + optional `testCommand`). No product-specific patches in harness source. Git branch + rollback on test failure when the target is a git repo.

## Non-goals
- Hardcoding client product paths or patches inside `src/`
- Overwriting a previous numbered review pack without archive
- Auto-sending email without owner approval (`APPROVE_COMMS` + UI approve)
