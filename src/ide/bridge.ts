/**
 * Phase 2 — editor-agnostic IDE bridge.
 *
 * The harness never imports an editor API. It queues commands; any editor
 * extension (VS Code, Cursor, JetBrains, a CLI shim) polls them over the Control
 * Plane and reports results. That keeps "IDE controller" portable across OSes.
 *
 * Safety:
 *  - every path goes through `assertAllowedPath` (allowlist + deny list + realpath)
 *  - `applyDiff` additionally requires an approved `ide_write` approval and the
 *    owner opt-in `SAM_IDE_ALLOW_WRITE=1`
 *  - the harness repository stays immutable (write policy)
 */
import { randomUUID } from "crypto";
import * as path from "path";
import { assertAllowedPath } from "../lib/paths.js";
import { assertWriteAllowed } from "../lib/writePolicy.js";
import { requireIdeWriteApproval } from "../lib/trust/approvals.js";

export type IdeCommandKind =
  | "openFile"
  | "applyDiff"
  | "diagnostics"
  | "showMessage";

export type IdeCommandStatus = "pending" | "done" | "error";

export type IdeCommand = {
  id: string;
  kind: IdeCommandKind;
  params: Record<string, unknown>;
  createdAt: string;
  status: IdeCommandStatus;
  result?: unknown;
  error?: string;
  completedAt?: string;
};

type Entry = IdeCommand & { resolve?: (r: { ok: boolean; result?: unknown; error?: string }) => void };

const COMMAND_TTL_MS = 5 * 60_000;
const MAX_QUEUE = 200;
/** An editor counts as connected if it polled within this window. */
export const IDE_HEARTBEAT_MS = 15_000;

const queue = new Map<string, Entry>();
let lastPollAt = 0;

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of queue) {
    if (now - Date.parse(entry.createdAt) > COMMAND_TTL_MS) queue.delete(id);
  }
  while (queue.size > MAX_QUEUE) {
    const oldest = queue.keys().next().value;
    if (!oldest) break;
    queue.delete(oldest);
  }
}

function toPublic(entry: Entry): IdeCommand {
  return {
    id: entry.id,
    kind: entry.kind,
    params: entry.params,
    createdAt: entry.createdAt,
    status: entry.status,
    result: entry.result,
    error: entry.error,
    completedAt: entry.completedAt,
  };
}

export function isIdeConnected(now = Date.now()): boolean {
  return now - lastPollAt <= IDE_HEARTBEAT_MS;
}

export function enqueueIdeCommand(
  kind: IdeCommandKind,
  params: Record<string, unknown>
): IdeCommand {
  prune();
  const id = randomUUID();
  const entry: Entry = {
    id,
    kind,
    params,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  queue.set(id, entry);
  return toPublic(entry);
}

/** Called by an editor: returns every pending command (idempotent by id). */
export function pollIdeCommands(): IdeCommand[] {
  prune();
  lastPollAt = Date.now();
  return [...queue.values()].filter((e) => e.status === "pending").map(toPublic);
}

export function pendingIdeCommandCount(): number {
  prune();
  return [...queue.values()].filter((e) => e.status === "pending").length;
}

export function completeIdeCommand(
  id: string,
  result: { ok: boolean; result?: unknown; error?: string }
): boolean {
  const entry = queue.get(id);
  if (!entry) return false;
  entry.status = result.ok ? "done" : "error";
  entry.result = result.result;
  entry.error = result.error;
  entry.completedAt = new Date().toISOString();
  entry.resolve?.({ ok: result.ok, result: result.result, error: result.error });
  entry.resolve = undefined;
  return true;
}

export function waitForIdeCommand(
  id: string,
  timeoutMs: number
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const entry = queue.get(id);
  if (!entry) return Promise.resolve({ ok: false, error: "unknown command" });
  if (entry.status === "done") return Promise.resolve({ ok: true, result: entry.result });
  if (entry.status === "error") return Promise.resolve({ ok: false, error: entry.error });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      entry.resolve = undefined;
      resolve({
        ok: false,
        error: isIdeConnected()
          ? `editor did not answer within ${timeoutMs}ms`
          : "no IDE connected (install/run the Sam-Harness editor bridge)",
      });
    }, Math.max(500, timeoutMs));
    entry.resolve = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
  });
}

/** Test helper. */
export function __resetIdeBridgeForTests(): void {
  queue.clear();
  lastPollAt = 0;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function runCommand(
  kind: IdeCommandKind,
  params: Record<string, unknown>,
  timeoutMs: number
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const cmd = enqueueIdeCommand(kind, params);
  return waitForIdeCommand(cmd.id, timeoutMs);
}

export type IdeOpResult = { ok: boolean; result?: unknown; error?: string };

export async function ideOpenFile(
  filePath: string,
  opts: { line?: number; column?: number; timeoutMs?: number } = {}
): Promise<IdeOpResult> {
  const abs = path.normalize(filePath);
  try {
    assertAllowedPath(abs);
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
  return runCommand(
    "openFile",
    { path: abs, line: opts.line, column: opts.column },
    opts.timeoutMs ?? 20_000
  );
}

/**
 * Apply a unified-diff style edit inside the editor (never a blind write).
 * Requires an approved `ide_write` record and `SAM_IDE_ALLOW_WRITE=1`.
 */
export async function ideApplyDiff(
  filePath: string,
  diff: string,
  opts: { approvalId?: string; timeoutMs?: number; runId?: string } = {}
): Promise<IdeOpResult> {
  const abs = path.normalize(filePath);
  try {
    assertAllowedPath(abs);
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
  if (!String(diff || "").trim()) return { ok: false, error: "empty diff" };

  const gate = assertWriteAllowed(abs, "write");
  if (!gate.ok) {
    // Repo immutability is absolute.
    if (/Sam-Harness repository/i.test(gate.reason)) return { ok: false, error: gate.reason };
    const approval = requireIdeWriteApproval({
      path: abs,
      approvalId: opts.approvalId,
      runId: opts.runId,
    });
    if (!approval.ok) {
      return {
        ok: false,
        error:
          approval.message ||
          `Approval required for IDE edit. Approve approvalId=${approval.approvalId || "?"} then retry.`,
      };
    }
    if (String(process.env.SAM_IDE_ALLOW_WRITE || "").trim() !== "1") {
      return {
        ok: false,
        error: "Set SAM_IDE_ALLOW_WRITE=1 to let approved IDE edits touch prompt sources.",
      };
    }
  }

  return runCommand(
    "applyDiff",
    { path: abs, diff },
    opts.timeoutMs ?? 30_000
  );
}

export async function ideDiagnostics(
  filePath: string,
  opts: { timeoutMs?: number } = {}
): Promise<IdeOpResult> {
  const abs = path.normalize(filePath);
  try {
    assertAllowedPath(abs);
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
  return runCommand("diagnostics", { path: abs }, opts.timeoutMs ?? 15_000);
}

export async function ideShowMessage(
  message: string,
  level: "info" | "warn" | "error" = "info",
  opts: { timeoutMs?: number } = {}
): Promise<IdeOpResult> {
  if (!String(message || "").trim()) return { ok: false, error: "empty message" };
  return runCommand("showMessage", { message: message.slice(0, 2000), level }, opts.timeoutMs ?? 10_000);
}
