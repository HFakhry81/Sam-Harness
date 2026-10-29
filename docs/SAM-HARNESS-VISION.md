# Sam-Harness System Vision

**Status:** Architectural reference (archive)  
**Owner:** UpNexa  
**Purpose:** Canonical blueprint for any future autonomous Agentic AI Swarm rebuild.

---

## 1. Core Objective

Build an **Autonomous Enterprise Swarm Engine** for UpNexa, supervised by a CEO agent that can:

1. **Resolve user intent**  
   From simple operational work (files, code edits, moves across `C:`, `D:`, `E:`) to complex product architecture (SaaS systems, Fanni, Maw3ed).

2. **Execute without hardcoded task scripts**  
   No per-task `if/else` or RegEx paths inside `index.ts`. The agent decides and acts dynamically.

3. **Close the quality loop**  
   The CEO receives final outputs, compares them to original requirements, then approves, reroutes for fixes, or issues the final report.

---

## 2. Architecture & Core Pillars

```text
                  ┌───────────────────────────────┐
                  │   User Task (task.md / CLI)   │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
                 ┌────────────────────────────────┐
                 │  CEO Supervisor (Local Model)  │
                 └──────────────┬─────────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
  [Level 1: Operational]                       [Level 2: Architecture]
         │                                               │
         ├─ Dynamic Tool Calling (MCP)                   ├─ Swarm Crew
         │  (readFile, moveFile, shell)                  │  (Auditor, Architect)
         │                                               │
         └─ Code Interpreter (REPL Sandbox)              └─ System Blueprint
            (Writes & runs temporary Node.js)                    │
         │                                               │
         └───────────────────────┬───────────────────────┘
                                 │
                                 ▼
                 ┌────────────────────────────────┐
                 │  CEO Verification & Audit Loop │
                 │ (Compare Output vs Task Intent)│
                 └────────────────────────────────┘
```

### A. Structured Tool & Function Calling (MCP)

- Do **not** rely on free-text path guessing or RegEx parsing.
- Give the CEO supervisor an MCP-style tool protocol over local filesystem paths (`C:`, `D:`, `E:`).
- The agent emits structured JSON tool calls, for example:

```json
{
  "tool": "move_and_update_file",
  "params": {
    "sourcePath": "D:\\Projects\\heitham.txt",
    "destinationPath": "C:\\Users\\Haitham\\Desktop\\heitham.txt",
    "newContent": "وبه نستعين!!!"
  }
}
```

### B. Dynamic Code Generation & REPL

- When no prebuilt tool fits, the CEO writes temporary Node.js/TypeScript.
- Run it in a **sandboxed** executor.
- On failure, return stderr/result to the CEO for **self-correction** until success.
- Delete temporary artifacts after completion.

### C. Hybrid Local + Cloud Intelligence

| Layer | Model | Role |
| --- | --- | --- |
| Local | DeepSeek via Ollama | Leadership, routing, operational control — speed, $0 cost, privacy |
| Cloud | Gemma / Claude (etc.) | Heavy architecture, DB design, deep code/security review |

---

## 3. Key Takeaways & Future Work

1. **No hardcoded shortcuts**  
   Editing `index.ts` for every new task is a script, not an intelligent agent.

2. **Split operational vs architectural work**  
   - Fast ops (create/edit/move) → tool-backed Executor  
   - Large projects → full swarm cycle: CEO → Auditor → Architect (+ Help / Marketer as needed)

3. **Prefer standards**  
   MCP (Model Context Protocol) gives local models a real hand on the machine instead of guessing paths.

---

## 4. Current vs Target Gap (snapshot)

| Capability | Target vision | Typical current harness |
| --- | --- | --- |
| Intent routing (ops vs architecture) | Dynamic CEO decision | Mostly fixed LangGraph pipeline |
| Filesystem / shell tools | MCP / structured tools | Limited or absent |
| Sandboxed code REPL | Self-correcting temp scripts | Not primary path |
| CEO verification loop | Compare outputs vs intent | Auditor loop on plan text mainly |
| Hybrid local + cloud | Local CEO + cloud specialists | Partially present |

---

## 5. Requirements & video coverage

For a plain-language answer to *what must be built* and whether `task.md` can drive play/create video, see:

**[REQUIREMENTS-ROADMAP.md](./REQUIREMENTS-ROADMAP.md)**

That doc is the requirements archive. It does not replace this vision; it translates the vision into build prerequisites and honest capability limits.

---

## 6. Archive Note

This document is the **architectural compass** for Sam-Harness.  
Use it as the first building block when UpNexa rebuilds autonomous AI engines — not as a description of every line in the current `index.ts` prototype.
