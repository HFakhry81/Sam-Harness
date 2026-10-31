/**
 * Write permission policy: prompt-extracted source paths are READ-ONLY.
 * Writes allowed only under output home and designated pack folders.
 * Enforced in the tool layer (not via prompt).
 */
import * as fs from "fs";
import * as path from "path";
import { getOutputHome } from "./outputHome.js";
import { resolveUserPath } from "./paths.js";

export type WritePolicyState = {
  sourceRoots: string[];
  writeRoots: string[];
  packDir?: string;
  /** When true, run_shell is disabled (analysis / grounded-audit routes). */
  disableShell: boolean;
  /**
   * Analysis/audit: writes ONLY under writeRoots.
   * Operational: only sourceRoots are blocked; other writes use path allowlist.
   */
  strictWriteRoots: boolean;
};

const state: WritePolicyState = {
  sourceRoots: [],
  writeRoots: [],
  disableShell: false,
  strictWriteRoots: false,
};

function norm(p: string): string {
  return path.normalize(p).replace(/[/\\]+$/, "").toLowerCase();
}

function under(candidate: string, root: string): boolean {
  const c = norm(candidate);
  const r = norm(root);
  if (!r) return false;
  return c === r || c.startsWith(r + path.sep) || c.startsWith(r + "/") || c.startsWith(r + "\\");
}

/** Reset policy (tests). */
export function resetWritePolicy(): void {
  state.sourceRoots = [];
  state.writeRoots = [];
  state.packDir = undefined;
  state.disableShell = false;
  state.strictWriteRoots = false;
}

export function getWritePolicy(): WritePolicyState {
  return {
    sourceRoots: [...state.sourceRoots],
    writeRoots: [...state.writeRoots],
    packDir: state.packDir,
    disableShell: state.disableShell,
    strictWriteRoots: state.strictWriteRoots,
  };
}

export function setDisableShell(disabled: boolean): void {
  state.disableShell = Boolean(disabled);
}

/** Enable analysis-mode write confinement (output home / pack only). */
export function setStrictWriteRoots(strict: boolean): void {
  state.strictWriteRoots = Boolean(strict);
}

export function isShellDisabled(): boolean {
  return (
    state.disableShell ||
    String(process.env.SAM_DISABLE_SHELL || "").trim() === "1"
  );
}

/** Register prompt-extracted project + spec dirs as read-only sources. */
export function registerSourceRoots(paths: string[]): void {
  for (const raw of paths) {
    if (!raw || !String(raw).trim()) continue;
    let abs: string;
    try {
      abs = path.isAbsolute(raw) ? path.normalize(raw) : resolveUserPath(raw);
    } catch {
      abs = path.normalize(raw);
    }
    const key = norm(abs);
    if (!state.sourceRoots.some((s) => norm(s) === key)) {
      state.sourceRoots.push(abs);
    }
  }
}

/** Register writable roots (output home + pack). Always includes SAM_OUTPUT_HOME. */
export function registerWriteRoots(paths: string[] = [], packDir?: string): void {
  const home = getOutputHome();
  const list = [home, ...paths];
  if (packDir) {
    state.packDir = path.normalize(packDir);
    list.push(packDir);
  }
  for (const raw of list) {
    if (!raw) continue;
    const abs = path.normalize(raw);
    const key = norm(abs);
    if (!state.writeRoots.some((w) => norm(w) === key)) {
      state.writeRoots.push(abs);
    }
  }
}

/** Ensure defaults so policy is usable even before runner registers roots. */
export function ensureWritePolicyDefaults(): void {
  if (!state.writeRoots.length) {
    registerWriteRoots([]);
  }
}

export function isSourcePath(absPath: string): boolean {
  const abs = path.normalize(absPath);
  return state.sourceRoots.some((root) => under(abs, root));
}

export function isWritablePath(absPath: string): boolean {
  ensureWritePolicyDefaults();
  const abs = path.normalize(absPath);
  // Never writable if under a registered source root (even if nested under Documents)
  if (isSourcePath(abs)) return false;
  if (!state.strictWriteRoots) {
    // Operational: source block only; broader allowlist handled by assertAllowedPath
    return true;
  }
  return state.writeRoots.some((root) => under(abs, root));
}

export type WriteGateResult = {
  ok: boolean;
  reason: string;
};

/**
 * Gate writes / deletes / moves (destination) / mkdir.
 * Reversible reads are not gated here.
 */
export function assertWriteAllowed(
  absPath: string,
  action: "write" | "delete" | "move" | "mkdir" | "copy" = "write"
): WriteGateResult {
  ensureWritePolicyDefaults();
  const abs = path.normalize(absPath);

  if (isSourcePath(abs)) {
    return {
      ok: false,
      reason: `Denied ${action}: path is a READ-ONLY source from the user prompt (${abs}). Write only under output home (${getOutputHome()}) or the pack folder.`,
    };
  }

  if (state.strictWriteRoots && !state.writeRoots.some((root) => under(abs, root))) {
    return {
      ok: false,
      reason: `Denied ${action}: path outside allowed write roots (${abs}). Allowed: ${state.writeRoots.join(" | ") || getOutputHome()}`,
    };
  }

  return { ok: true, reason: "ok" };
}

/** Apply write gate or throw (for sync callers that prefer exceptions). */
export function requireWriteAllowed(
  absPath: string,
  action: "write" | "delete" | "move" | "mkdir" | "copy" = "write"
): void {
  const g = assertWriteAllowed(absPath, action);
  if (!g.ok) throw new Error(g.reason);
}

/** Helper: resolve + gate a user-facing path param. */
export function gateWritePath(
  rawPath: string,
  action: "write" | "delete" | "move" | "mkdir" | "copy" = "write"
): { abs: string; gate: WriteGateResult } {
  const abs = resolveUserPath(rawPath);
  return { abs, gate: assertWriteAllowed(abs, action) };
}

/** Persist policy snapshot for debugging (optional). */
export function writePolicySnapshot(filePath: string): void {
  ensureWritePolicyDefaults();
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        ...getWritePolicy(),
      },
      null,
      2
    ),
    "utf-8"
  );
}
