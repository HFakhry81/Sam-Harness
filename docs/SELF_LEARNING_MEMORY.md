# Self-learning memory

Sam-Harness accumulates **lessons** and **skills** across runs under the agent output home and injects the most relevant ones into Strategist / Auditor prompts so later runs avoid known failures.

## Store

Path: `SAM_OUTPUT_HOME/memory/` (default `~/Documents/Sam-Harness/memory/`)

| File | Role |
| --- | --- |
| `lessons.json` | Failures: auditor rejection reasons, gate failures |
| `skills.json` | Success patterns from approved strategy shapes/steps |
| `promoted-rules.json` | Deterministic pre-check rules promoted from recurring lessons |

Writes are atomic (temp + rename). Each file carries `schemaVersion`. Corrupt JSON is backed up as `*.corrupt.*` and replaced with an empty valid store.

## Entry shape

Each entry has: `id`, `kind` (`lesson` \| `skill`), `text`, normalized `fingerprint`, `tags` (task/target/gate), `sourceRunId`, timestamps, `hitCount`, `successCount` / `failureCount`, `relatedIds`, optional `parentId` (variant), optional `promoted` + `promoteRule`.

## Dedup (critical)

Text is normalized (case, whitespace, punctuation, Arabic diacritics / letter variants, Arabic-Indic digits → ASCII). Similarity = max(token Jaccard, char-shingle Jaccard).

| Band | Default | Behavior |
| --- | --- | --- |
| Duplicate | ≥ `0.92` | Do **not** store a new row; increment `hitCount` (+ outcome counters) |
| Variant | `[0.70, 0.92)` | Store as a **new** entry linked to parent via `parentId` / `relatedIds` |
| Distinct | `< 0.70` | New unlinked entry |

Env overrides: `SAM_MEMORY_DUP_THRESHOLD`, `SAM_MEMORY_VARIANT_THRESHOLD`.

## Retrieval

Before planning and auditing, top entries are selected by tag match + lexical relevance + hit/success weighting, bounded by `SAM_MEMORY_RETRIEVE_LIMIT` and `SAM_MEMORY_TOKEN_BUDGET`. Injected as a delimited block:

```
<<<SAM_HARNESS_LEARNED_MEMORY>>>
...
<<<END_SAM_HARNESS_LEARNED_MEMORY>>>
```

## Promotion

A lesson that recurs `SAM_MEMORY_PROMOTE_HITS` times (default **3**) and has an expressible forbidden pattern (quoted token, residue path, etc.) is promoted into a deterministic pre-check. Promoted rules run **before** the LLM auditor.

## Model policy

Local models **≤3B** may only be used for simple triage / classification / extraction. Never for planning, review, translation, or research. Memory ingest/retrieve/promote is **deterministic by default** (no extra paid calls; daily cloud cap still `$0.50`).

## Chat memory

Chat transcripts and explicitly saved user facts are stored in the tenant-scoped persistence database (`chat-conversations`), not as per-chat JSON or Markdown files. The chat uses a bounded slice of recent messages from earlier conversations as context; clearing the visible conversation does not remove saved facts.

To save a durable user fact, start a message with `تذكّر:` / `تذكر:` or `Remember:`. Only this explicit request saves a fact. The chat's `Auto`, `Local`, and `Cloud` choices use the configured quick-role models; explicit Cloud requests still require a provider key and must fit the configured cost cap.

## CLI

```bash
pnpm run memory -- list
pnpm run memory -- list lessons
pnpm run memory -- show <id>
pnpm run memory -- prune --min-hits 2
pnpm run memory -- promote
pnpm run memory -- stats
pnpm run memory -- path
```

Console output is English-only ASCII.

## Related

- Legacy Control Plane key/value memory: `src/controlplane/projectMemory.ts` (still injected alongside)
- Output home resolver: `src/lib/outputHome.ts`
- Review loop wiring: `src/agency/reviewGraph.ts`
