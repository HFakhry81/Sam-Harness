import * as fs from "fs";
import * as path from "path";
import { ok, sys } from "../../lib/colors.js";
import { parseBacklogMarkdown } from "./parseBacklog.js";
import { defaultDod, loadBoard, saveBoard } from "./store.js";
import type { DeliveryBoard } from "./types.js";

/**
 * Build/refresh delivery-board.json from IMPLEMENTATION_BACKLOG.md after agency pack.
 */
export function syncDeliveryBoardFromBacklog(opts: {
  engagementId: string;
  targetRepo: string;
  packDir?: string;
  backlogPath?: string;
  cwd?: string;
}): DeliveryBoard {
  const cwd = opts.cwd || process.cwd();
  const backlogPath = opts.backlogPath || path.join(cwd, "IMPLEMENTATION_BACKLOG.md");
  const md = fs.existsSync(backlogPath) ? fs.readFileSync(backlogPath, "utf-8") : "";
  const parsed = parseBacklogMarkdown(md);
  const existing = loadBoard(cwd);

  const tickets =
    parsed.length > 0
      ? parsed
      : existing?.tickets?.length
        ? existing.tickets
        : [
            {
              id: "BOOTSTRAP-1",
              title: "Refine backlog after next agency run",
              priority: "P1" as const,
              status: "backlog" as const,
              why: "No parseable tickets in IMPLEMENTATION_BACKLOG.md yet",
              filesLikely: [],
              acceptance: ["Produce IMPLEMENTATION_BACKLOG with ### [ID] tickets"],
              dod: defaultDod(),
              evidenceRefs: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];

  // Preserve status for known ids
  if (existing?.tickets?.length) {
    const prev = new Map(existing.tickets.map((t) => [t.id, t]));
    for (const t of tickets) {
      const old = prev.get(t.id);
      if (old) {
        t.status = old.status;
        t.dod = old.dod?.length ? old.dod : t.dod;
        t.blockedReason = old.blockedReason;
        t.createdAt = old.createdAt;
      }
    }
  }

  const board: DeliveryBoard = {
    version: 1,
    engagementId: opts.engagementId,
    targetRepo: opts.targetRepo,
    packDir: opts.packDir,
    updatedAt: new Date().toISOString(),
    goNoGo: existing?.goNoGo || {
      decision: "PENDING",
      by: "system",
      at: new Date().toISOString(),
      reason: "Awaiting owner GO before implementation",
      engagementId: opts.engagementId,
      packDir: opts.packDir,
    },
    tickets,
  };

  saveBoard(board, cwd);
  sys(`Delivery board: ${board.tickets.length} tickets → delivery-board.json + DELIVERY_BOARD.md`);
  ok(
    "Delivery OS",
    `P0 ready=${board.tickets.filter((t) => t.priority === "P0" && t.status === "ready").length}`
  );
  return board;
}
