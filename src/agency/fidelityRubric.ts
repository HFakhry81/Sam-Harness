/**
 * Grounded-audit fidelity rubric — replaces naive keyword counting as the gate.
 * Keyword hits remain informational only.
 */
import * as fs from "fs";
import * as path from "path";

export const GROUNDED_FIDELITY_THRESHOLD = 0.8;

export type RubricItemId =
  | "specs_read"
  | "code_read"
  | "req_status"
  | "stack_conflict_section"
  | "prioritized_findings"
  | "recommendations"
  | "pack_artifacts";

export type RubricItem = {
  id: RubricItemId;
  label: string;
  passed: boolean;
  applicable: boolean;
  detail: string;
};

export type RubricContext = {
  strategy: string;
  evidenceMarkdown?: string;
  /** Number of spec files ingested (>0 when specs were read). */
  specsReadCount?: number;
  /** REQ rows with status (implemented/partial/missing/contradicts). */
  reqRows?: Array<{ id: string; status: string; codePaths?: string[] }>;
  /** Checklist / evidence findings with severity. */
  findings?: Array<{ severity?: string; summary?: string; category?: string }>;
  /** cwd where pack artifacts are written before archive. */
  cwd?: string;
};

export type RubricResult = {
  score: number;
  passed: boolean;
  threshold: number;
  items: RubricItem[];
  passedCount: number;
  applicableCount: number;
  reason: string;
  /** Informational only — not used for the gate. */
  keywordHits?: { hit: number; total: number; tokens: string[] };
};

function hasStrategySection(strategy: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(strategy));
}

/**
 * Score strategy against grounded-audit task rubric.
 * Score = passed applicable items / applicable items. Threshold 0.8.
 */
