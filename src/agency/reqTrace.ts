/**
 * Requirements traceability: REQ -> implemented / partial / missing / contradicts / unverified
 * with real app-source paths only. Junk/backup/prior-report paths never count.
 */
import * as fs from "fs";
import * as path from "path";
import type { SpecRequirement } from "./specIngest.js";
import type { RepoIndexResult } from "./repoIndex.js";
import type { ChecklistFinding } from "./auditChecklist.js";
import {
  hasSymbolOrHandlerEvidence,
  isAppSourcePath,
  isJunkDirName,
  isJunkEvidencePath,
  isNonFeatureEvidencePath,
  isSpecHeadingNotRequirement,
} from "./pathFilters.js";

export type ReqStatus =
  | "implemented"
  | "partial"
  | "missing"
  | "contradicts"
  | "unverified"
  | "n/a";

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
  /**
   * Share of eligible REQs (excludes n/a) with code-backed statuses
   * (implemented/partial/contradicts).
   */
  coverageRatio: number;
  /** Eligible REQ count (denominator — excludes n/a headings). */
  eligibleCount: number;
  codeBackedCount: number;
  implementedCount: number;
  partialCount: number;
  missingCount: number;
  contradictsCount: number;
  unverifiedCount: number;
  naCount: number;
  markdown: string;
  json: object;
};

/** Canonical coverage line used everywhere (strategy / final-report / claims). */
export function formatGroundedCoverageLine(input: {
  coverageRatio: number;
  codeBackedCount: number;
  eligibleCount: number;
}): string {
  const pct = (Number(input.coverageRatio) * 100).toFixed(1);
  return `Coverage (code-backed: implemented+partial+contradicts): ${pct}% (${input.codeBackedCount}/${input.eligibleCount})`;
}

const STOP_TOKENS = new Set(
  [
    "must",
    "should",
    "shall",
    "with",
    "from",
    "that",
    "this",
    "have",
    "been",
    "support",
    "target",
    "stack",
    "client",
    "product",
    "brief",
    "provide",
    "working",
    "button",
    "using",
    "into",
    "only",
    "real",
    "data",
  ].map((x) => x.toLowerCase())
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_./]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_TOKENS.has(t))
    .slice(0, 12);
}

/**
 * Build a search_code-style pattern from a REQ (distinctive tokens OR'd).
 * Used before scoring so every REQ is actively searched in the tree.
 */
