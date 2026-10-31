/**
 * Pack artifact workspace under SAM_OUTPUT_HOME — never the repo cwd.
 * Agency runs stage evidence/checklist/traceability/gates/verdict here, then
 * archive into numbered reports/ packs.
 */
import * as fs from "fs";
import * as path from "path";
import {
  beginOutputRun,
  ensureOutputHome,
  getActiveRunDir,
  getOutputHome,
} from "./outputHome.js";

/** Pack files that must never land in the Sam-Harness repo root. */
export const PACK_CWD_FORBIDDEN = [
  "AUDIT_CHECKLIST.md",
  "REQ_TRACEABILITY.md",
  "agency-verdict.md",
  "evidence.json",
  "gates.json",
] as const;

/** All staged pack artifact basenames (cwd is never the write target). */
export const PACK_ARTIFACT_NAMES = [
  ...PACK_CWD_FORBIDDEN,
  "engagement.json",
  "evidence-pack.md",
  "ceo-draft.md",
  "audit-report.md",
  "audit-history.md",
  "execution-plan.md",
  "help-system-spec.md",
  "marketing-campaign.md",
  "final-report.md",
  "execution-result.md",
  "CODE_VS_PLAN_GAP_MATRIX.md",
  "IMPLEMENTATION_BACKLOG.md",
  "NEXT_SPRINT.md",
  "TICKET_P0_STARTER.md",
  "delivery-board.json",
  "DELIVERY_BOARD.md",
  "go-nogo.json",
  "PACK_HANDOFF.md",
  "PACK_CLAIM_ASSERTION.md",
  "pack-location.md",
] as const;

let packRootOverride: string | null = null;

/**
 * Resolve the directory where pack artifacts are written for this run.
 * Prefers active SAM_RUN_DIR/artifacts, else begins a run under output home.
 */
export function getPackWriteRoot(runId?: string): string {
  if (packRootOverride) {
    fs.mkdirSync(packRootOverride, { recursive: true });
    return packRootOverride;
  }
  ensureOutputHome();
  let runDir = getActiveRunDir();
  if (!runDir) {
    const started = beginOutputRun(runId);
    runDir = started.runDir;
  }
  const artifacts = path.join(runDir, "artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  return artifacts;
}

/** Test-only: pin pack writes to a temp dir (still never process.cwd()). */
export function __setPackWriteRootForTests(dir: string | null): void {
  packRootOverride = dir ? path.normalize(dir) : null;
  if (packRootOverride) fs.mkdirSync(packRootOverride, { recursive: true });
}

export function packArtifactPath(name: string, runId?: string): string {
  const base = path.basename(name);
  return path.join(getPackWriteRoot(runId), base);
}

/**
 * Write a pack artifact under SAM_OUTPUT_HOME (UTF-8; optional BOM for markdown).
 * Never writes to process.cwd().
 */
export function writePackArtifact(
  name: string,
  content: string | Buffer,
  opts?: { bom?: boolean; runId?: string }
): string {
  const dest = packArtifactPath(name, opts?.runId);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(dest, content);
    return dest;
  }
  const text = String(content);
  const withBom =
    opts?.bom || /\.md$/i.test(name)
      ? text.charCodeAt(0) === 0xfeff
        ? text
        : `\uFEFF${text}`
      : text;
  fs.writeFileSync(dest, withBom, "utf-8");
  return dest;
}

export function readPackArtifact(
  name: string,
  runId?: string
): string | null {
  const p = packArtifactPath(name, runId);
  if (!fs.existsSync(p)) return null;
  try {
    let text = fs.readFileSync(p, "utf-8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  } catch {
    return null;
  }
}

export function packArtifactExists(name: string, runId?: string): boolean {
  return fs.existsSync(packArtifactPath(name, runId));
}

/** Copy staged pack artifacts into a numbered pack directory. */
export function copyPackArtifactsTo(
  destDir: string,
  names: readonly string[] = PACK_ARTIFACT_NAMES,
  runId?: string
): string[] {
  const root = getPackWriteRoot(runId);
  fs.mkdirSync(destDir, { recursive: true });
  const copied: string[] = [];
  for (const name of names) {
    const src = path.join(root, path.basename(name));
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(destDir, path.basename(name)));
    copied.push(path.basename(name));
  }
  return copied;
}

/** Assert none of the forbidden pack files exist in cwd (or given dir). */
export function assertNoPackFilesInCwd(
  cwd: string = process.cwd(),
  names: readonly string[] = PACK_CWD_FORBIDDEN
): { ok: boolean; found: string[] } {
  const found = names.filter((n) =>
    fs.existsSync(path.join(cwd, path.basename(n)))
  );
  return { ok: found.length === 0, found };
}

/** Output home used for pack staging (for diagnostics). */
export function packOutputHome(): string {
  return getOutputHome();
}
