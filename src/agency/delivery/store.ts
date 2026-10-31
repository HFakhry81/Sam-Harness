import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_DOD,
  TICKET_TRANSITIONS,
  type DeliveryBoard,
  type DeliveryTicket,
  type GoNoGoRecord,
  type TicketStatus,
} from "./types.js";
import { loadStoreDoc, saveStoreDoc } from "../../lib/db/storeBridge.js";
import {
  getPackWriteRoot,
  packArtifactPath,
  writePackArtifact,
} from "../../lib/packWorkspace.js";

const BOARD_JSON = "delivery-board.json";
const BOARD_MD = "DELIVERY_BOARD.md";
const GONOGO_JSON = "go-nogo.json";

/** Pack workspace when cwd is omitted or equals process.cwd(); else explicit dir. */
function resolveDeliveryDir(cwd?: string): string {
  if (cwd && path.normalize(cwd) !== path.normalize(process.cwd())) {
    fs.mkdirSync(cwd, { recursive: true });
    return cwd;
  }
  return getPackWriteRoot();
}

function deliveryFile(name: string, cwd?: string): string {
  if (cwd && path.normalize(cwd) !== path.normalize(process.cwd())) {
    return path.join(cwd, name);
  }
  return packArtifactPath(name);
}

export function defaultDod(): DeliveryTicket["dod"] {
  return DEFAULT_DOD.map((d) => ({ ...d, done: false }));
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (from === to) return;
  const allowed = TICKET_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal ticket transition: ${from} → ${to}`);
  }
}

export function loadBoard(cwd?: string): DeliveryBoard | null {
  const dir = resolveDeliveryDir(cwd);
  const board = loadStoreDoc<DeliveryBoard | Record<string, never>>(
    dir,
    "delivery-board",
    BOARD_JSON,
    {}
  );
  if (board && "version" in board && Array.isArray((board as DeliveryBoard).tickets)) {
    return board as DeliveryBoard;
  }
  return null;
}

export function saveBoard(board: DeliveryBoard, cwd?: string): void {
  board.updatedAt = new Date().toISOString();
  const dir = resolveDeliveryDir(cwd);
  saveStoreDoc(dir, "delivery-board", board);
  // Write under SAM_OUTPUT_HOME pack workspace (never Sam-Harness repo cwd)
  try {
    if (cwd && path.normalize(cwd) !== path.normalize(process.cwd())) {
      fs.writeFileSync(
        path.join(cwd, BOARD_JSON),
        JSON.stringify(board, null, 2),
        "utf-8"
      );
      fs.writeFileSync(path.join(cwd, BOARD_MD), renderBoardMarkdown(board), "utf-8");
    } else {
      writePackArtifact(BOARD_JSON, JSON.stringify(board, null, 2));
      writePackArtifact(BOARD_MD, renderBoardMarkdown(board), { bom: true });
    }
  } catch {
    /* mirror best-effort */
  }
}

export function renderBoardMarkdown(board: DeliveryBoard): string {
  const byStatus = (s: TicketStatus) => board.tickets.filter((t) => t.status === s);
  const lines = [
    `# Delivery Board`,
    ``,
    `- Engagement: \`${board.engagementId}\``,
    `- Target: \`${board.targetRepo}\``,
    `- Updated: ${board.updatedAt}`,
    `- **Go/No-Go:** \`${board.goNoGo.decision}\` — ${board.goNoGo.reason || "(none)"}`,
    ``,
    `## Definition of Done (per ticket)`,
    ...DEFAULT_DOD.map((d) => `- ${d.label}`),
    ``,
  ];
  for (const status of [
    "in_progress",
    "ready",
    "review",
    "blocked",
    "backlog",
    "done",
    "cancelled",
  ] as TicketStatus[]) {
    const rows = byStatus(status);
    if (!rows.length) continue;
    lines.push(`## ${status} (${rows.length})`);
    for (const t of rows) {
      const dodDone = t.dod.filter((d) => d.done).length;
      lines.push(
        `- **${t.id}** [${t.priority}] ${t.title} — DoD ${dodDone}/${t.dod.length}`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function transitionTicket(
  board: DeliveryBoard,
  ticketId: string,
  to: TicketStatus,
  opts?: { blockedReason?: string }
): DeliveryBoard {
  const t = board.tickets.find((x) => x.id === ticketId);
  if (!t) throw new Error(`Ticket not found: ${ticketId}`);
  assertTransition(t.status, to);
  t.status = to;
  t.updatedAt = new Date().toISOString();
  if (to === "blocked") t.blockedReason = opts?.blockedReason || "blocked";
  if (to !== "blocked") delete t.blockedReason;
  if (to === "done") {
    t.dod = t.dod.map((d) => ({ ...d, done: true }));
  }
  return board;
}

export function setGoNoGo(board: DeliveryBoard, record: GoNoGoRecord): DeliveryBoard {
  board.goNoGo = record;
  return board;
}

export function readGoNoGoFile(cwd?: string): GoNoGoRecord | null {
  // Prefer pack workspace; also accept owner-placed go-nogo.json in cwd
  const candidates = [
    deliveryFile(GONOGO_JSON, cwd),
    path.join(process.cwd(), GONOGO_JSON),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as GoNoGoRecord;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function writeGoNoGoFile(record: GoNoGoRecord, cwd?: string): void {
  const body = JSON.stringify(record, null, 2);
  if (cwd && path.normalize(cwd) !== path.normalize(process.cwd())) {
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, GONOGO_JSON), body, "utf-8");
  } else {
    writePackArtifact(GONOGO_JSON, body);
  }
}

export { BOARD_JSON, BOARD_MD, GONOGO_JSON };
