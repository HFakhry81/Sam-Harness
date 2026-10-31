import * as fs from "fs";
import * as path from "path";
import { ok, sys } from "../../lib/colors.js";
import { parseBacklogMarkdown } from "./parseBacklog.js";
import { defaultDod, loadBoard, saveBoard } from "./store.js";
import type { DeliveryBoard } from "./types.js";
import { packArtifactExists, readPackArtifact } from "../../lib/packWorkspace.js";

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
  // Omit cwd → saveBoard writes under SAM_OUTPUT_HOME pack workspace
  const cwd = opts.cwd;
  let md = "";
  if (opts.backlogPath && fs.existsSync(opts.backlogPath)) {
    md = fs.readFileSync(opts.backlogPath, "utf-8");
  } else if (packArtifactExists("IMPLEMENTATION_BACKLOG.md")) {
    md = readPackArtifact("IMPLEMENTATION_BACKLOG.md") || "";
  } else {
    const legacy = path.join(process.cwd(), "IMPLEMENTATION_BACKLOG.md");
    if (fs.existsSync(legacy)) md = fs.readFileSync(legacy, "utf-8");
  }
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
  sys(
    `Delivery board: ${board.tickets.length} tickets → pack workspace (delivery-board.json + DELIVERY_BOARD.md)`
  );
  ok(
    "Delivery OS",
    `P0 ready=${board.tickets.filter((t) => t.priority === "P0" && t.status === "ready").length}`
  );
  return board;
}
