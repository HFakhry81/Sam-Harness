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

const BOARD_JSON = "delivery-board.json";
const BOARD_MD = "DELIVERY_BOARD.md";
const GONOGO_JSON = "go-nogo.json";

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

export function loadBoard(cwd = process.cwd()): DeliveryBoard | null {
  const p = path.join(cwd, BOARD_JSON);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as DeliveryBoard;
}

export function saveBoard(board: DeliveryBoard, cwd = process.cwd()): void {
  board.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(cwd, BOARD_JSON), JSON.stringify(board, null, 2), "utf-8");
  fs.writeFileSync(path.join(cwd, BOARD_MD), renderBoardMarkdown(board), "utf-8");
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

export function readGoNoGoFile(cwd = process.cwd()): GoNoGoRecord | null {
  const p = path.join(cwd, GONOGO_JSON);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as GoNoGoRecord;
  } catch {
    return null;
  }
}

export function writeGoNoGoFile(record: GoNoGoRecord, cwd = process.cwd()): void {
  fs.writeFileSync(path.join(cwd, GONOGO_JSON), JSON.stringify(record, null, 2), "utf-8");
}

export { BOARD_JSON, BOARD_MD, GONOGO_JSON };
