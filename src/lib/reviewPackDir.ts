import * as fs from "fs";
import * as path from "path";
import {
  agentReportPath,
  ensureOutputHome,
  getOutputHome,
  isUnderOutputHome,
} from "./outputHome.js";

/**
 * True when cwd (or given root) is the Sam-Harness project itself.
 * Detects by folder name, package.json name, or SamHarness.bat — so CI
 * checkouts named `workspace` / `Sam-Harness` / clones all work.
 */
export function isSamHarnessWorkspace(root = process.cwd()): boolean {
  const abs = path.normalize(root);
  if (/sam-harness/i.test(path.basename(abs))) return true;
  if (fs.existsSync(path.join(abs, "SamHarness.bat"))) return true;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(abs, "package.json"), "utf-8")) as {
      name?: string;
    };
    if (/sam-harness/i.test(String(pkg.name || ""))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Next review pack folder under SAM_OUTPUT_HOME/reports:
 *   "Sam-Harness no.1", "Sam-Harness no.2", ...
 * Never creates packs inside a git repo or target project docs/.
 */
export function resolveNextSamHarnessReviewDir(docsRoot?: string): {
  dir: string;
  reviewNo: number;
} {
  // Ignore any legacy docsRoot that points inside a repo — packs are output-home only.
  const preferred = docsRoot ? path.normalize(docsRoot) : "";
  const root =
    preferred && isUnderOutputHome(preferred)
      ? preferred
      : (() => {
          ensureOutputHome();
          return agentReportPath();
        })();
  fs.mkdirSync(root, { recursive: true });

  let max = 0;
  for (const name of fs.readdirSync(root)) {
    const m = /^Sam-Harness no\.(\d+)$/i.exec(name.trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  const reviewNo = max + 1;
  const dir = path.join(root, `Sam-Harness no.${reviewNo}`);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, reviewNo };
}

/**
 * Resolve UI/targetRepo labels to an absolute repo root.
 * Bare "Sam-Harness" must not become cwd/Sam-Harness (nested junk packs).
 */
export function resolveTargetRepoPath(targetRepo: string): string {
  const raw = (targetRepo || "").trim();
  const cwd = process.cwd();
  if (!raw) return cwd;

  if (path.isAbsolute(raw)) {
    return path.normalize(raw);
  }

  // Exact workspace name → this repo
  if (
    /^sam-harness$/i.test(raw) ||
    path.basename(cwd).toLowerCase() === raw.toLowerCase()
  ) {
    return cwd;
  }

  const underCwd = path.resolve(cwd, raw);
  if (fs.existsSync(underCwd) && underCwd !== path.join(cwd, "Sam-Harness")) {
    // Allow real subfolders, but never the accidental nested Sam-Harness mirror
    return underCwd;
  }

  const sibling = path.join(path.dirname(cwd), raw);
  if (fs.existsSync(sibling)) return sibling;

  return underCwd;
}

/**
 * Pack / report root — ALWAYS SAM_OUTPUT_HOME/reports.
 * Target project repos are read-only for packs (no <repo>/docs fallback).
 */
export function defaultProjectDocsRoot(_targetRepo?: string): string {
  ensureOutputHome();
  return agentReportPath();
}

/** Assert a pack archive path never resolves inside the Sam-Harness repo. */
export function assertPackDirOutsideRepo(
  packDir: string,
  repoRoot: string = process.cwd()
): void {
  const pack = path.normalize(packDir);
  const root = path.normalize(repoRoot);
  const home = path.normalize(getOutputHome());
  if (!isUnderOutputHome(pack, home)) {
    throw new Error(`Pack path must be under SAM_OUTPUT_HOME, got: ${pack}`);
  }
  const rootLower = root.toLowerCase();
  const homeLower = home.toLowerCase();
  const homeInsideRepo =
    homeLower === rootLower || homeLower.startsWith(rootLower + path.sep);
  if (homeInsideRepo) {
    throw new Error(
      `SAM_OUTPUT_HOME must not be inside the Sam-Harness repo (got ${home} under ${root})`
    );
  }
  const packLower = pack.toLowerCase();
  if (packLower === rootLower || packLower.startsWith(rootLower + path.sep)) {
    throw new Error(
      `Pack path must not resolve inside the Sam-Harness repo: ${pack}`
    );
  }
}
