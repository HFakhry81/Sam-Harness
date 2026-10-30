# Agents & models per role

Sources: `src/agent/models.ts`, call sites in runner/review/swarm/L3/ceoLoop/index, `src/lib/cost/config.ts`, `.env.example`.

## No per-role model env vars

**Not implemented:** there is no `HELP_MODEL` or `AUDITOR_MODEL`. Mapping is hardcoded at call sites; cloud vs local is decided by `resolveModelRoute` + cost cap + hybrid mode.

## Actual table (names from code)

| Role / agent | Cloud model (hardcoded) | Local model (hardcoded / env) | Factory |
| --- | --- | --- | --- |
| CEO Router (`index.ts`) | — local only | `CEO_MODEL` or `qwen2.5-coder:1.5b` | raw `ChatOllama` |
| CEO Loop L1 | — local only | `CEO_MODEL` or `qwen2.5-coder:1.5b` | `ChatOllama` @ `localhost:11434` |
| `makeCeoModel` (verifier / cheap) | via routing; `forceCheap` | `CEO_MODEL` or `SAM_LOCAL_MODEL` or default above | `makeCeoModel` |
| Strategist | `gemma4:cloud` | `CEO_MODEL` or `qwen2.5-coder:1.5b` | `makeSpecialistModel` |
| Auditor | `gemma4:cloud` | `gemma3:1b` | `makeSpecialistModel` |
| Architect | `gemma4:cloud` | `qwen2.5:1.5b` | `makeSpecialistModel` |
| Help (report pack) | `gemma4:cloud` | `qwen2.5:1.5b` | `makeSpecialistModel` `role:"help"` |
| Marketer | `gemma4:cloud` | `qwen2.5:1.5b` | `makeSpecialistModel` |
| L3 Coder | `gemma4:cloud` | `qwen2.5-coder:1.5b` | `makeSpecialistModel` `role:"coder"` |
| L3 Reviewer | CEO path | cheap local | `makeCeoModel` |
| Intake / Evidence | no LLM | — | filesystem / `scanRepoEvidence` |

## Global provider defaults

| Variable | Default |
| --- | --- |
| `CEO_MODEL` | `qwen2.5-coder:1.5b` |
| `SAM_LOCAL_BASE_URL` | `http://localhost:11434` |
| `SAM_LOCAL_MODEL` | empty → `CEO_MODEL` then `qwen2.5-coder:1.5b` |
| `SAM_PAID_BASE_URL` | `https://ollama.com` |
| `SAM_PAID_MODEL` | `gemma4:cloud` |
| `SAM_FREE_*` | empty (free tier unused until set) |
| `OLLAMA_API_KEY` | required for paid cloud |

Other keys in the example (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`) exist in `.env.example`; live specialist path uses Ollama (`ChatOllama`) and routing in `models.ts`.

## Role difficulty (for routing)

From `difficulty.ts`:

- **Cheap:** `ceo_router`, `ceo`, `operator`, `evidence`, `router`
- **Premium floor:** `auditor`, `architect`, `strategist`, `coder`, `reviewer`
- **Standard:** `help`, `marketer`, `verifier`, … unless prompt complexity bumps the score