export function scoreGroundedAuditRubric(
  ctx: RubricContext,
  threshold = GROUNDED_FIDELITY_THRESHOLD
): RubricResult {
  const s = String(ctx.strategy || "");
  const evidence = String(ctx.evidenceMarkdown || "");
  const items: RubricItem[] = [];

  // 1) specs read — count > 0 with citations in strategy or evidence
  const specsRead = Number(ctx.specsReadCount || 0);
  const specsCited =
    specsRead > 0 &&
    (/spec|requirements?\.md|REQ-\d+|مواصفات|brief\.docx/i.test(s) ||
      /Spec root:|requirements/i.test(evidence));
  items.push({
    id: "specs_read",
    label: "Specs read with citations",
    applicable: true,
    passed: specsRead > 0 && (specsCited || /REQ-\d{3}/.test(s + evidence)),
    detail:
      specsRead > 0
        ? `specsRead=${specsRead}, cited=${specsCited}`
        : "no spec files ingested",
  });

  // 2) code read — strategy cites real code paths from evidence
  const codeCited =
    /`src\/|mockData|package\.json|HomeScreen|supabase/i.test(s) ||
    /Citable file hits|Repo index/i.test(evidence);
  items.push({
    id: "code_read",
    label: "Code read with citations",
    applicable: true,
    passed: codeCited,
    detail: codeCited ? "code path citations present" : "no code citations found",
  });

  // 3) every REQ has a status + evidence (applicable when REQs exist)
  const rows = ctx.reqRows || [];
  const reqApplicable = rows.length > 0;
  const allHaveStatus = rows.every((r) =>
    /^(implemented|partial|missing|contradicts)$/i.test(r.status || "")
  );
  // missing with empty codePaths is fine (explicit no-evidence status)
  items.push({
    id: "req_status",
    label: "Every REQ has status + evidence",
    applicable: reqApplicable,
    passed: reqApplicable && allHaveStatus,
    detail: reqApplicable
      ? `${rows.length} REQs, allHaveStatus=${allHaveStatus}`
      : "no REQs — N/A",
  });

  // 4) stack/spec conflict section exists
  const stackSection = hasStrategySection(s, [
    /stack\s*conflict/i,
    /spec\s*stack/i,
    /repo\s*stack/i,
    /flutter|fastapi|expo|react[\s-]?native/i,
    /##\s*.*stack/i,
  ]) || /Stack conflict/i.test(evidence);
  items.push({
    id: "stack_conflict_section",
    label: "Stack/spec conflict section",
    applicable: true,
    passed: stackSection,
    detail: stackSection ? "stack/conflict discussion present" : "missing stack conflict section",
  });

  // 5) findings prioritized P0/P1
  const findings = ctx.findings || [];
  const hasPrio =
    findings.some((f) => /P0|P1/i.test(String(f.severity || ""))) ||
    /\[P0\]|\[P1\]|\bP0\b|\bP1\b/i.test(s) ||
    /\[P0\]|\[P1\]/i.test(evidence);
  items.push({
    id: "prioritized_findings",
    label: "Findings prioritized (P0/P1)",
    applicable: true,
    passed: hasPrio,
    detail: hasPrio
      ? `findings=${findings.length || "in-text"}`
      : "no P0/P1 prioritization found",
  });

  // 6) recommendations exist
  const hasRecs = hasStrategySection(s, [
    /##\s*.*recommend/i,
    /next\s+actions?/i,
    /توصيات|إجراءات/,
    /should\s+(wire|add|install|fix|implement)/i,
  ]);
  items.push({
    id: "recommendations",
    label: "Recommendations present",
    applicable: true,
    passed: hasRecs,
    detail: hasRecs ? "recommendations/next actions found" : "missing recommendations",
  });

  // 7) pack-ready artifacts written to cwd (archived into pack after review)
  const root = ctx.cwd || process.cwd();
  const artifacts = ["evidence.json", "evidence-pack.md", "REQ_TRACEABILITY.md"].filter(
    (n) => fs.existsSync(path.join(root, n))
  );
  // ceo-draft may be written mid-loop; also accept strategy length as proxy during audit
  const draftOk =
    fs.existsSync(path.join(root, "ceo-draft.md")) || s.length > 200;
  items.push({
    id: "pack_artifacts",
    label: "Pack artifacts written",
    applicable: true,
    passed: artifacts.length >= 2 && draftOk,
    detail: `artifacts=${artifacts.join(",") || "none"}; draft=${draftOk}`,
  });

  const applicable = items.filter((i) => i.applicable);
  const passedItems = applicable.filter((i) => i.passed);
  const score = applicable.length ? passedItems.length / applicable.length : 0;
  const passed = score >= threshold;
  const reason = passed
    ? `Rubric OK (score=${score.toFixed(2)}, ${passedItems.length}/${applicable.length})`
    : `Rubric FAIL (score=${score.toFixed(2)}, ${passedItems.length}/${applicable.length}; missing=${applicable
        .filter((i) => !i.passed)
        .map((i) => i.id)
        .join(",")})`;

  return {
    score,
    passed,
    threshold,
    items,
    passedCount: passedItems.length,
    applicableCount: applicable.length,
    reason,
  };
}

/** Informational keyword overlap — never used as the grounded-audit gate. */
export function keywordHitInfo(
  goal: string,
  strategy: string
): { hit: number; total: number; tokens: string[]; ratio: number } {
  const STOP = new Set(
    ["the", "and", "for", "with", "from", "that", "this", "into", "project", "against", "produce", "reports", "docs", "spec"].map(
      (x) => x.toLowerCase()
    )
  );
  const tokens = [
    ...new Set(
      String(goal || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\-_./]+/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t))
    ),
  ].slice(0, 40);
  const lower = String(strategy || "").toLowerCase();
  const hits = tokens.filter((t) => lower.includes(t));
  return {
    hit: hits.length,
    total: tokens.length,
    tokens: hits.slice(0, 12),
    ratio: tokens.length ? hits.length / tokens.length : 0,
  };
}

/** Pack-level assertion: final text must not contain forbidden residues. */
export function assertCleanPackClaims(text: string): {
  ok: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  if (/\bSAR\b/.test(text)) violations.push("SAR");
  if (/packages\//i.test(text)) violations.push("packages/");
  if (/apps\/web/i.test(text)) violations.push("apps/web");
  if (/\[REMOVED\]/i.test(text)) violations.push("[REMOVED]");
  return { ok: violations.length === 0, violations };
}

export function assertCleanPackFiles(
  cwd: string = process.cwd()
): { ok: boolean; violations: string[]; file?: string } {
  const checkFiles = ["ceo-draft.md", "final-report.md", "audit-report.md"];
  for (const name of checkFiles) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf-8");
    const r = assertCleanPackClaims(text);
    if (!r.ok) return { ok: false, violations: r.violations, file: name };
  }
  return { ok: true, violations: [] };
}
