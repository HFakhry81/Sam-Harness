/**
 * Requirements traceability: REQ -> implemented / partial / missing / contradicts / unverified
 * with real app-source paths only. Junk/backup/prior-report paths never count.
 */
import * as fs from "fs";
import * as path from "path";
import type { SpecRequirement, SpecReqKind } from "./specIngest.js";
import {
  classifyReqKind,
  ensureUtf8ReqText,
  isDocumentOnlyRequirement,
} from "./specIngest.js";
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
  /** feature | non_functional | document_only */
  kind?: SpecReqKind;
  /** Merged source citations from near-duplicate REQs. */
  sources?: Array<{ sourceFile: string; section: string }>;
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

/**
 * Ultra-common UI/domain tokens that match almost every Spendy-like screen.
 * Never sufficient alone for partial — need IDF-distinctive / feature-specific hits.
 */
const ALWAYS_GENERIC_TOKENS = new Set(
  [
    "amount",
    "date",
    "category",
    "categories",
    "user",
    "users",
    "name",
    "type",
    "value",
    "text",
    "data",
    "list",
    "item",
    "items",
    "show",
    "display",
    "screen",
    "screens",
    "button",
    "view",
    "home",
    "settings",
    "input",
    "form",
    "props",
    "style",
    "color",
    "title",
    "page",
    "state",
    "label",
    "field",
    "total",
    "count",
    "time",
    "note",
    "info",
    "detail",
    "content",
    "description",
    "expense",
    "expenses",
    // Source-code keywords that match nearly every JS/TS file
    "import",
    "export",
    "const",
    "function",
    "return",
    "class",
    "react",
    "native",
    "default",
    "async",
    "await",
    "pressable",
    "component",
    "components",
    "module",
    "modules",
    "integration", // too vague alone ("Bank Integration" needs bank/plaid)
  ].map((x) => x.toLowerCase())
);

/** Max evidence paths written per REQ (most specific first). */
export const MAX_EVIDENCE_PATHS_PER_REQ = 3;

/** Token appears in this fraction of app screens → treated as non-distinctive (IDF). */
const IDF_COMMON_RATIO = 0.5;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_./]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_TOKENS.has(t))
    .slice(0, 12);
}

/** Expand a token with light singular/plural variants for matching. */
function tokenVariants(t: string): string[] {
  const out = new Set<string>([t]);
  if (t.endsWith("ies") && t.length > 5) out.add(t.slice(0, -3) + "y");
  if (t.endsWith("es") && t.length > 5) out.add(t.slice(0, -2));
  if (t.endsWith("s") && t.length > 4 && !t.endsWith("ss")) out.add(t.slice(0, -1));
  return [...out];
}

function bodyHasToken(lowerBody: string, token: string): boolean {
  return tokenVariants(token).some((v) => lowerBody.includes(v));
}

/**
 * Document frequency of tokens across app source screens (for IDF-style weighting).
 * Nav/mock/constants are excluded so "wallet" in Tab.Screen labels does not dominate.
 */
