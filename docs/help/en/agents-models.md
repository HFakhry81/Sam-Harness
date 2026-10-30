# Agents & models per role

Sources: `config/team.json`, `src/agency/teamConfig.ts`, `src/agent/models.ts`, `src/lib/cost/config.ts`, `.env.example`.

## Per-role model configuration (Phase 8)

Every role has configurable **local**, **cloud/paid**, and optional **free** model names:

1. Defaults in `config/team.json` (validated by `config/team.schema.json`)
2. Env overrides:
   - `SAM_ROLE_<ROLE>_MODEL` → local
   - `SAM_ROLE_<ROLE>_CLOUD_MODEL` → paid/cloud
   - `SAM_ROLE_<ROLE>_FREE_MODEL` → free tier
3. Call-site overrides remain optional; factories prefer team config

`<ROLE>` is the role id uppercased (`strategist` → `SAM_ROLE_STRATEGIST_MODEL`).

## Default table (preserves pre-Phase-8 behaviour)

| Role / agent | Cloud (default) | Local (default) | Factory |
| --- | --- | --- | --- |
| CEO Router | `gemma4:cloud` | `CEO_MODEL` or `qwen2.5-coder:1.5b` | `makeCeoModel` |
| Strategist | `gemma4:cloud` | `CEO_MODEL` or `qwen2.5-coder:1.5b` | `makeSpecialistModel` `role:"strategist"` |
| Auditor | `gemma4:cloud` | `gemma3:1b` | `makeSpecialistModel` `role:"auditor"` |
| Architect | `gemma4:cloud` | `qwen2.5:1.5b` | `makeSpecialistModel` `role:"architect"` |
| Help (report pack) | `gemma4:cloud` | `qwen2.5:1.5b` | `role:"help"` |
| Marketer | `gemma4:cloud` | `qwen2.5:1.5b` | `role:"marketer"` |
| L3 Coder | `gemma4:cloud` | `qwen2.5-coder:1.5b` | `role:"coder"` |
| Verifier | via CEO path | cheap local | `makeCeoModel` |
| Intake / Evidence | no LLM | — | filesystem / `scanRepoEvidence` |

Edit models in Control Plane → **Team**, or patch `config/team.json`, or set env overrides.

## Global provider defaults

| Variable | Default |
| --- | --- |
| `CEO_MODEL` | `qwen2.5-coder:1.5b` |
| `SAM_LOCAL_BASE_URL` | `http://localhost:11434` |
| `SAM_LOCAL_MODEL` | empty → `CEO_MODEL` then default above |
| `SAM_PAID_BASE_URL` | `https://ollama.com` |
| `SAM_PAID_MODEL` | `gemma4:cloud` |
| `SAM_FREE_*` | empty until set |
| `OLLAMA_API_KEY` | required for paid cloud |

## Role difficulty (for routing)

From `difficulty.ts` (+ Phase 8 `prefersCloud` nudge):

- **Cheap:** `ceo_router`, `ceo`, `operator`, `evidence`, `router`
- **Premium floor:** `auditor`, `architect`, `strategist`, `coder`, `reviewer`
- **Standard:** `help`, `marketer`, `verifier`, … unless complexity / prefersCloud bumps the score

Live route per role: `GET /api/routing/effective` or `pnpm run doctor`.
