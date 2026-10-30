# Cost & budget

- Default daily cloud cap: **$0.50** per tenant  
- `$0` = block all cloud  
- Accurate per-run/daily accounting; SQLite prompt cache reduces repeats (`SAM_CACHE_ENABLED`)  
- Near-cap → degrade to local/free (see [`hybrid-mode`](hybrid-mode.md))  
- Raise the cap: Hybrid tab in the UI or update the hybrid profile  

Status: `GET /api/cost-usage` and the cost strip in the UI.

Code-oriented write-up: `docs/PHASE5_NEAR_ZERO_COST.md`.
