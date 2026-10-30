# Phase 5 — Near-zero model cost

**Goal:** Keep marginal LLM spend near $0 by routing cheap work to local/free tiers, caching prompts, compacting context, and never exceeding the Phase 1 daily cost cap (default **$0.50**).

## Architecture

```text
invokeTracked / makeSpecialistModel / makeCeoModel
        │
        ▼
src/lib/cost/
  ├─ difficulty.ts   classify cheap | standard | premium
  ├─ router.ts       local → free → paid (cap-aware)
  ├─ compact.ts      trim oversized prompts
  ├─ promptCache.ts  exact SQLite cache + provider cache hints
  └─ config.ts       env defaults
        │
        ▼
costLedger.ts (Phase 1) — per-run / per-day tokens + $; assertWithinCostCap
```

## Routing

| Difficulty | Typical source | Default route |
| --- | --- | --- |
| **cheap** | CEO router, short confirms | Local Ollama (`SAM_LOCAL_*`) |
| **standard** | light specialist work | Local (optional free via `SAM_PREFER_FREE_FOR_STANDARD=1`) |
| **premium** | strategist / auditor / architect / coder; verification failure; low confidence; explicit complexity | Paid when key + budget allow; else free → local |

**Escalation** to a higher tier happens on verification failure or confidence below `SAM_ESCALATE_CONFIDENCE_BELOW` (default `0.55`).

**Hybrid profile interaction**

| Mode | Behavior |
| --- | --- |
| `local` | Always local (ignores cloud key) |
| `auto` | Difficulty routing (local-first) |
| `cloud` | Prefers paid for non-cheap work when affordable; degrades when near/at cap |

## Cost cap (unchanged contract)

- Daily cloud budget defaults to **$0.50** (`costCapUsd` on hybrid profile / tenant).
- **`$0`** forbids all cloud/paid calls.
- Phase 5 adds **near-cap degradation**: when remaining budget / cap ≤ `SAM_COST_NEAR_CAP_RATIO` (default `0.15`), paid routes are refused and the router falls back to free/local. Spend never exceeds the cap.

## Caching

| Kind | Where | Notes |
| --- | --- | --- |
| Exact prompt→response | SQLite `prompt_cache` (migration v2) | Key = SHA-256(model + prompt); TTL `SAM_CACHE_TTL_MS` |
| Provider prompt caching | Hints on paid/free routes | `prompt_cache_key` + Anthropic-style `cache_control` when `SAM_PROVIDER_PROMPT_CACHE=1` |

Cache hits are recorded as **$0** local usage (tokens optional) and never charge the cloud ledger.

## Context compaction

Prompts longer than `SAM_CONTEXT_MAX_CHARS` keep a head + tail window and replace the middle with a marker, targeting `SAM_CONTEXT_TARGET_CHARS`.

## Env (see `.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SAM_ROUTING_ENABLED` | `1` | Difficulty-based routing |
| `SAM_CACHE_ENABLED` | `1` | Exact SQLite cache |
| `SAM_PROVIDER_PROMPT_CACHE` | `1` | Provider cache hints |
| `SAM_CACHE_TTL_MS` | `86400000` | Cache TTL (24h) |
| `SAM_CACHE_MAX_ENTRIES` | `500` | Per-tenant max rows |
| `SAM_COST_NEAR_CAP_RATIO` | `0.15` | Degrade when ≤15% budget left |
| `SAM_CONTEXT_MAX_CHARS` | `24000` | Compact threshold |
| `SAM_CONTEXT_TARGET_CHARS` | `16000` | Compact target |
| `SAM_LOCAL_BASE_URL` | `http://localhost:11434` | Local Ollama / OpenAI-compatible |
| `SAM_LOCAL_MODEL` | `CEO_MODEL` or `qwen2.5-coder:1.5b` | Local model id |
| `SAM_FREE_BASE_URL` | _(empty)_ | Optional free-tier OpenAI-compatible base |
| `SAM_FREE_API_KEY` | _(empty)_ | Optional free-tier key |
| `SAM_FREE_MODEL` | _(empty)_ | Optional free-tier model |
| `SAM_PAID_BASE_URL` | `https://ollama.com` | Paid / cloud host |
| `SAM_PAID_MODEL` | `gemma4:cloud` | Default paid model |
| `SAM_ESCALATE_CONFIDENCE_BELOW` | `0.55` | Escalate on low confidence |
| `SAM_PREFER_FREE_FOR_STANDARD` | _(unset)_ | Set `1` to prefer free over local for standard |
| `OLLAMA_API_KEY` | _(empty)_ | Required for paid Ollama Cloud |
| `FORCE_LOCAL_SPECIALISTS` | _(unset)_ | Force local regardless of key |
| `HYBRID_MODE` | _(profile)_ | `local` \| `cloud` \| `auto` |

## APIs

- `GET /api/cost-usage` — budget snapshot + routing/cache status (`nearCap`, cache hit counts).
- `GET /api/hybrid-profile` — profile + cost budget (unchanged).

## Tests

`tests/near-zero-cost.test.ts` covers routing, caching, compaction, accounting, and cap/near-cap behavior with **no network calls**.

## Owner decisions

| Decision | Value |
| --- | --- |
| Default daily cloud cap | **$0.50** (Phase 1) |
| Default first hop | Local Ollama |
| Paid only when | Premium difficulty (or hybrid `cloud`) **and** key + remaining budget |
| Near-cap | Graceful local/free degradation; never exceed cap |
| Cache store | Embedded SQLite (`prompt_cache`) |
