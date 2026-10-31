# Intent router (chat / research / task / complex)

Sam-Harness classifies **every** message **before** any agency or ops pipeline — Control Plane chat Send and the CLI entry both use the same router.

## Routes

| Route | When | What runs |
| --- | --- | --- |
| **chat** | Greetings, small talk, name intros, simple questions | Short reply in the user language. **No** `task.ts`, **no** report packs, **no** files. |
| **research** | Needs lookup / “search the web…” | Search + concise grounded answer with sources. At most **one** optional note under `documents/research-notes/`. |
| **task** | Simple single command / desktop action | Operational CEO loop (existing tools). |
| **complex** | Paths + examine/build/fix/audit, architecture, multi-step | Full agency / architecture pipeline with report packs. |
| **clarify** | Unsure between chat and task | One-line clarifying question — never launches the pipeline. |

Deterministic rules run first (Arabic + English greetings, question patterns, path + verb cues). If still ambiguous, an optional tiny local model (**≤3B**, default `qwen2.5:1.5b` / role `quick`) may triage. When still unsure, the system **asks** instead of launching agency.

Respects the **$0.50** daily cloud cost cap. Chat/research prefer local/free.

## Language

Replies match the user language (Arabic in → Arabic out). Console logs stay **English-only ASCII**.

## Force full agency

UI checkbox **Run as full agency task**, or CLI `--force-agency` / `FORCE_AGENCY=1`, always forces the **complex** pipeline.

## UI

The Control Plane compose view is a **chat** surface: message list + one input + **Send**. Each assistant reply shows a subtle route label. The reports/outputs panel appears only for **task** / **complex** routes (collapsed by default). Chat-route failures never show **FAILED / task saved for retry**.

## Conversation history

Per-session history lives under `SAM_OUTPUT_HOME/conversations/` (usually `~/Documents/Sam-Harness/conversations/`).

## Models

Configurable in `config/team.json` as role id `quick` (default local `qwen2.5:1.5b`). Overrides:

- `SAM_ROLE_QUICK_MODEL`
- `SAM_ROLE_QUICK_CLOUD_MODEL`

## Web search providers

Default: DuckDuckGo HTML (no API key). Optional via `.env`:

- `SAM_WEB_SEARCH_PROVIDER=duckduckgo|tavily|brave|searxng`
- `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SEARXNG_URL`

If every provider returns no usable page text, research **does not call the model** (no hallucinations).