export function buildAppTokenDocFreq(
  fileBodies: Map<string, string>
): { df: Map<string, number>; docCount: number } {
  const df = new Map<string, number>();
  let docCount = 0;
  for (const [rel, body] of fileBodies) {
    if (!isAppSourcePath(rel) || isNonFeatureEvidencePath(rel)) continue;
    docCount += 1;
    const lower = body.toLowerCase();
    const seen = new Set<string>();
    const toks = lower
      .replace(/[^\p{L}\p{N}\-_./]+/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOP_TOKENS.has(t) && !ALWAYS_GENERIC_TOKENS.has(t));
    for (const t of toks) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  return { df, docCount };
}

/**
 * Distinctive tokens for a REQ: drop stopwords, always-generic words, and
 * tokens that appear in most app screens (IDF-style). Soft-generic words like
 * "wallet" survive when they are rare in the scanned tree.
 */
export function distinctiveReqTokens(
  reqText: string,
  df: Map<string, number> = new Map(),
  docCount = 0
): string[] {
  const raw = tokenize(reqText).filter((t) => !ALWAYS_GENERIC_TOKENS.has(t));
  if (!raw.length) return [];
  // IDF needs a real corpus — with 1–2 screens every present token looks "common"
  if (docCount < 3) return raw.slice(0, 8);
  const kept = raw.filter((t) => {
    const freq = df.get(t) || 0;
    // Also check variants against DF keys
    let maxFreq = freq;
    for (const v of tokenVariants(t)) {
      maxFreq = Math.max(maxFreq, df.get(v) || 0);
    }
    // Drop only when the token appears in a strict majority of screens ("most")
    return !(maxFreq / docCount > IDF_COMMON_RATIO);
  });
  // If IDF wiped everything, keep the longest raw tokens (still not always-generic)
  if (!kept.length) {
    return [...raw].sort((a, b) => b.length - a.length).slice(0, 3);
  }
  return kept.slice(0, 8);
}

/**
 * Build a search_code-style pattern from a REQ (distinctive tokens OR'd).
 * Used before scoring so every REQ is actively searched in the tree.
 */
export function reqSearchPattern(reqText: string): string {
  const tokens = distinctiveReqTokens(reqText).slice(0, 6);
  if (!tokens.length) {
    const fallback = tokenize(reqText).slice(0, 4);
    if (!fallback.length) {
      return reqText.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return fallback.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  }
  return tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

/** Search file bodies for a REQ; requires distinctive token hits (IDF-aware). */
export function searchCodeForReq(
  fileBodies: Map<string, string>,
  reqText: string,
  df?: Map<string, number>,
  docCount?: number
): { paths: string[]; hitCount: number; pathScores: Map<string, number> } {
  const { df: builtDf, docCount: builtN } =
    df && typeof docCount === "number"
      ? { df, docCount }
      : buildAppTokenDocFreq(fileBodies);
  const tokens = distinctiveReqTokens(reqText, builtDf, builtN);
  const pathScores = new Map<string, number>();
  if (!tokens.length) return { paths: [], hitCount: 0, pathScores };
  const scored: Array<{ rel: string; score: number; hits: number }> = [];
  let hitCount = 0;
  for (const [rel, body] of fileBodies) {
    if (isJunkEvidencePath(rel)) continue;
    const lower = body.toLowerCase();
    const matched = tokens.filter((t) => bodyHasToken(lower, t));
    if (!matched.length) continue;
    const strong = matched.some((t) => t.length >= 6);
    // Require 2+ distinctive tokens, or one strong (≥6) feature-specific token
    if (matched.length >= 2 || (matched.length >= 1 && strong)) {
      const base = rel.split("/").pop() || "";
      const nameBonus = matched.some((t) =>
        tokenVariants(t).some((v) => base.toLowerCase().includes(v))
      )
        ? 2
        : 0;
      const score = matched.length * 2 + nameBonus + (strong ? 1 : 0);
      scored.push({ rel, score, hits: matched.length });
      hitCount += matched.length;
      pathScores.set(rel, score);
    }
  }
  scored.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  return {
    paths: scored.slice(0, 12).map((s) => s.rel),
    hitCount,
    pathScores,
  };
}

/** Prefer paths whose basename shares distinctive tokens with the REQ. */
function rankEvidencePaths(
  paths: string[],
  tokens: string[],
  pathScores: Map<string, number>
): string[] {
  const scored = [...new Set(paths)].map((p) => {
    const base = (p.split("/").pop() || "").toLowerCase();
    const nameHits = tokens.filter((t) =>
      tokenVariants(t).some((v) => base.includes(v))
    ).length;
    const depthPenalty = p.split("/").length;
    const idfScore = pathScores.get(p) || 0;
    return {
      p,
      score: idfScore * 3 + nameHits * 5 - depthPenalty,
    };
  });
  scored.sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  return scored.slice(0, MAX_EVIDENCE_PATHS_PER_REQ).map((x) => x.p);
}

function scoreAgainstRepo(
  req: SpecRequirement,
  index: RepoIndexResult,
  fileBodies: Map<string, string>
): Omit<ReqTraceRow, "id" | "text" | "sourceFile" | "section"> {
  const { df, docCount } = buildAppTokenDocFreq(fileBodies);
  const tokens = distinctiveReqTokens(req.text, df, docCount);
  const allTokens = tokenize(req.text);
  const appPaths: string[] = [];
  const docPaths: string[] = [];
  const evidenceNotes: string[] = [];
  let symbolHits = 0;
  let keywordHits = 0;
  let distinctiveBodyHits = 0;

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
      const lower = src.toLowerCase();
      const distHits = tokens.filter((t) => bodyHasToken(lower, t)).length;
      if (distHits > 0) distinctiveBodyHits += distHits;
      // Symbol/handler evidence must use distinctive tokens when available
      const evidenceToks = tokens.length ? tokens : allTokens;
      if (hasSymbolOrHandlerEvidence(src, evidenceToks, req.text, rel)) {
        appPaths.push(rel);
        symbolHits += 1;
        evidenceNotes.push(`symbol/handler evidence in ${rel}`);
      } else if (distHits > 0) {
        appPaths.push(rel);
        keywordHits += 1;
        evidenceNotes.push(`distinctive-token hit in app source ${rel}`);
      }
      // Generic-only keyword hits (no distinctive tokens) are ignored —
      // HomeScreen matching "expense"/"amount" must not mint partial.
      return;
    }
    // Non-app but non-junk (e.g. deeper markdown) - doc-only
    docPaths.push(rel);
    evidenceNotes.push(`doc/non-source hit ${rel}`);
  };

  // Mandatory: search_code-style scan per REQ before scoring
  const searched = searchCodeForReq(fileBodies, req.text, df, docCount);
  for (const p of searched.paths) {
    considerPath(p, fileBodies.get(p));
  }

  for (const h of index.hits) {
    if (isJunkEvidencePath(h.path)) continue;
    const hay = `${h.path} ${h.note}`.toLowerCase();
    const tokHit = tokens.filter((t) =>
      tokenVariants(t).some((v) => hay.includes(v))
    ).length;
    if (tokHit >= 1) {
      considerPath(h.path, fileBodies.get(h.path));
    }
  }

  // Content search on sampled bodies (distinctive token overlap only)
  for (const [rel, body] of fileBodies) {
    if (isJunkEvidencePath(rel)) continue;
    const lower = body.toLowerCase();
    const tokHit = tokens.filter((t) => bodyHasToken(lower, t)).length;
    if (tokHit >= 1 && (tokHit >= 2 || tokens.some((t) => t.length >= 6))) {
      considerPath(rel, body);
    }
  }

  const uniqApp = rankEvidencePaths(appPaths, tokens, searched.pathScores);
  const uniqDoc = [...new Set(docPaths)].slice(0, MAX_EVIDENCE_PATHS_PER_REQ);
  const assessedMeta = {
    assessed: true as const,
    searchHitCount: searched.hitCount,
  };
  evidenceNotes.unshift(
    `search_trace: scanned=${fileBodies.size} files, distinctive=${tokens.slice(0, 4).join("|") || "none"}, hits=${searched.hitCount}, paths=${searched.paths.slice(0, 3).join(",") || "none"}`
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

  // No app source at all (nav-only / mock-only / generic-only hits never populate uniqApp)
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
        distinctiveBodyHits === 0 && allTokens.length
          ? "no distinctive-token evidence in app source (generic matches ignored)"
          : "no app-source evidence found",
      ],
      ...assessedMeta,
    };
  }

  // Real UI screen/component + handlers for the feature (even with mock data) ->
  // at least partial. Requires distinctive token affinity — not bare "expense"/"amount".
  const hasUiFeature =
    (symbolHits >= 1 && (tokens.length === 0 || distinctiveBodyHits > 0 || uniqApp.some((p) => {
      const base = (p.split("/").pop() || "").toLowerCase();
      return tokens.some((t) =>
        tokenVariants(t).some((v) => base.includes(v))
      );
    }))) ||
    uniqApp.some((p) => {
      const body = fileBodies.get(p) || "";
      const base = p.split("/").pop() || "";
      const nameHit = tokens.some((t) =>
        tokenVariants(t).some((v) => base.toLowerCase().includes(v))
      );
      const handler =
        /\bonPress\s*=|\bonClick\s*=|\bPressable\b|\bTouchable/i.test(body);
      const screen =
        /\b(Screen|Component|ViewModel)\b/.test(body) ||
        /Screen\.(m?[jt]sx?|jsx?)$/i.test(p);
      const bodyTok = tokens.some((t) => bodyHasToken(body.toLowerCase(), t));
      // Distinctive path/name or body token required — generic HomeScreen hits fail
      return (nameHit || bodyTok) && (handler || screen);
    });

  // Implemented requires app source + symbol/handler evidence and no mock-only layer
  if (symbolHits >= 1 && uniqApp.length >= 1 && !index.usesMockData && hasUiFeature) {
    return {
      status: "implemented",
      codePaths: uniqApp,
      evidenceNotes: evidenceNotes.slice(0, 6),
      ...assessedMeta,
    };
  }

  // UI feature present (handlers/screens) with distinctive evidence -> partial
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
    const reqText = ensureUtf8ReqText(req.text);
    const kind: SpecReqKind =
      req.kind ||
      classifyReqKind(reqText) ||
      (isSpecHeadingNotRequirement(reqText) || isDocumentOnlyRequirement(reqText)
        ? "document_only"
        : "feature");
    const sources =
      req.sources && req.sources.length
        ? req.sources
        : [{ sourceFile: req.sourceFile, section: req.section }];
    const reqForScore = { ...req, text: reqText };

    // Document-only (roadmap, costs, guidelines, overview, bare section titles) → n/a
    if (
      kind === "document_only" ||
      isSpecHeadingNotRequirement(reqText) ||
      isDocumentOnlyRequirement(reqText)
    ) {
      return {
        id: req.id,
        text: reqText,
        sourceFile: req.sourceFile,
        section: req.section,
        kind: "document_only" as const,
        sources,
        status: "n/a" as const,
        codePaths: [],
        evidenceNotes: [
          "document-only / section title - excluded from coverage",
        ],
        assessed: false,
        searchHitCount: 0,
      };
    }

    const scored = scoreAgainstRepo(reqForScore, index, bodies);

    // Non-functional: keep best evidence, else unverified (never inflate missing as code gap)
    if (kind === "non_functional") {
      if (
        scored.status === "implemented" ||
        scored.status === "partial" ||
        scored.status === "contradicts"
      ) {
        return {
          id: req.id,
          text: reqText,
          sourceFile: req.sourceFile,
          section: req.section,
          kind,
          sources,
          ...scored,
          assessed: scored.assessed !== false,
          evidenceNotes: [
            ...scored.evidenceNotes.slice(0, 5),
            "non-functional REQ assessed with best available evidence",
          ],
        };
      }
      return {
        id: req.id,
        text: reqText,
        sourceFile: req.sourceFile,
        section: req.section,
        kind,
        sources,
        status: "unverified" as const,
        codePaths: scored.codePaths || [],
        evidenceNotes: [
          ...(scored.evidenceNotes || []).slice(0, 4),
          "non-functional REQ - unverified without strong code evidence",
        ],
        assessed: true,
        searchHitCount: scored.searchHitCount ?? 0,
      };
    }

    return {
      id: req.id,
      text: reqText,
      sourceFile: req.sourceFile,
      section: req.section,
      kind,
      sources,
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

  const markdown = formatReqTraceMarkdown(rows, {
    coverageLine,
    assessedLine,
    counts,
  });

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

/** Soft cap for detailed RTM table rows (group summary still lists all modules). */
export const MAX_RTM_TABLE_ROWS = 60;

/**
 * Render RTM markdown grouped by module/section, with a capped detail table.
 * Preserves Unicode (Arabic) REQ titles — never latin1-roundtrip.
 */
export function formatReqTraceMarkdown(
  rows: ReqTraceRow[],
  meta: {
    coverageLine: string;
    assessedLine: string;
    counts: ReturnType<typeof recomputeCounts>;
  }
): string {
  const byModule = new Map<string, ReqTraceRow[]>();
  for (const r of rows) {
    const mod = String(r.section || r.sourceFile || "General")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "General";
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod)!.push(r);
  }

  const moduleSummary = [...byModule.entries()]
    .map(([mod, rs]) => {
      const impl = rs.filter((x) => x.status === "implemented").length;
      const part = rs.filter((x) => x.status === "partial").length;
      const miss = rs.filter((x) => x.status === "missing").length;
      const na = rs.filter((x) => x.status === "n/a").length;
      return `- **${mod}**: ${rs.length} REQs (implemented=${impl} partial=${part} missing=${miss} n/a=${na})`;
    })
    .join("\n");

  // Prefer features in the detail table; keep document_only out of the cap budget
  const featureRows = rows.filter((r) => r.kind !== "document_only");
  const docRows = rows.filter((r) => r.kind === "document_only");
  const detailRows = [
    ...featureRows.slice(0, MAX_RTM_TABLE_ROWS),
    ...docRows.slice(0, 8),
  ];
  const omitted =
    featureRows.length > MAX_RTM_TABLE_ROWS
      ? featureRows.length - MAX_RTM_TABLE_ROWS
      : 0;

  const tableLines = detailRows.map((r) => {
    const text = String(r.text || "")
      .replace(/\|/g, "/")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const paths =
      r.codePaths
        .slice(0, MAX_EVIDENCE_PATHS_PER_REQ)
        .map((p) => `\`${p}\``)
        .join("<br>") || "-";
    return `| ${r.id} | ${r.status}${r.kind ? ` (${r.kind})` : ""} | ${paths} | ${text} |`;
  });

  return [
    `# Requirements traceability matrix`,
    ``,
    meta.coverageLine,
    meta.assessedLine,
    `implemented=${meta.counts.implementedCount} partial=${meta.counts.partialCount} missing=${meta.counts.missingCount} contradicts=${meta.counts.contradictsCount} unverified=${meta.counts.unverifiedCount} n/a=${meta.counts.naCount}`,
    ``,
    `## By module`,
    moduleSummary || "_No modules._",
    ``,
    `## Detail`,
    omitted
      ? `_Showing ${detailRows.length} of ${rows.length} rows (${omitted} additional feature REQs summarized in module groups only)._`
      : `_${rows.length} REQs._`,
    ``,
    `| ID | Status | Code paths | Requirement |`,
    `| --- | --- | --- | --- |`,
    ...tableLines,
    ``,
  ].join("\n");
}
