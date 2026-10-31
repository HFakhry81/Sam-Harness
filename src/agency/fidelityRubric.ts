/**
 * Grounded-audit fidelity rubric — replaces naive keyword counting as the gate.
 * Keyword hits remain informational only.
 */
import * as fs from "fs";
import * as path from "path";
import {
  FORBIDDEN_CURRENCY_ALTERNATES,
  isForbiddenCurrencyToken,
  remediateInvalidClaims,
} from "./claimVerify.js";
import {
  finalReportCoversStructuredFindings,
  finalReportHasFindingsCoverage,
} from "./finalReport.js";

export const GROUNDED_FIDELITY_THRESHOLD = 0.8;

export type RubricItemId =
  | "specs_read"
  | "code_read"
  | "req_status"
  | "stack_conflict_section"
  | "prioritized_findings"
  | "recommendations"
  | "pack_artifacts"
  | "findings_coverage";

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
  findings?: Array<{
    id?: string;
    severity?: string;
    summary?: string;
    category?: string;
  }>;
  /** cwd where pack artifacts are written before archive. */
  cwd?: string;
  /**
   * When set, rubric requires Executive summary / Key Findings / Recommendations
   * coverage of structured checklist + unmet REQs inside final-report.md.
   */
  finalReport?: string;
  groundedCurrency?: string;
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

  // 8) findings coverage in final-report (applicable only when finalReport provided)
  const finalReport = ctx.finalReport;
  const findingsCoverageApplicable = typeof finalReport === "string";
  if (findingsCoverageApplicable) {
    const hasSections = finalReportHasFindingsCoverage(finalReport || "");
    const structured = finalReportCoversStructuredFindings(finalReport || "", {
      checklistFindings: ctx.findings || [],
      reqRows: ctx.reqRows || [],
    });
    const passed = hasSections && structured.ok;
    items.push({
      id: "findings_coverage",
      label: "Final-report findings coverage",
      applicable: true,
      passed,
      detail: passed
        ? "Executive summary + Key Findings + Recommendations cover structured evidence"
        : `missing sections or ids: ${[
            !hasSections ? "section-headers" : "",
            ...structured.missing,
          ]
            .filter(Boolean)
            .join(",")}`,
    });
  } else {
    items.push({
      id: "findings_coverage",
      label: "Final-report findings coverage",
      applicable: false,
      passed: false,
      detail: "finalReport not provided — N/A during strategy scoring",
    });
  }

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

/**
 * Strip fenced model-errors sections before residue checks.
 * Forbidden tokens are allowed ONLY inside these fences.
 */
export function stripModelErrorFences(text: string): string {
  return String(text || "")
    .replace(/```model-errors\b[\s\S]*?```/gi, "")
    .replace(/##\s*Model errors log\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "");
}

/** Format invalid claims into a fenced model-errors log (ASCII). */
export function formatModelErrorsFence(
  errors: Array<{ kind?: string; claim?: string; detail?: string }>
): string {
  if (!errors.length) return "";
  const lines = errors.map(
    (e, i) =>
      `${i + 1}. [${e.kind || "other"}] ${e.claim || "?"} — ${e.detail || ""}`
  );
  return ["```model-errors", ...lines, "```"].join("\n");
}

/**
 * Pack-level assertion: final text must not contain forbidden residues
 * (outside model-error fences). Currency check is relative to groundedCurrency
 * and case-insensitive so "sar" / table cells / code spans are caught.
 */
export function assertCleanPackClaims(
  text: string,
  groundedCurrency = "EGP"
): {
  ok: boolean;
  violations: string[];
} {
  const check = stripModelErrorFences(text);
  const violations: string[] = [];
  const curRe = new RegExp(`\\b(${FORBIDDEN_CURRENCY_ALTERNATES})\\b`, "gi");
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = curRe.exec(check))) {
    const code = m[1].toUpperCase();
    if (!isForbiddenCurrencyToken(code, groundedCurrency)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    violations.push(code);
  }
  if (/packages\//i.test(check)) violations.push("packages/");
  if (/apps\/web/i.test(check)) violations.push("apps/web");
  if (/\[REMOVED\]/i.test(check)) violations.push("[REMOVED]");
  return { ok: violations.length === 0, violations };
}

/**
 * Scrub pack markdown: delete erasure-placeholder tokens; move leftover
 * forbidden path/currency claims into a fenced model-errors log.
 * Never leaves [REMOVED] in the output.
 */
export function scrubPackMarkdown(
  text: string,
  extraErrors: Array<{ kind?: string; claim?: string; detail?: string }> = [],
  groundedCurrency = "EGP"
): { text: string; violationsMoved: string[] } {
  let out = String(text || "").replace(/\s*\[REMOVED[^\]]*\]\s*/gi, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  const body = stripModelErrorFences(out);
  const violationsMoved: string[] = [];
  const errors = [...extraErrors];

  // Drop lines that still carry forbidden residues outside fences
  // (case-insensitive currency; scrub is a last-resort line drop — prefer
  // remediateInvalidClaims / finalizeClaimsClean which rewrite then delete sentences)
  const kept: string[] = [];
  const curRe = new RegExp(`\\b(${FORBIDDEN_CURRENCY_ALTERNATES})\\b`, "gi");
  for (const line of body.split(/\r?\n/)) {
    const bad: string[] = [];
    curRe.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = curRe.exec(line))) {
      const code = cm[1].toUpperCase();
      if (isForbiddenCurrencyToken(code, groundedCurrency) && !bad.includes(code)) {
        bad.push(code);
      }
    }
    if (/packages\//i.test(line)) bad.push("packages/");
    if (/apps\/web/i.test(line)) bad.push("apps/web");
    if (/\[REMOVED\]/i.test(line)) bad.push("[REMOVED]");
    if (bad.length) {
      for (const b of bad) {
        violationsMoved.push(b);
        errors.push({
          kind:
            b === "[REMOVED]"
              ? "placeholder"
              : /packages\/|apps\/web/i.test(b)
                ? "invalid_path"
                : "invalid_currency",
          claim: b,
          detail: `scrubbed from pack line: ${line.slice(0, 120)}`,
        });
      }
      continue;
    }
    kept.push(line);
  }
  out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  // Preserve any pre-existing model-errors fence from original
  const existingFence = String(text || "").match(/```model-errors\b[\s\S]*?```/i)?.[0];
  const fence = formatModelErrorsFence(errors);
  if (existingFence && !out.includes("```model-errors")) {
    out += `\n## Model errors log\n${existingFence}\n`;
  } else if (fence && !out.includes("```model-errors")) {
    out += `\n## Model errors log\n${fence}\n`;
  }
  // Absolute ban on erasure placeholder token
  out = out.replace(/\s*\[REMOVED[^\]]*\]\s*/gi, " ");
  return { text: out.replace(/\n{3,}/g, "\n\n").trim() + "\n", violationsMoved };
}