export function reqSearchPattern(reqText: string): string {
  const tokens = tokenize(reqText).slice(0, 6);
  if (!tokens.length) return reqText.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

/** Search file bodies for a REQ; requires 2+ distinctive tokens (or one strong token). */
export function searchCodeForReq(
  fileBodies: Map<string, string>,
  reqText: string
): { paths: string[]; hitCount: number } {
  const tokens = tokenize(reqText);
  if (!tokens.length) return { paths: [], hitCount: 0 };
  const paths: string[] = [];
  let hitCount = 0;
  for (const [rel, body] of fileBodies) {
    if (isJunkEvidencePath(rel)) continue;
    const lower = body.toLowerCase();
    const matched = tokens.filter((t) => lower.includes(t));
    const strong = matched.some((t) => t.length >= 6);
    if (matched.length >= 2 || (matched.length >= 1 && strong)) {
      paths.push(rel);
      hitCount += matched.length;
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
  const appPaths: string[] = [];
  const docPaths: string[] = [];
  const evidenceNotes: string[] = [];
  let symbolHits = 0;
  let keywordHits = 0;

  const considerPath = (rel: string, body?: string) => {
    if (!rel || isJunkEvidencePath(rel)) return;
    const src = body ?? fileBodies.get(rel) ?? "";
    // Nav / mock / constants: never implementation evidence (weak partial at most)
    if (isNonFeatureEvidencePath(rel)) {
      if (isAppSourcePath(rel)) {
        keywordHits += 1;
        evidenceNotes.push(
          `non-feature path ${rel} (nav/mock/constants) — at most partial`
        );
      }
      return;
    }
    if (isAppSourcePath(rel)) {
      if (hasSymbolOrHandlerEvidence(src, tokens, req.text, rel)) {
        appPaths.push(rel);
        symbolHits += 1;
        evidenceNotes.push(`symbol/handler evidence in ${rel}`);
      } else {
        appPaths.push(rel);
        keywordHits += 1;
        evidenceNotes.push(`keyword hit in app source ${rel}`);
      }
      return;
    }
    // Non-app but non-junk (e.g. deeper markdown) — doc-only
    docPaths.push(rel);
    evidenceNotes.push(`doc/non-source hit ${rel}`);
  };

  // Mandatory: search_code-style scan per REQ before scoring
  const searched = searchCodeForReq(fileBodies, req.text);
  for (const p of searched.paths) {
    considerPath(p, fileBodies.get(p));
  }

  for (const h of index.hits) {
    if (isJunkEvidencePath(h.path)) continue;
    const hay = `${h.path} ${h.note}`.toLowerCase();
    const tokHit = tokens.filter((t) => hay.includes(t)).length;
    if (tokHit >= 1) {
      considerPath(h.path, fileBodies.get(h.path));
    }
  }

  // Content search on sampled bodies (token overlap)
  for (const [rel, body] of fileBodies) {
    if (isJunkEvidencePath(rel)) continue;
    const lower = body.toLowerCase();
    const tokHit = tokens.filter((t) => lower.includes(t)).length;
    if (tokHit >= 2) {
      considerPath(rel, body);
    }
  }

  const uniqApp = [...new Set(appPaths)].slice(0, 8);
  const uniqDoc = [...new Set(docPaths)].slice(0, 8);

  // Contradiction: req mentions live/supabase/backend but mocks dominate
  const wantsLive =
    /supabase|postgres|api|auth|live|production|real\s+data|قاعدة/i.test(req.text);
  if (wantsLive && index.usesMockData && uniqApp.some((p) => /mock/i.test(p))) {
    return {
      status: "contradicts",
      codePaths: uniqApp,
      evidenceNotes: [
        ...evidenceNotes.slice(0, 4),
        "mock-data usage contradicts live-backend requirement",
      ],
    };
  }

  // No app source at all
  if (uniqApp.length === 0) {
    if (uniqDoc.length > 0) {
      return {
        status: "unverified",
        codePaths: [],
        evidenceNotes: [
          ...evidenceNotes.slice(0, 4),
          "doc/keyword-only hits — not code-backed",
        ],
      };
    }
    return {
      status: "missing",
      codePaths: [],
      evidenceNotes: [
        ...evidenceNotes.slice(0, 4),
        "no app-source evidence found",
      ],
    };
  }

  // Implemented requires app source + symbol/handler evidence (not keyword-only)
  if (symbolHits >= 1 && uniqApp.length >= 1) {
    return {
      status: "implemented",
      codePaths: uniqApp,
      evidenceNotes: evidenceNotes.slice(0, 6),
    };
  }

  // Keyword hits in app source without symbol/handler → partial (not implemented)
  if (keywordHits >= 1 || uniqApp.length >= 1) {
    return {
      status: "partial",
      codePaths: uniqApp,
      evidenceNotes: [
        ...evidenceNotes.slice(0, 4),
        "keyword-only in app source — not symbol-backed implemented",
      ],
    };
  }

  return {
    status: "unverified",
    codePaths: [],
    evidenceNotes: evidenceNotes.slice(0, 6),
  };
}

/**
 * P0 checklist findings cap related REQs at most `partial`
 * (never leave them as implemented when the audit says the capability is broken).
 */
export function applyP0FindingCaps(
  rows: ReqTraceRow[],
  findings: ChecklistFinding[] = []
): ReqTraceRow[] {
  const p0 = (findings || []).filter((f) => f.severity === "P0");
  const hasStack = p0.some((f) => f.category === "stack_conflict");
  const hasOtpOrAuth = p0.some(
    (f) =>
      f.category === "auth" ||
      /otp|auth|sign-?in|login/i.test(`${f.id} ${f.summary} ${f.detail}`)
  );
  const hasMock = p0.some((f) => f.category === "mock_data");
  const hasDep = p0.some((f) => f.category === "dependency");
  const hasUi = p0.some((f) => f.category === "ui_handler");

  return rows.map((r) => {
    if (r.status !== "implemented") return r;
    const text = `${r.id} ${r.text}`.toLowerCase();
    let capped = false;
    let note = "";
    if (
      hasStack &&
      /flutter|fastapi|django|expo|react\s*native|stack|android|ios/i.test(text)
    ) {
      capped = true;
      note = "capped to partial by P0 stack_conflict finding";
    } else if (hasOtpOrAuth && /otp|auth|sign\s*in|login|google|apple|oauth/i.test(text)) {
      capped = true;
      note = "capped to partial by P0 auth/OTP finding";
    } else if (
      hasMock &&
      /live|real|supabase|backend|production|data\s+entry|mock/i.test(text)
    ) {
      capped = true;
      note = "capped to partial by P0 mock_data finding";
    } else if (hasDep && /depend|supabase|package|install|import/i.test(text)) {
      capped = true;
      note = "capped to partial by P0 dependency finding";
    } else if (hasUi && /logout|onpress|button|handler|pressable/i.test(text)) {
      capped = true;
      note = "capped to partial by P0 ui_handler finding";
    }
    if (!capped) return r;
    return {
      ...r,
      status: "partial" as const,
      evidenceNotes: [...r.evidenceNotes.slice(0, 5), note],
    };
  });
}

function loadSampleBodies(root: string, maxFiles = 80): Map<string, string> {
  return mapPaths(root, maxFiles);
}

function mapPaths(root: string, maxFiles: number): Map<string, string> {
  const map = new Map<string, string>();
  const stack = [root];
  while (stack.length && map.size < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (isJunkDirName(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (e.isDirectory()) {
        // Also block toolbox/maintenance even if parent isn't junk-named
        if (isJunkEvidencePath(rel + "/x")) continue;
        if (/toolbox\/maintenance/i.test(rel)) continue;
        stack.push(full);
        continue;
      }
      if (isJunkEvidencePath(rel)) continue;
      // Prefer app source; still allow other non-junk for search, but scoring filters
      if (!/\.(m?[jt]sx?|jsx?|dart|py|md|json)$/i.test(e.name)) continue;
      try {
        map.set(rel, fs.readFileSync(full, "utf-8").slice(0, 40_000));
      } catch {
        /* ignore */
      }
      if (map.size >= maxFiles) break;
    }
  }
  return map;
}

function recomputeCounts(rows: ReqTraceRow[]) {
  const implementedCount = rows.filter((r) => r.status === "implemented").length;
  const partialCount = rows.filter((r) => r.status === "partial").length;
  const missingCount = rows.filter((r) => r.status === "missing").length;
  const contradictsCount = rows.filter((r) => r.status === "contradicts").length;
  const unverifiedCount = rows.filter((r) => r.status === "unverified").length;
  const naCount = rows.filter((r) => r.status === "n/a").length;
  const eligible = rows.filter((r) => r.status !== "n/a");
  // Code-backed only — n/a excluded from denominator; unverified/missing do not inflate
  const codeBacked = implementedCount + partialCount + contradictsCount;
  const eligibleCount = eligible.length;
  const coverageRatio = eligibleCount ? codeBacked / eligibleCount : 0;
  return {
    implementedCount,
    partialCount,
    missingCount,
    contradictsCount,
    unverifiedCount,
    naCount,
    coverageRatio,
    codeBacked,
    eligibleCount,
  };
}

export function buildReqTraceMatrix(
  requirements: SpecRequirement[],
  index: RepoIndexResult,
  checklistFindings: ChecklistFinding[] = []
): ReqTraceMatrix {
  const bodies = loadSampleBodies(index.targetRepo);
  let rows: ReqTraceRow[] = requirements.map((req) => {
    if (isSpecHeadingNotRequirement(req.text)) {
      return {
        id: req.id,
        text: req.text,
        sourceFile: req.sourceFile,
        section: req.section,
        status: "n/a" as const,
        codePaths: [],
        evidenceNotes: ["spec heading / section title — excluded from coverage"],
      };
    }
    const scored = scoreAgainstRepo(req, index, bodies);
    return {
      id: req.id,
      text: req.text,
      sourceFile: req.sourceFile,
      section: req.section,
      ...scored,
    };
  });
  rows = applyP0FindingCaps(rows, checklistFindings);

  const counts = recomputeCounts(rows);
  const coverageLine = formatGroundedCoverageLine({
    coverageRatio: counts.coverageRatio,
    codeBackedCount: counts.codeBacked,
    eligibleCount: counts.eligibleCount,
  });

  const markdown = [
    `# Requirements traceability matrix`,
    ``,
    coverageLine,
    `implemented=${counts.implementedCount} partial=${counts.partialCount} missing=${counts.missingCount} contradicts=${counts.contradictsCount} unverified=${counts.unverifiedCount} n/a=${counts.naCount}`,
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
    coverageRatio: counts.coverageRatio,
    eligibleCount: counts.eligibleCount,
    codeBackedCount: counts.codeBacked,
    implementedCount: counts.implementedCount,
    partialCount: counts.partialCount,
    missingCount: counts.missingCount,
    contradictsCount: counts.contradictsCount,
    unverifiedCount: counts.unverifiedCount,
    naCount: counts.naCount,
    markdown,
    json: {
      coverageRatio: counts.coverageRatio,
      eligibleCount: counts.eligibleCount,
      codeBackedCount: counts.codeBacked,
      implementedCount: counts.implementedCount,
      partialCount: counts.partialCount,
      missingCount: counts.missingCount,
      contradictsCount: counts.contradictsCount,
      unverifiedCount: counts.unverifiedCount,
      naCount: counts.naCount,
      rows,
    },
  };
}
