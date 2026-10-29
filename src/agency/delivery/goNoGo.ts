import * as fs from "fs";
import * as path from "path";
import { ok, warn } from "../../lib/colors.js";
import {
  loadBoard,
  readGoNoGoFile,
  saveBoard,
  setGoNoGo,
  writeGoNoGoFile,
} from "./store.js";
import type { GoNoGoRecord } from "./types.js";

export type ImplementAuthResult = {
  allowed: boolean;
  reason: string;
  record: GoNoGoRecord;
};

/**
 * Human Go/No-Go gate before any Level-3 code implementation.
 *
 * Authorize with ANY of:
 * - CLI: --go
 * - Env: IMPLEMENT_GO=1
 * - File: go-nogo.json { "decision": "GO", "by": "...", "reason": "..." }
 */
export function resolveImplementAuthorization(argv: string[]): ImplementAuthResult {
  const at = new Date().toISOString();
  const fileRec = readGoNoGoFile();
  const envGo = process.env.IMPLEMENT_GO === "1" || process.env.IMPLEMENT_GO === "true";
  const flagGo = argv.includes("--go") || argv.includes("--approve-implement");
  const flagNo =
    argv.includes("--no-go") ||
    argv.includes("--deny-implement") ||
    process.env.IMPLEMENT_GO === "0";

  if (flagNo) {
    const record: GoNoGoRecord = {
      decision: "NO_GO",
      by: "cli/env",
      at,
      reason: "Explicit NO_GO from CLI/env",
    };
    writeGoNoGoFile(record);
    syncBoardGoNoGo(record);
    return { allowed: false, reason: record.reason, record };
  }

  if (flagGo || envGo) {
    const record: GoNoGoRecord = {
      decision: "GO",
      by: flagGo ? "cli,--go" : "env,IMPLEMENT_GO",
      at,
      reason: "Owner authorized implementation for this run",
      engagementId: readEngagementId(),
    };
    writeGoNoGoFile(record);
    syncBoardGoNoGo(record);
    ok("Go/No-Go", `GO authorized via ${record.by}`);
    return { allowed: true, reason: record.reason, record };
  }

  if (fileRec?.decision === "GO") {
    ok("Go/No-Go", `GO from go-nogo.json (by ${fileRec.by})`);
    syncBoardGoNoGo(fileRec);
    return { allowed: true, reason: fileRec.reason || "go-nogo.json", record: fileRec };
  }

  if (fileRec?.decision === "NO_GO") {
    warn("Go/No-Go", `NO_GO from go-nogo.json — ${fileRec.reason}`);
    syncBoardGoNoGo(fileRec);
    return { allowed: false, reason: fileRec.reason || "NO_GO file", record: fileRec };
  }

  const pending: GoNoGoRecord = {
    decision: "PENDING",
    by: "system",
    at,
    reason:
      "Implementation blocked until owner sets GO (--go | IMPLEMENT_GO=1 | go-nogo.json)",
    engagementId: readEngagementId(),
  };
  writeGoNoGoFile(pending);
  syncBoardGoNoGo(pending);
  return { allowed: false, reason: pending.reason, record: pending };
}

function readEngagementId(): string | undefined {
  try {
    if (!fs.existsSync("engagement.json")) return undefined;
    const j = JSON.parse(fs.readFileSync("engagement.json", "utf-8"));
    return j.id;
  } catch {
    return undefined;
  }
}

function syncBoardGoNoGo(record: GoNoGoRecord): void {
  const board = loadBoard();
  if (!board) return;
  setGoNoGo(board, record);
  saveBoard(board);
}

export function writeGoNoGoTemplate(cwd = process.cwd()): void {
  const p = path.join(cwd, "go-nogo.example.json");
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        decision: "GO",
        by: "owner",
        at: new Date().toISOString(),
        reason: "I authorize Level-3 code changes on the target repo for this pack",
      },
      null,
      2
    ),
    "utf-8"
  );
}
