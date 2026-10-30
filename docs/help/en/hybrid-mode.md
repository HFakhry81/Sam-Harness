# Local vs cloud vs hybrid

Sources: `src/lib/cost/router.ts`, `difficulty.ts`, `config.ts`, `src/controlplane/hybridProfile.ts`, `src/agent/models.ts`, `.env.example`.

## Mode decision

| Mode | Behaviour |
| --- | --- |
| `local` | Never paid — ignores cloud key |
| `auto` (default) | Cheap/standard → local; premium → paid if key+budget, else free→local |
| `cloud` | Prefer paid for non-cheap when affordable; near/exhausted cap degrades to free/local; if cap exhausted or $0 may throw `CostCapExceededError` instead of silently running unpaid |

Precedence: `FORCE_LOCAL_SPECIALISTS=1` → `HYBRID_MODE` env → hybrid profile in DB → default `auto`.

Control Plane: **Hybrid** tab (`GET/POST /api/hybrid-profile`) and `GET /api/cost-usage`.

## Daily cap $0.50

- Constant: `DEFAULT_COST_CAP_USD = 0.5` in `hybridProfile.ts`
- Stored per tenant; `$0` blocks all cloud calls
- Only `cloud: true` charges count toward the cap
- Never exceed the cap (`assertWithinCostCap` / `canAffordPaid`)

## Near-cap behaviour

- When `remaining / cap ≤ SAM_COST_NEAR_CAP_RATIO` (default `0.15`, i.e. after ~85% spent): `shouldDegradeToLocal` → **no paid**; prefer free if configured else local
- Spend HITL: a single charge ≥ `SAM_TRUST_SPEND_APPROVAL_USD` (default `0.25`) needs `APPROVE_SPEND=1` while the cap still applies

## Difficulty routing

| Tier | Approx score | Example roles |
| --- | --- | --- |
| cheap | ≤0.28 | ceo_router, operator, evidence |
| standard | mid | default / help / marketer |
| premium | ≥0.7 | auditor, architect, strategist, coder |

Escalation: confidence below `SAM_ESCALATE_CONFIDENCE_BELOW` (0.55) or verification failure → bump one tier.

`SAM_ROUTING_ENABLED=0` disables difficulty routing (legacy: cloud if key+budget).

## Related env vars

`HYBRID_MODE`, `FORCE_LOCAL_SPECIALISTS`, `SAM_ROUTING_ENABLED`, `SAM_COST_NEAR_CAP_RATIO`, `SAM_LOCAL_*`, `SAM_FREE_*`, `SAM_PAID_*`, `SAM_ESCALATE_CONFIDENCE_BELOW`, `SAM_PREFER_FREE_FOR_STANDARD`, `OLLAMA_API_KEY`, cache `SAM_CACHE_*`.
