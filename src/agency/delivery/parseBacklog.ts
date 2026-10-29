import { defaultDod } from "./store.js";
import type { DeliveryTicket, TicketPriority } from "./types.js";

/**
 * Best-effort parse of IMPLEMENTATION_BACKLOG.md into tickets.
 * Supports headings like ### [M-1009] Title or ### Ticket 1: Title
 */
export function parseBacklogMarkdown(md: string): DeliveryTicket[] {
  if (!md.trim()) return [];
  const now = new Date().toISOString();
  const tickets: DeliveryTicket[] = [];
  const chunks = md.split(/^###\s+/m).slice(1);

  let auto = 0;
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    const header = (lines[0] || "").trim();
    if (!header || /priority 0|priority 1|critical path|objective/i.test(header)) {
      // skip section banners without ticket ids when too generic
      if (!/\[[A-Z]?-?\d+\]|Ticket\s*\d+/i.test(header) && header.length < 8) continue;
    }

    let id = "";
    let title = header;
    const bracket = header.match(/\[([A-Za-z0-9_-]+)\]\s*(.*)$/);
    if (bracket) {
      id = bracket[1];
      title = (bracket[2] || header).trim() || header;
    } else {
      const ticketNum = header.match(/^Ticket\s*(\d+)\s*[:\-–]?\s*(.*)$/i);
      if (ticketNum) {
        id = `T-${ticketNum[1]}`;
        title = (ticketNum[2] || header).trim();
      } else {
        auto += 1;
        id = `AUTO-${auto}`;
        title = header.slice(0, 120);
      }
    }

    const body = lines.slice(1).join("\n");
    const priority: TicketPriority = /P0|Priority\s*0|Critical|blocker/i.test(chunk)
      ? "P0"
      : /P1|Priority\s*1/i.test(chunk)
        ? "P1"
        : /P2|Priority\s*2/i.test(chunk)
          ? "P2"
          : "P1";

    const filesLikely = [
      ...body.matchAll(/`([^`]+\.[a-zA-Z0-9]+)`/g),
    ]
      .map((m) => m[1])
      .filter((p) => /[/\\.]/.test(p))
      .slice(0, 12);

    const acceptance = body
      .split(/\r?\n/)
      .filter((l) => /^\s*[-*]\s*\[[ x]\]/i.test(l) || /^\s*[-*]\s+Acceptance/i.test(l))
      .map((l) => l.replace(/^\s*[-*]\s*(\[[ x]\]\s*)?/i, "").trim())
      .filter(Boolean)
      .slice(0, 10);

    const whyMatch = body.match(/\*\*Why:\*\*\s*(.+)/i) || body.match(/Goal:\s*(.+)/i);
    const why = whyMatch?.[1]?.trim() || title;

    tickets.push({
      id,
      title,
      priority,
      status: priority === "P0" ? "ready" : "backlog",
      why,
      filesLikely: [...new Set(filesLikely)],
      acceptance,
      dod: defaultDod(),
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  // Dedup by id
  const map = new Map<string, DeliveryTicket>();
  for (const t of tickets) {
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return [...map.values()];
}
