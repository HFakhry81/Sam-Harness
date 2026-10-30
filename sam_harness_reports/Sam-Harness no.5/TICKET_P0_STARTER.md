To initiate the P0 phase, we need to establish the foundation of the `Sam-Harness` codebase. Since the codebase is currently missing, we will start by scaffolding the directory structure and implementing the **Core Infrastructure**.

Below is the first official ticket to kick off the implementation.

***

# 🎫 TICKET_P0_01: Core Infrastructure Scaffolding & Memory System

## 📋 Overview
**Status:** 🔴 To Do  
**Priority:** P0 (Critical Path)  
**Component:** `Sam-Harness/src/memory/`  
**Dependency:** None (Foundation)

### 🎯 Goal
Establish the physical directory structure for `Sam-Harness` and implement the **Memory System**. This system must allow the agent to persist project-wide context and session-specific state so that it does not "forget" its progress between restarts or different task runs.

---

## 🛠 Technical Requirements

### 1. Directory Scaffolding
Initialize the following structure to support the full P0/P1 roadmap:
```text
Sam-Harness/
├── src/
│   ├── memory/    <-- (Current Focus)
│   ├── ledger/    <-- (Next Ticket)
│   ├── analysis/   <-- (P1)
│   └── ui/        <-- (P1)
└── data/          <-- (Persistent storage files/DB)
```

### 2. Memory System Implementation (`src/memory/`)
Implement a storage layer with the following capabilities:
- **Storage Engine:** Implement a lightweight JSON-based document store or SQLite database for persistence.
- **Schema Definition:**
    - **Project Memory:** Global constants, project goals, architectural decisions, and "Known Truths."
    - **Session Memory:** Short-term state, current active goals, and temporary variables for the current run.
- **API Methods:**
    - `save_memory(scope: "project" | "session", key: string, value: any)`
    - `get_memory(scope: "project" | "session", key: string)`
    - `inject_context()`: A method that aggregates relevant memory into a string format suitable for LLM prompt injection.

---

## ✅ Acceptance Criteria
- [ ] `Sam-Harness/src/memory/` directory exists and contains implementation files.
- [ ] Agent can write a piece of "Project Memory" and retrieve it after a process restart.
- [ ] Agent can maintain a separate "Session Memory" that is cleared or archived upon run completion.
- [ ] A `context_provider` function exists that can return a summary of current memory for prompt augmentation.

## 🚩 Definition of Done
The system is considered **Implemented** when a test script can successfully:
1. Store a project goal (e.g., "Build a React App").
2. Store a session variable (e.g., "Current File: index.js").
3. Retrieve both and format them into a "Context Block" for an LLM.