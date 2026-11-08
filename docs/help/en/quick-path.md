# Intent router (chat / research / task / complex)

Sam-Harness classifies **every** message **before** any agency or ops pipeline — Control Plane chat Send and the CLI entry both use the same router.

## Routes

| Route | When | What runs |
| --- | --- | --- |
| **chat** | Greetings, small talk, name intros, simple questions | Short reply in the user language. **No** `task.ts`, **no** report packs, **no** files. |
| **research** | Needs lookup / “search the web…” | Search + concise grounded answer with sources, displayed in chat. Control Plane chat does not write a research note. |
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

## Conversation history and memory

Chat history and explicitly saved facts live in the tenant-scoped persistence database, not per-chat transcript files. Recent context from earlier conversations is bounded and provided to the selected model. Use `Remember: ...` or `تذكّر: ...` to save a durable fact.

## Models

Choose **Auto**, **Local**, or **Cloud** in the chat composer. Auto follows configured quick-role routing; Cloud requires a provider key and respects the daily cost cap. Models remain configurable in `config/team.json` as role id `quick` (default local `qwen2.5:1.5b`). Overrides:

Chat can iteratively use the read-only `list_dir`, `read_file`, and `search_code` tools (up to 8 calls per turn). Writes, shell commands, and destructive tools remain in the approved task workflow. If a cloud model requests a workspace tool, tool results are sent only to a local model for the follow-up; workspace contents are not forwarded to a cloud model.

The default local Ollama endpoint is `http://127.0.0.1:11434` (override with `SAM_LOCAL_BASE_URL`). If chat reports a connection error, start Ollama and verify the configured model with `ollama list`; install a missing model with `ollama pull <model>`.

Interactive chat defaults to a 4K context, 256-token batch, and 5-minute model residency to limit GPU/RAM use; tune these independently with `SAM_QUICK_NUM_CTX`, `SAM_QUICK_NUM_BATCH`, and `SAM_QUICK_KEEP_ALIVE`. Long-form agent roles retain the shared `SAM_LOCAL_NUM_CTX` / `SAM_LOCAL_NUM_BATCH` settings.

- `SAM_ROLE_QUICK_MODEL`
- `SAM_ROLE_QUICK_CLOUD_MODEL`

## Web search providers

Default: DuckDuckGo HTML (no API key). Optional via `.env`:

- `SAM_WEB_SEARCH_PROVIDER=duckduckgo|tavily|brave|searxng`
- `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SEARXNG_URL`

If every provider returns no usable page text, research **does not call the model** (no hallucinations).
