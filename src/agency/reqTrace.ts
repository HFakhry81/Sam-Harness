/**
 * Requirements traceability: REQ -> implemented / partial / missing / contradicts
 * with real code paths. Drives the gap report.
 */
import * as fs from "fs";
import * as path from "path";
import type { SpecRequirement } from "./specIngest.js";
import type { RepoIndexResult } from "./repoIndex.js";

export type ReqStatus = "implemented" | "partial" | "missing" | "contradicts";

export type ReqTraceRow = {
  id: string;
  text: string;
  status: ReqStatus;
  codePaths: string[];
  evidenceNotes: string[];
  sourceFile: string;
  section: string;
};

export type ReqTraceMatrix = {
  rows: ReqTraceRow[];
  coverageRatio: number; // addressed (not missing) / total
  implementedCount: number;
  partialCount: number;
  missingCount: number;
  contradictsCount: number;
  markdown: string;
  json: object;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_./]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .slice(0, 12);
}

/**
 * Build a search_code-style pattern from a REQ (distinctive tokens OR'd).
 * Used before scoring so every REQ is actively searched in the tree.
 */
export function reqSearchPattern(reqText: string): string {
  const tokens = tokenize(reqText)
    .filter((t) => !/^(must|should|shall|with|from|that|this|have|been)$/i.test(t))
    .slice(0, 6);
  if (!tokens.length) return reqText.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

/** Search file bodies for a REQ pattern; returns relative paths that hit. */
export function searchCodeForReq(
  fileBodies: Map<string, string>,
  reqText: string
): { paths: string[]; hitCount: number } {
  const pattern = reqSearchPattern(reqText);
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return { paths: [], hitCount: 0 };
  }
  const paths: string[] = [];
  let hitCount = 0;
  for (const [rel, body] of fileBodies) {
    if (re.test(body)) {
      paths.push(rel);
      hitCount += 1;
    }
  }
  return { paths: paths.slice(0, 12), hitCount };
}

function scoreAgainstRepo(
  req: SpecRequirement,
  index: RepoIndexResult,
  fileBodies: Map<string, string>
): Omit<ReqTraceRow, "id" | "text" | "sourceFile" | "section"> {
  const tokens = tokenize(req.text);
  const codePaths: string[] = [];
  const evidenceNotes: string[] = [];
  let hits = 0;

  // Mandatory: search_code-style scan per REQ before scoring
  const searched = searchCodeForReq(fileBodies, req.text);
  for (const p of searched.paths) {
    codePaths.push(p);
    evidenceNotes.push(`search_code hit for REQ pattern`);
    hits += 2;
  }

  for (const h of index.hits) {
    const hay = `${h.path} ${h.note}`.toLowerCase();
    const tokHit = tokens.filter((t) => hay.includes(t)).length;
    if (tokHit >= 1) {
      codePaths.push(h.path);
      evidenceNotes.push(h.note);
      hits += tokHit;
    }
  }

  // Content search on a sample of source files (token overlap)
  for (const [rel, body] of fileBodies) {
    const lower = body.toLowerCase();
    const tokHit = tokens.filter((t) => lower.includes(t)).length;
    if (tokHit >= 2) {
      codePaths.push(rel);
      evidenceNotes.push("content token match");
      hits += tokHit;
    }
  }

  // Contradiction: req mentions live/supabase/backend but mocks dominate
  const wantsLive =
    /supabase|postgres|api|auth|live|production|real\s+data|قاعدة/i.test(req.text);
  if (wantsLive && index.usesMockData && codePaths.some((p) => /mock/i.test(p))) {
    return {
      status: "contradicts",
      codePaths: [...new Set(codePaths)].slice(0, 8),
      evidenceNotes: [
        ...evidenceNotes.slice(0, 4),
        "mock-data usage contradicts live-backend requirement",
      ],
    };
  }

  const uniqPaths = [...new Set(codePaths)].slice(0, 8);
  if (uniqPaths.length === 0 || hits === 0) {
    return { status: "missing", codePaths: [], evidenceNotes: ["no code evidence found"] };
  }
  if (hits >= 4 && uniqPaths.length >= 2) {
    return { status: "implemented", codePaths: uniqPaths, evidenceNotes: evidenceNotes.slice(0, 6) };
  }
  return { status: "partial", codePaths: uniqPaths, evidenceNotes: evidenceNotes.slice(0, 6) };
}

function loadSampleBodies(root: string, maxFiles = 80): Map<string, string> {
  return mapPaths(root, maxFiles);
}

function mapPaths(root: string, maxFiles: number): Map<string, string> {
  const map = new Map<string, string>();
  const stack = [root];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
  while (stack.length && map.size < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(m?[jt]sx?|jsx?|md|json)$/i.test(e.name)) continue;
      try {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        map.set(rel, fs.readFileSync(full, "utf-8").slice(0, 40_000));
      } catch {
        /* ignore */
      }
      if (map.size >= maxFiles) break;
    }
  }
  return map;
}

export function buildReqTraceMatrix(
  requirements: SpecRequirement[],
  index: RepoIndexResult
): ReqTraceMatrix {
  const bodies = loadSampleBodies(index.targetRepo);
  const rows: ReqTraceRow[] = requirements.map((req) => {
    const scored = scoreAgainstRepo(req, index, bodies);
    return {
      id: req.id,
      text: req.text,
      sourceFile: req.sourceFile,
      section: req.section,
      ...scored,
    };
  });

  const implementedCount = rows.filter((r) => r.status === "implemented").length;
  const partialCount = rows.filter((r) => r.status === "partial").length;
  const missingCount = rows.filter((r) => r.status === "missing").length;
  const contradictsCount = rows.filter((r) => r.status === "contradicts").length;
  const addressed = implementedCount + partialCount + contradictsCount;
  const coverageRatio = rows.length ? addressed / rows.length : 0;

  const markdown = [
    `# Requirements traceability matrix`,
    ``,
    `Coverage (non-missing): ${(coverageRatio * 100).toFixed(1)}% (${addressed}/${rows.length})`,
    `implemented=${implementedCount} partial=${partialCount} missing=${missingCount} contradicts=${contradictsCount}`,
    ``,
    `| ID | Status | Code paths | Requirement |`,
    `| --- | --- | --- | --- |`,
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.status} | ${r.codePaths.map((p) => `\`${p}\``).join("<br>") || "—"} | ${r.text.replace(/\|/g, "/").slice(0, 120)} |`
    ),
    ``,
  ].join("\n");

  return {
    rows,
    coverageRatio,
    implementedCount,
    partialCount,
    missingCount,
    contradictsCount,
    markdown,
    json: {
      coverageRatio,
      implementedCount,
      partialCount,
      missingCount,
      contradictsCount,
      rows,
    },
  };
}
