# Delivery OS (P3)

## Purpose
Turn agency report packs into a **living delivery board** with ticket states, Definition of Done, and a **human Go/No-Go** gate before any client code changes.

## Artifacts
| File | Role |
| --- | --- |
| `delivery-board.json` | Machine state |
| `DELIVERY_BOARD.md` | Human-readable board |
| `go-nogo.json` | Current GO / NO_GO / PENDING |
| `go-nogo.example.json` | Template for owner approval |

## Ticket states
`backlog` → `ready` → `in_progress` → `review` → `done`  
Also: `blocked`, `cancelled` (see `TICKET_TRANSITIONS`).

## Authorize implementation
After reviewing the pack + `DELIVERY_BOARD.md`, owner chooses ONE:

```bash
pnpm start -- --yes --implement --go
```

or

```bash
set IMPLEMENT_GO=1
pnpm start -- --yes --implement-only
```

or copy `go-nogo.example.json` → `go-nogo.json` with `"decision": "GO"`.

Without GO, Level-3 is refused even if the audit gate passed.
