/**
 * Smoke Delivery OS: parse backlog → board → transitions → Go/No-Go.
 */
import "../src/lib/loadEnv.js";
import * as fs from "fs";
import { parseBacklogMarkdown } from "../src/agency/delivery/parseBacklog.js";
import {
  assertTransition,
  defaultDod,
  saveBoard,
  transitionTicket,
} from "../src/agency/delivery/store.js";
import { resolveImplementAuthorization } from "../src/agency/delivery/goNoGo.js";
import { syncDeliveryBoardFromBacklog } from "../src/agency/delivery/sync.js";
import type { DeliveryBoard } from "../src/agency/delivery/types.js";

console.log("smoke-delivery");

const sample = `# Backlog
### [M-1009] Multi-Tenant Isolation
**Why:** Isolate tenants
- [ ] Add tenant_id
- [ ] Middleware
### [M-1010] BookingType Triad
Priority P0
- [ ] occupancy_mode
`;

const tickets = parseBacklogMarkdown(sample);
if (tickets.length < 2) throw new Error("parse expected >=2 tickets");
console.log("  ✓ parsed", tickets.map((t) => t.id).join(", "));

assertTransition("backlog", "ready");
assertTransition("ready", "in_progress");
let threw = false;
try {
  assertTransition("done", "backlog");
} catch {
  threw = true;
}
if (!threw) throw new Error("done→backlog should fail");
console.log("  ✓ transitions");

const board: DeliveryBoard = {
  version: 1,
  engagementId: "eng-smoke",
  targetRepo: "E:\\UpNexa.com\\maw3ed",
  updatedAt: new Date().toISOString(),
  goNoGo: {
    decision: "PENDING",
    by: "smoke",
    at: new Date().toISOString(),
    reason: "test",
  },
  tickets: tickets.map((t) => ({ ...t, dod: defaultDod() })),
};
transitionTicket(board, "M-1009", "ready");
transitionTicket(board, "M-1009", "in_progress");
saveBoard(board);
if (!fs.existsSync("delivery-board.json") || !fs.existsSync("DELIVERY_BOARD.md")) {
  throw new Error("board files missing");
}
console.log("  ✓ board saved");

fs.writeFileSync("IMPLEMENTATION_BACKLOG.md", sample, "utf-8");
syncDeliveryBoardFromBacklog({
  engagementId: "eng-smoke",
  targetRepo: "E:\\UpNexa.com\\maw3ed",
});
console.log("  ✓ sync from backlog");

// Explicit NO_GO wins even if a prior go-nogo.json said GO
const denied = resolveImplementAuthorization(["--no-go"]);
if (denied.allowed) throw new Error("should deny with --no-go");
console.log("  ✓ Go/No-Go denies with --no-go");

const pending = resolveImplementAuthorization([]);
if (pending.allowed) throw new Error("should deny without GO after NO_GO");
console.log("  ✓ Go/No-Go denies by default / PENDING");

const allowed = resolveImplementAuthorization(["--go"]);
if (!allowed.allowed) throw new Error("should allow with --go");
console.log("  ✓ Go/No-Go allows --go");

console.log("PASS");
