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
  featureFamilySymbols,
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
  /**
   * True when per-REQ code search ran and a status was assigned
   * (including missing). n/a headings are not assessed.
   */
  assessed?: boolean;
  /** Hits from the per-REQ search_code-style scan (0 when none / n/a). */
  searchHitCount?: number;
};

export type ReqTraceMatrix = {
  rows: ReqTraceRow[];
  /**
   * Implementation coverage: share of eligible REQs with code-backed statuses
   * (implemented/partial/contradicts). Reported metric; gate for build/implement.
   */
  coverageRatio: number;
  /**
   * Audit traceability: share of eligible REQs that were assessed with a status
   * and a recorded search trace. Missing counts when search ran. Gate for audit.
   */
  assessedCoverageRatio: number;
  assessedCount: number;
  /** Eligible REQ count (denominator - excludes n/a headings). */
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

/** Canonical implementation-coverage line (reported metric / build gate). */
export function formatGroundedCoverageLine(input: {
  coverageRatio: number;
  codeBackedCount: number;
  eligibleCount: number;
}): string {
  const pct = (Number(input.coverageRatio) * 100).toFixed(1);
  return `Coverage (code-backed: implemented+partial+contradicts): ${pct}% (${input.codeBackedCount}/${input.eligibleCount})`;
}

/** Audit-traceability line (gate metric for audit intent). */
export function formatAssessedCoverageLine(input: {
  assessedCoverageRatio: number;
  assessedCount: number;
  eligibleCount: number;
}): string {
  const pct = (Number(input.assessedCoverageRatio) * 100).toFixed(1);
  return `Audit traceability (assessed REQs with search trace): ${pct}% (${input.assessedCount}/${input.eligibleCount})`;
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
    // Nav / mock / constants: never implementation evidence.
    // Do NOT bump keywordHits — nav-only registration must stay missing.
    if (isNonFeatureEvidencePath(rel)) {
      if (isAppSourcePath(rel)) {
        evidenceNotes.push(
          `non-feature path ${rel} (nav/mock/constants) - not implementation evidence`
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
    // Non-app but non-junk (e.g. deeper markdown) - doc-only
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
  const assessedMeta = {
    assessed: true as const,
    searchHitCount: searched.hitCount,
  };
  evidenceNotes.unshift(
    `search_trace: scanned=${fileBodies.size} files, hits=${searched.hitCount}, paths=${searched.paths.slice(0, 4).join(",") || "none"}`
  );

  // Feature-family REQs (OCR/voice): without family APIs -> missing.
  // Screen names / nav registration never elevate to partial or contradicts.
  // Run BEFORE mock-contradiction so "camera APIs" wording cannot mint contradicts
  // from a name-only OcrScreen when usesMockData is true.
  const family = featureFamilySymbols(req.text);
  if (family && symbolHits === 0) {
    return {
      status: "missing",
      codePaths: [],
      evidenceNotes: [
        ...evidenceNotes.slice(0, 4),
        "feature-family REQ without camera/ocr/speech APIs - missing (screen names do not count)",
      ],
      ...assessedMeta,
    };
  }

  // Contradiction: req mentions live/supabase/backend but mocks dominate.
  // Use word boundaries so "camera APIs" does not match bare "api".
  const wantsLive =
    /supabase|postgres|\bapis?\b|\bauth\b|\blive\b|production|real\s+data|قاعدة/i.test(
      req.text
    );
  if (wantsLive && index.usesMockData && uniqApp.length >= 1) {
    return {
      status: "contradicts",
      codePaths: uniqApp,
      evidenceNotes: [
        ...evidenceNotes.slice(0, 5),
        "mock-data usage contradicts live-backend requirement",
      ],
      ...assessedMeta,
    };
  }

  // No app source at all (nav-only / mock-only hits never populate uniqApp)
  if (uniqApp.length === 0) {
    if (uniqDoc.length > 0) {
      return {
        status: "unverified",
        codePaths: [],
        evidenceNotes: [
          ...evidenceNotes.slice(0, 5),
          "doc/keyword-only hits - not code-backed",
        ],
        ...assessedMeta,
      };
    }
    return {
      status: "missing",
      codePaths: [],
      evidenceNotes: [
        ...evidenceNotes.slice(0, 5),
        "no app-source evidence found",
      ],
      ...assessedMeta,
    };
  }

  // Real UI screen/component + handlers for the feature (even with mock data) ->
  // at least partial. Mock-backed implementations are not "implemented".
  const hasUiFeature =
    symbolHits >= 1 ||
    uniqApp.some((p) => {
      const body = fileBodies.get(p) || "";
      const base = p.split("/").pop() || "";
      const nameHit = tokens.some(
        (t) => t.length >= 4 && base.toLowerCase().includes(t.toLowerCase())
      );
      const handler =
        /\bonPress\s*=|\bonClick\s*=|\bPressable\b|\bTouchable/i.test(body);
      const screen =
        /\b(Screen|Component|ViewModel)\b/.test(body) ||
        /Screen\.(m?[jt]sx?|jsx?)$/i.test(p);
      // Require path/name affinity OR in-body token hit — not bare keywordHits
      // from unrelated files — so nav-adjacent noise cannot mint partial.
      const bodyTok = tokens.some(
        (t) => t.length >= 4 && body.toLowerCase().includes(t.toLowerCase())
      );
      return (nameHit || bodyTok) && (handler || screen);
    });

  // Implemented requires app source + symbol/handler evidence and no mock-only layer
  if (symbolHits >= 1 && uniqApp.length >= 1 && !index.usesMockData) {
    return {
      status: "implemented",
      codePaths: uniqApp,
      evidenceNotes: evidenceNotes.slice(0, 6),
      ...assessedMeta,
    };
  }

  // UI feature present (handlers/screens) -> partial (mock data ok)
  if (hasUiFeature) {
    return {
      status: "partial",
      codePaths: uniqApp,
      evidenceNotes: [
        ...evidenceNotes.slice(0, 4),
        index.usesMockData
          ? "feature UI present with mock data - partial (not live implemented)"
          : "feature UI / handlers in app source - partial",
      ],
      ...assessedMeta,
    };
  }

  // App path keyword hit without feature UI/handlers -> missing
  // (e.g. string mention with no Screen/component/handlers)
  return {
    status: "missing",
    codePaths: [],
    evidenceNotes: [
      ...evidenceNotes.slice(0, 4),
      "app-source keyword hit without feature UI/handlers - missing",
    ],
    ...assessedMeta,
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
  // Implementation coverage: code-backed only (reported metric / build gate)
  const codeBacked = implementedCount + partialCount + contradictsCount;
  const eligibleCount = eligible.length;
  const coverageRatio = eligibleCount ? codeBacked / eligibleCount : 0;
  // Audit traceability: assessed with search trace (missing counts when assessed)
  const assessedCount = eligible.filter(
    (r) =>
      r.assessed === true ||
      (r.status !== "n/a" &&
        Array.isArray(r.evidenceNotes) &&
        r.evidenceNotes.some((n) => /search_trace:/i.test(n)))
  ).length;
  const assessedCoverageRatio = eligibleCount ? assessedCount / eligibleCount : 1;
  return {
    implementedCount,
    partialCount,
    missingCount,
    contradictsCount,
    unverifiedCount,
    naCount,
    coverageRatio,
    assessedCoverageRatio,
    assessedCount,
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
        evidenceNotes: ["spec heading / section title - excluded from coverage"],
        assessed: false,
        searchHitCount: 0,
      };
    }
    const scored = scoreAgainstRepo(req, index, bodies);
    return {
      id: req.id,
      text: req.text,
      sourceFile: req.sourceFile,
      section: req.section,
      ...scored,
      assessed: scored.assessed !== false,
    };
  });
  rows = applyP0FindingCaps(rows, checklistFindings);

  const counts = recomputeCounts(rows);
  const coverageLine = formatGroundedCoverageLine({
    coverageRatio: counts.coverageRatio,
    codeBackedCount: counts.codeBacked,
    eligibleCount: counts.eligibleCount,
  });
  const assessedLine = formatAssessedCoverageLine({
    assessedCoverageRatio: counts.assessedCoverageRatio,
    assessedCount: counts.assessedCount,
    eligibleCount: counts.eligibleCount,
  });

  const markdown = [
    `# Requirements traceability matrix`,
    ``,
    coverageLine,
    assessedLine,
    `implemented=${counts.implementedCount} partial=${counts.partialCount} missing=${counts.missingCount} contradicts=${counts.contradictsCount} unverified=${counts.unverifiedCount} n/a=${counts.naCount}`,
    ``,
    `| ID | Status | Code paths | Requirement |`,
    `| --- | --- | --- | --- |`,
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.status} | ${r.codePaths.map((p) => `\`${p}\``).join("<br>") || "-"} | ${r.text.replace(/\|/g, "/").slice(0, 120)} |`
    ),
    ``,
  ].join("\n");

  return {
    rows,
    coverageRatio: counts.coverageRatio,
    assessedCoverageRatio: counts.assessedCoverageRatio,
    assessedCount: counts.assessedCount,
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
      assessedCoverageRatio: counts.assessedCoverageRatio,
      assessedCount: counts.assessedCount,
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