export const DEFAULT_PACK_CLAIM_FILES = [
  "ceo-draft.md",
  "audit-report.md",
  "final-report.md",
  "audit-history.md",
  "execution-result.md",
  "PACK_HANDOFF.md",
  "execution-plan.md",
  "agency-verdict.md",
];

export function assertCleanPackFiles(
  cwd: string = process.cwd(),
  checkFiles: string[] = DEFAULT_PACK_CLAIM_FILES,
  groundedCurrency = "EGP"
): { ok: boolean; violations: string[]; file?: string } {
  for (const name of checkFiles) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf-8");
    const r = assertCleanPackClaims(text, groundedCurrency);
    if (!r.ok) return { ok: false, violations: r.violations, file: name };
  }
  return { ok: true, violations: [] };
}

/** Scrub listed pack markdown files in cwd; returns files that still fail. */
export function scrubPackFiles(
  cwd: string = process.cwd(),
  files: string[] = DEFAULT_PACK_CLAIM_FILES,
  groundedCurrency = "EGP"
): { scrubbed: string[]; stillDirty: Array<{ file: string; violations: string[] }> } {
  const scrubbed: string[] = [];
  const stillDirty: Array<{ file: string; violations: string[] }> = [];
  for (const name of files) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf-8");
    const { text } = scrubPackMarkdown(raw, [], groundedCurrency);
    if (text !== raw) {
      fs.writeFileSync(p, text, "utf-8");
      scrubbed.push(name);
    }
    const check = assertCleanPackClaims(text, groundedCurrency);
    if (!check.ok) stillDirty.push({ file: name, violations: check.violations });
  }
  return { scrubbed, stillDirty };
}

export type EnforcePackResiduesResult = {
  ok: boolean;
  filesChecked: string[];
  remediations: Array<{ file: string; flags: string[] }>;
  stillDirty: Array<{ file: string; violations: string[] }>;
};

/**
 * AFTER the last pack rewrite/write: scan every pack markdown file, remediate
 * (rewrite max 2 → clean sentence delete — never [REMOVED] / never auto-sub),
 * then assert. Callers MUST close the gate when `ok` is false.
 */
export async function enforcePackResiduesAfterWrite(opts: {
  cwd?: string;
  targetRepo: string;
  groundedCurrency: string;
  files?: string[];
  rewriteFn?: (prompt: string, file: string) => Promise<string>;
  maxRewrites?: number;
}): Promise<EnforcePackResiduesResult> {
  const cwd = opts.cwd || process.cwd();
  const files = opts.files || DEFAULT_PACK_CLAIM_FILES;
  const currency = opts.groundedCurrency || "EGP";
  const filesChecked: string[] = [];
  const remediations: Array<{ file: string; flags: string[] }> = [];
  const stillDirty: Array<{ file: string; violations: string[] }> = [];

  for (const name of files) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    filesChecked.push(name);
    const raw = fs.readFileSync(p, "utf-8");
    const pre = assertCleanPackClaims(raw, currency);
    if (pre.ok) continue;

    const rewriteFn = opts.rewriteFn
      ? (prompt: string) => opts.rewriteFn!(prompt, name)
      : undefined;
    const remediated = await remediateInvalidClaims(
      raw,
      opts.targetRepo,
      currency,
      rewriteFn,
      opts.maxRewrites
    );
    // Never leave erasure placeholders; never auto-substitute currency tokens
    let next = remediated.text.replace(/\s*\[REMOVED[^\]]*\]\s*/gi, " ");
    next = next.replace(/\n{3,}/g, "\n\n").trim() + "\n";
    fs.writeFileSync(p, next, "utf-8");
    remediations.push({
      file: name,
      flags: remediated.flags.length
        ? remediated.flags
        : [`remediated residues ${pre.violations.join(",")}`],
    });

    const post = assertCleanPackClaims(next, currency);
    if (!post.ok) {
      stillDirty.push({ file: name, violations: post.violations });
    }
  }

  return {
    ok: stillDirty.length === 0,
    filesChecked,
    remediations,
    stillDirty,
  };
}
