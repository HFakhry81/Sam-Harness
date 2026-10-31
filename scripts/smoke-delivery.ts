/**
 * Smoke Delivery OS: parse backlog → board → transitions → Go/No-Go.
 */
import "../src/lib/loadEnv.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
import {
  __setPackWriteRootForTests,
  packArtifactExists,
  packArtifactPath,
  writePackArtifact,
} from "../src/lib/packWorkspace.js";

console.log("smoke-delivery");

const smokePack = fs.mkdtempSync(path.join(os.tmpdir(), "sam-smoke-delivery-"));
__setPackWriteRootForTests(smokePack);
process.env.SAM_OUTPUT_HOME = smokePack;

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
if (
  !packArtifactExists("delivery-board.json") ||
  !packArtifactExists("DELIVERY_BOARD.md")
) {
  throw new Error(
    `board files missing under pack workspace (${packArtifactPath("delivery-board.json")})`
  );
}
console.log("  ✓ board saved (pack workspace)");

writePackArtifact("IMPLEMENTATION_BACKLOG.md", sample, { bom: true });
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

__setPackWriteRootForTests(null);
try {
  fs.rmSync(smokePack, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log("PASS");
