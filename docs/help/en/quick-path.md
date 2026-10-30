# Quick reply path

Sam-Harness classifies each Control Plane message **before** the full agency pipeline.

## Paths

| Path | When | What runs |
| --- | --- | --- |
| **Quick** | Greetings / smalltalk, simple questions | One local Ollama call (`quick` role) |
| **Web** | “Search the web…”, news / current details | DuckDuckGo (or keyed provider) + page fetch + short summary with source links |
| **Agency** | Code, files, desktop actions, multi-step work | Existing LangGraph agency (unchanged) |

Target for Quick / Web: under ~10 seconds. Agency stays as-is for real tasks.

## Language

Replies match the user language (Arabic in → Arabic out). No system-status dumps.

## Models

Configurable in `config/team.json` as role id `quick` (default local `qwen2.5:1.5b`). Overrides:

- `SAM_ROLE_QUICK_MODEL`
- `SAM_ROLE_QUICK_CLOUD_MODEL`

If the preferred model is unavailable, the cheapest local / CEO model is used.

## Web search providers

Default: DuckDuckGo HTML (no API key). Optional via `.env`:

- `SAM_WEB_SEARCH_PROVIDER=duckduckgo|tavily|brave|searxng`
- `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SEARXNG_URL`

Respects cost cap, `SAM_ALLOW_NETWORK_EGRESS`, optional `SAM_TRUST_REQUIRE_NETWORK_APPROVAL`, and the audit log. Usage is recorded in the cost ledger.

## Force full agency

In the Control Plane compose panel, check **Run as full agency task** (or set `FORCE_AGENCY=1` / `--force-agency` on the CLI). Session history shows a **Quick / Web / Agency** badge per run.
