# Deterministic evals

Golden cases that guard the properties the harness must never regress. Everything
runs **offline** — no model calls, no network, no writes into the repository or
the user's output home.

```bash
pnpm run eval                  # all suites
pnpm run eval -- --suite intent,cost
pnpm run eval -- --json        # machine-readable summary
```

The runner exits non-zero when a suite falls below its threshold
(`thresholds` in [`cases.json`](./cases.json)), so CI fails on regressions.

## Isolation

The runner points `SAM_OUTPUT_HOME` at a disposable temp directory and gives each
cost case its own tenant, so a developer's real ledger, SQLite DB, and reports are
never touched.

## Suites

| Suite | What it locks down |
| --- | --- |
| `intent` | Heuristic routing: greetings stay chat, "what's new" → research, Arabic/English report requests → complex, file-count questions → task, bug fixes → complex |
| `security` | Secret-by-filename denial (`.env`, `*.pem`, `mcp.json`, `.env.example` allowed), repo immutability, source-root read-only, cloud-egress redaction |
| `cost` | Per-run cap independent of the daily cap, daily accumulation, `$0` forbids cloud spend |
| `sandbox` | `SAM_SANDBOX_MODE=auto\|docker\|subprocess`, legacy `SAM_SANDBOX_DOCKER=1`, unknown values fall back safely |
| `context` | Newest-turn replay, hard character budget, and the 16k default local context window (`SAM_LOCAL_NUM_CTX`) |

## Adding a case

Append an object to `cases.json`:

```json
{
  "id": "intent-my-case",
  "suite": "intent",
  "prompt": "…",
  "expect": { "route": "task", "intent": "simple_task" }
}
```

Suites are data-driven; a new *kind* of check needs a branch in
`scripts/eval-runner.ts`. Keep cases deterministic — `--live` is reserved for
future model-backed suites and is currently a no-op.
