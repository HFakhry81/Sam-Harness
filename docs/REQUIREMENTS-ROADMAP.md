# Sam-Harness — Requirements to Realize the Vision (and Video)

**Status:** Requirements archive (not an implementation sprint)  
**Related:** [SAM-HARNESS-VISION.md](./SAM-HARNESS-VISION.md)  
**Note:** This document answers *what must exist* for `task.md` → real execution. It does **not** mean “run or rewrite `index.ts` today.”

---

## Direct answer

**Partially yes — only if real tools exist.**

- Describing work in `task.md` and having the swarm execute it is the correct agentic goal.
- The system does **not** execute by magic. It only does what a **Tool** or a safe **REPL** can do.
- **Play a video on this PC:** in-scope (desktop/shell tool opens the file in a media player).
- **Create a video:** theoretically in-scope later, but needs a separate media stack (ffmpeg and/or a video-generation API, assets, verification). The vision alone does not produce video.

The current `index.ts` prototype is still closer to a fixed planning/report pipeline than a universal `task.md` executor.

```text
task.md intent
      │
      ▼
CEO router (local)
      ├─ Operational  → Level-1 tools (MCP / shell / REPL) → verify
      └─ Architecture → Level-2 swarm (Auditor / Architect) → verify
                              │
                              ▼
                     final report (or retry)
```

---

## What you actually need

### 1) Intent → Route (CEO Supervisor)

- Read `task.md` / CLI.
- One clear decision: **Operational**, **Architecture**, or mixed.
- No per-task hardcode in source; model output constrained by a fixed JSON schema.

### 2) Real tools (the core)

Without these, `task.md` stays text only.

| Tool | Why |
| --- | --- |
| `read_file` / `write_file` / `list_dir` | Files and paths |
| `move_copy_delete` | Moves across drives |
| `run_shell` with a safety policy | OS actions |
| `run_node_sandbox` | Temporary code + self-fix |
| Later: `open_media` / `ffmpeg_*` | Play / cut / assemble video |

Prefer MCP or LangChain structured tools — not RegEx on free-form model text.

### 3) Verification loop

- CEO compares results to `task.md` intent (file exists? player launched? duration/path correct?).
- On fail → retry tools / self-correct; do not fake success.

### 4) Hybrid models (on purpose)

- Local CEO: routing + tool calls (needs a model that is **good at tool calling**; tiny DeepSeek 1.5B/1.8B is often too weak).
- Cloud: heavy architecture and review.
- Creative video: usually a separate generation service — not the same CEO model.

### 5) Safety boundaries

- Path and command allowlists.
- Human approval for dangerous actions (delete, install, broad network).
- Otherwise “anything from `task.md`” becomes a machine risk.

### 6) Memory and observability

- Lesson store (`agent-memory.md` or equivalent).
- Clear logs per tool call (name, params, result).

---

## Does video fit the idea?

| Example in `task.md` | Covered by vision? | Extra requirement |
| --- | --- | --- |
| Play `E:\clips\demo.mp4` | Yes | `open_media` / shell start + verify process |
| Move a video D: → Desktop | Yes | Normal file tools |
| Trim first 10 seconds | Yes, with conditions | **ffmpeg** (or equivalent) as a tool |
| Make an ad video from a text brief | Yes as a distant goal | Generation pipeline (API and/or images+ffmpeg) + assets + often human review |
| Design a scheduling SaaS | Yes (Level 2) | Architecture swarm — docs/code outputs, not video |

**Bottom line:** `task.md` → execute works for **capabilities you have instrumented**. Playing video is a relatively small operational tool. Generating video from a prompt is a media capability layered on top of the harness, not “CEO alone.”

---

## Suggested build order (future work — not started here)

1. CEO router + output schema  
2. File tools + constrained shell + verify  
3. Node sandbox with self-correction  
4. Separate Architecture swarm path  
5. Media tools (`open_media` → ffmpeg → generation later)

---

## What the system will not achieve alone

- Vague intents with no matching tools.
- Reliable tool calling from a very weak local model.
- High-end cinematic video without a specialized generation/edit stack.
- Safety without allowlists / approvals.

---

## Recommended next planning step (when you choose to build)

Scope an **MVP Level 1 only**: files + constrained shell + CEO verify from `task.md` — before video tools or the full architecture swarm.
