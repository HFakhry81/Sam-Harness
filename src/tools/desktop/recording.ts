/**
 * Record every desktop action to the run timeline + screenshots under the run folder.
 */
import * as fs from "fs";
import * as path from "path";
import { appendTimeline } from "../../lib/durableRuns.js";
import {
  agentArtifactPath,
  beginOutputRun,
  ensureOutputHome,
  getActiveRunDir,
} from "../../lib/outputHome.js";
import type { DesktopActionName, DesktopActionResult, ScreenshotResult } from "./types.js";

export function ensureDesktopRunDir(runId?: string): string {
  const existing = getActiveRunDir();
  if (existing) {
    const shots = path.join(existing, "desktop");
    fs.mkdirSync(shots, { recursive: true });
    return shots;
  }
  if (runId) {
    beginOutputRun(runId);
    const shots = path.join(getActiveRunDir()!, "desktop");
    fs.mkdirSync(shots, { recursive: true });
    return shots;
  }
  const layout = ensureOutputHome();
  const shots = path.join(layout.temp, "desktop");
  fs.mkdirSync(shots, { recursive: true });
  return shots;
}

export function desktopScreenshotPath(
  label: string,
  runId?: string,
  ext = "png"
): string {
  const dir = ensureDesktopRunDir(runId);
  const safe = label.replace(/[<>:"/\\|?*\s]+/g, "-").slice(0, 80) || "shot";
  const stamp = Date.now().toString(36);
  return path.join(dir, `${stamp}-${safe}.${ext}`);
}

export function recordDesktopTimeline(input: {
  runId?: string;
  action: DesktopActionName;
  status: "ok" | "error" | "info" | "start" | "end";
  result?: DesktopActionResult;
  detail?: Record<string, unknown>;
  durationMs?: number;
}): string | undefined {
  const runId = input.runId || process.env.SAM_DURABLE_RUN_ID || "";
  if (!runId) return undefined;
  try {
    const ev = appendTimeline(runId, {
      kind: "desktop",
      name: input.action,
      status: input.status,
      durationMs: input.durationMs,
      detail: {
        ...(input.detail || {}),
        ok: input.result?.ok,
        message: input.result?.message,
        risk: input.result?.risk,
        dryRun: input.result?.dryRun,
        verification: input.result?.verification,
        recording: input.result?.recording,
        approvalId: input.result?.approvalId,
      },
    });
    return ev.id;
  } catch {
    return undefined;
  }
}

export function persistScreenshotMeta(
  shot: ScreenshotResult,
  label: string
): { path: string; bytes: number } {
  // Copy into run artifacts when path is outside active run
  const runDir = getActiveRunDir();
  if (!runDir || shot.path.startsWith(runDir)) {
    return { path: shot.path, bytes: shot.bytes };
  }
  try {
    const dest = agentArtifactPath("desktop", path.basename(shot.path) || `${label}.png`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(shot.path)) {
      fs.copyFileSync(shot.path, dest);
      return { path: dest, bytes: fs.statSync(dest).size };
    }
  } catch {
    /* keep original */
  }
  return { path: shot.path, bytes: shot.bytes };
}
