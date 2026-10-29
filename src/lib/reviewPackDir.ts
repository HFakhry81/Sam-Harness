import * as fs from "fs";
import * as path from "path";

/**
 * Next review pack folder under a project's docs/metadata directory:
 *   "Sam-Harness no.1", "Sam-Harness no.2", ...
 */
export function resolveNextSamHarnessReviewDir(docsRoot: string): {
  dir: string;
  reviewNo: number;
} {
  const root = path.normalize(docsRoot);
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

export function defaultProjectDocsRoot(targetRepo: string): string {
  return path.join(resolveTargetRepoPath(targetRepo), "docs");
}
