To initiate the first P0, we need to transform the backlog item into a concrete technical specification. Since the **Project-Memory System** is the most fundamental (as the Ledger depends on knowing *what* project it is logging for), we will start there.

Below is the `TICKET_P0_MEMORY.md`.

***

# TICKET_P0_MEMORY.md

## 🟢 Status: OPEN
**Priority:** P0 (Critical Infrastructure)  
**Component:** `src/core/memory/`  
**Objective:** Establish a persistent state-management system to maintain project context across sessions.

---

## 1. Problem Statement
Currently, the system is stateless. Every time the harness is restarted or a new session begins, all project-specific variables, current goals, and historical context are lost. This prevents the system from performing multi-step reasoning or maintaining a "source of truth" for the project's current state.

## 2. Technical Requirements

### A. Storage Schema
The memory system must support three tiers of data:
1.  **Global Context:** System-wide settings and environment variables.
2.  **Project Context:** Project-specific goals, constraints, and metadata.
3.  **Session State:** Current cursor position, active task, and temporary flags.

### B. Functional Requirements
- [ ] **Persistence:** Data must be written to disk (JSON or SQLite) to survive process termination.
- [ ] **CRUD Interface:** Provide a standardized API for `get`, `set`, and `update` operations.
- [ ] **Namespace Isolation:** Ensure that memory for "Project A" cannot leak into "Project B".
- [ ] **Serialization:** Automatic handling of complex objects into storable formats.

## 3. Proposed Architecture

**Target Path:** `E:\UpNexa.com\Sam-Harness\src\core\memory\`

**Proposed File Structure:**
```text
src/core/memory/
├── MemoryManager.ts      # Main Entry point (Singleton)
├── IMemoryStore.ts      # Interface for storage providers
├── FileSystemStore.ts    # Implementation for JSON-based storage
└── types/
    └── MemoryTypes.ts     # Type definitions for Context/State
```

## 4. Definition of Done (DoD)
- [ ] `MemoryManager` can save a key-value pair to disk and retrieve it after a system restart.
- [ ] Project-specific namespaces are implemented (e.g., `memory.set('project_id', 'key', 'value')`).
- [ ] Unit tests verify that data persists across simulated session crashes.
- [ ] Documentation added to `IMPLEMENTATION_BACKLOG.md` marking this item as completed.

## 5. Implementation Steps
1. **Step 1:** Define `MemoryTypes.ts` to standardize what "Context" looks like.
2. **Step 2:** Implement `FileSystemStore.ts` for basic read/write operations to a `.json` file in a designated data folder.
3. **Step 3:** Create the `MemoryManager` singleton to wrap the store with business logic.
4. **Step 4:** Integrate the `MemoryManager` into the main application bootstrap sequence.

---

**Linked Backlog Item:** `[TBD] Project-Memory System`