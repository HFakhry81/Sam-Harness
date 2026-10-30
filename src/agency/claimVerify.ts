/**
 * Verify that cited paths in strategy/audit reports exist on disk.
 * Reject claims that invent packages/*, apps/web, etc.
 */
import * as fs from "fs";
import * as path from "path";

export type PathCitation = {
  raw: string;
  resolved: string;
  exists: boolean;
};

export type ClaimVerifyResult = {
  citations: PathCitation[];
  missing: PathCitation[];
  ok: boolean;
  reason: string;
};

const PATH_IN_BACKTICKS = /`([^`]+)`/g;
const PATHISH =
  /(?:^|[\s(])((?:packages|apps|src|docs|lib|scripts|config)\/[A-Za-z0-9_./\-]+)/g;

export function extractCitedPaths(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const bt = new RegExp(PATH_IN_BACKTICKS.source, "g");
  while ((m = bt.exec(text))) {
    const p = m[1].trim();
    if (/[\\/]/.test(p) || /\.(ts|tsx|js|jsx|md|json|yaml|yml|sql)$/i.test(p)) {
      out.add(p.replace(/\\/g, "/"));
    }
  }
  const ph = new RegExp(PATHISH.source, "g");
  while ((m = ph.exec(text))) {
    out.add(m[1].replace(/\\/g, "/"));
  }
  return [...out].slice(0, 80);
}

export function verifyCitationsAgainstRepo(
  text: string,
  targetRepo: string
): ClaimVerifyResult {
  const root = path.normalize(targetRepo);
  const citations: PathCitation[] = [];
  for (const raw of extractCitedPaths(text)) {
    // Skip URLs and pure package names
    if (/^https?:/i.test(raw)) continue;
    if (!/[\\/]/.test(raw) && !/\.\w+$/.test(raw)) continue;
    const resolved = path.isAbsolute(raw)
      ? path.normalize(raw)
      : path.normalize(path.join(root, raw));
    let exists = false;
    try {
      exists = fs.existsSync(resolved);
    } catch {
      exists = false;
    }
    citations.push({ raw, resolved, exists });
  }
  const missing = citations.filter((c) => !c.exists);
  return {
    citations,
    missing,
    ok: missing.length === 0,
    reason: missing.length
      ? `missing cited paths: ${missing
          .slice(0, 8)
          .map((m) => m.raw)
          .join(", ")}`
      : "all cited paths exist",
  };
}
