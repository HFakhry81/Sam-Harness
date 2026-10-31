/**
 * Deterministic final-report sections from structured evidence.
 * The model may add prose around these sections but must not drop them.
 */
import type { AgencyVerdict } from "./agencyVerdict.js";
import type { ChecklistFinding } from "./auditChecklist.js";
import {
  formatAssessedCoverageLine,
  formatGroundedCoverageLine,
} from "./reqTrace.js";

const STATUS_WORDS =
  "implemented|partial|missing|contradicts|unverified|complete|done|n\\/a";

/** Strip model-authored per-REQ / feature status, coverage, counts, dependency lists. */
export function stripModelOwnedClaims(text: string): string {
  let body = stripTruncationMarkers(stripModelCoverageClaims(text));
  body = body.replace(
    /##\s*Deterministic blocks\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
    ""
  );
  body = body.replace(/^\s*-\s*RTM rows in file:\s*\d+\s*$/gim, "");
  body = body.replace(/^\s*-\s*Key Findings bullets in file:\s*\d+\s*$/gim, "");
  body = body.replace(
    /<!--\s*PROMPT_ONLY_DETERMINISTIC_SUMMARY[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
    ""
  );

  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let inRtm = false;
  let inStatusIndex = false;
  let inKeyFindings = false;

  for (const line of lines) {
    if (/##\s*Requirements traceability/i.test(line)) {
      inRtm = true;
      inStatusIndex = false;
      inKeyFindings = false;
      out.push(line);
      continue;
    }
    if (/##\s*REQ status index \(deterministic/i.test(line)) {
      inStatusIndex = true;
      inRtm = false;
      inKeyFindings = false;
      continue;
    }
    if (/##\s*Key Findings\b/i.test(line)) {
      inKeyFindings = true;
      inRtm = false;
      inStatusIndex = false;
      continue;
    }
    if (/^##\s+/.test(line)) {
      inRtm = false;
      inStatusIndex = false;
      inKeyFindings = false;
      out.push(line);
      continue;
    }
    if (inRtm) {
      out.push(line);
      continue;
    }
    if (inStatusIndex || inKeyFindings) continue;

    if (
      new RegExp(
        `\\bREQ[-_]?\\d+\\b[\\s\\S]{0,100}?\\b(${STATUS_WORDS})\\b`,
        "i"
      ).test(line) ||
      new RegExp(
        `\\b(${STATUS_WORDS})\\b[\\s\\S]{0,80}?\\bREQ[-_]?\\d+\\b`,
        "i"
      ).test(line)
    ) {
      continue;
    }
    if (
      /\b(ocr|voice|speech|receipt\s*scan)\b/i.test(line) &&
      new RegExp(`\\b(${STATUS_WORDS})\\b`, "i").test(line)
    ) {
      continue;
    }
    if (
      /deterministic\s+coverage|coverage\s*[:=]|implemented\s*=\s*\d+|missing\s*=\s*\d+/i.test(
        line
      )
    ) {
      continue;
    }
    if (
      /^\s*[-*]\s*(missing\s+)?(dependencies?|deps?)\s*:/i.test(line) ||
      /^\s*[-*]\s*@[\w.-]+\/[\w.-]+\s+(missing|not\s+in|absent)/i.test(line)
    ) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Deterministic REQ status index generated from reqTrace (not the model). */
export function buildDeterministicReqStatusIndex(
  reqRows: FinalReportEvidence["reqRows"]
): string {
  const rows = reqRows || [];
  if (!rows.length) {
    return [
      `## REQ status index (deterministic — from reqTrace)`,
      ``,
      `_No REQs ingested._`,
      ``,
    ].join("\n");
  }
  return [
    `## REQ status index (deterministic — from reqTrace)`,
    ``,
    `Do NOT invent per-REQ statuses, coverage percentages, counts, or dependency lists in narrative.`,
    `Authoritative statuses are below and in the RTM table.`,
    ``,
    ...rows.map((r) => {
      const text = String(r.text || "")
        .replace(/\s+/g, " ")
        .slice(0, 80);
      return `- ${r.id}: **${r.status}** — ${text}`;
    }),
    ``,
  ].join("\n");
}

export type FinalReportEvidence = {
  verdict: AgencyVerdict;
  checklistFindings: ChecklistFinding[];
  reqRows: Array<{
    id: string;
    text?: string;
    status: string;
    codePaths?: string[];
    evidenceNotes?: string[];
  }>;
  groundedCurrency: string;
  targetRepo?: string;
};

const ISSUE_REQ_STATUSES = new Set([
  "missing",
  "partial",
  "contradicts",
  "unverified",
]);

/** Remove prompt/model truncation markers from any written pack text. */
export function stripTruncationMarkers(text: string): string {
  return String(text || "")
    .replace(/\n?[^\n]*\.\.\.\(\s*truncated(?:\s+narrative(?:\s+only)?)?\s*\)[^\n]*\n?/gi, "\n")
    .replace(/\n?\.\.\.\(\s*truncated[^)]*\)\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + (String(text || "").trim() ? "\n" : "");
}

/** Strip model-invented coverage lines (percent or N/M) outside the RTM block. */
export function stripModelCoverageClaims(text: string): string {
  const lines = String(text || "").split(/\r?\n/);
  const out: string[] = [];
  let inRtm = false;
  for (const line of lines) {
    if (/##\s*Requirements traceability/i.test(line)) {
      inRtm = true;
      out.push(line);
      continue;
    }
    if (inRtm && /^##\s+/.test(line) && !/Requirements traceability/i.test(line)) {
      inRtm = false;
    }
    if (inRtm) {
      out.push(line);
      continue;
    }
    // Drop model coverage prose — RTM is the single source of truth
    if (
      /deterministic\s+coverage/i.test(line) ||
      (/coverage/i.test(line) &&
        (/(\d+(?:\.\d+)?)\s*%/.test(line) || /\b\d+\s*\/\s*\d+\b/.test(line)))
    ) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Checklist items that represent failures / partial gaps (not OK confirmations). */
export function selectFailedChecklistFindings(
  findings: ChecklistFinding[]
): ChecklistFinding[] {
  return (findings || []).filter((f) => {
    if (!f) return false;
    if (/^CUR-OK$/i.test(f.id)) return false;
    if (f.severity === "P2" && /grounded currency\/locale/i.test(f.summary || "")) {
      return false;
    }
    return true;
  });
}

export function selectUnmetReqRows(
  rows: FinalReportEvidence["reqRows"]
): FinalReportEvidence["reqRows"] {
  return (rows || []).filter((r) => ISSUE_REQ_STATUSES.has(String(r.status || "").toLowerCase()));
}

function citePaths(paths: string[]): string {
  if (!paths.length) return "(no path citation)";
  return paths
    .slice(0, 6)
    .map((p) => {
      const clean = String(p || "").trim();
      if (!clean || clean.startsWith("(")) return clean || "(none)";
      // Already file:line or bare path — wrap in backticks
      return `\`${clean}\``;
    })
    .join(", ");
}

function severityForReq(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s === "missing" || s === "contradicts") return "P0";
  if (s === "partial") return "P1";
  return "P2";
}

/** Build Executive summary + Key Findings + Recommendations (ASCII English). */
export function buildDeterministicFinalReportSections(
  input: FinalReportEvidence
): string {
  const v = input.verdict;
  const issues = selectFailedChecklistFindings(input.checklistFindings || []);
  const reqs = selectUnmetReqRows(input.reqRows || []);
  const currency = input.groundedCurrency || "EGP";

  const exec = [
    `## Executive summary`,
    ``,
    `- result: ${v.auditPassed ? "[APPROVED]" : "[REJECTED]"}`,
    `- gate: ${v.gate}`,
    `- grounded currency: ${currency}`,
    `- goalFidelityScore: ${v.goalFidelityScore.toFixed(3)}`,
    `- loops: ${v.loop}/${v.maxLoops}`,
    `- reason: ${v.reason}`,
    `- checklist issues: ${issues.length}`,
    `- unmet/partial REQs: ${reqs.length}`,
  ];

  const findingLines: string[] = [];
  for (const f of issues) {
    findingLines.push(
      `- [${f.severity}] ${f.id} (${f.category}): ${f.summary} — ${citePaths(f.paths || [])}`
    );
  }
  for (const r of reqs) {
    findingLines.push(
      `- [${severityForReq(r.status)}] ${r.id} (${r.status}): ${String(r.text || "")
        .replace(/\s+/g, " ")
        .slice(0, 160)} — ${citePaths(r.codePaths || [])}`
    );
  }
  if (!findingLines.length) {
    findingLines.push(`- (no failed/partial checklist items or unmet REQs)`);
  }

  const recs: string[] = [];
  for (const f of issues.slice(0, 12)) {
    const detail = String(f.detail || "").trim();
    if (detail) recs.push(`- [${f.severity}] ${f.id}: ${detail}`);
    else recs.push(`- [${f.severity}] ${f.id}: Resolve ${f.summary}`);
  }
  for (const r of reqs.slice(0, 8)) {
    recs.push(
      `- [${severityForReq(r.status)}] ${r.id}: Address ${r.status} requirement with grounded code evidence`
    );
  }
  if (!recs.length) {
    recs.push(`- Maintain grounded currency ${currency}; cite only real paths from evidence.`);
  }

  return [
    `# Final report`,
    ``,
    ...exec,
    ``,
    `## Key Findings`,
    ``,
    `Deterministic findings from AUDIT_CHECKLIST.md / evidence.json / REQ_TRACEABILITY.md:`,
    ``,
    ...findingLines,
    ``,
    `## Recommendations`,
    ``,
    ...recs,
    ``,
  ].join("\n");
}

/**
 * Compose final-report.md: deterministic sections are mandatory.
 * Model prose may only wrap/add around them — never replace Key Findings.
 */
export function composeFinalReport(input: {
  evidence: FinalReportEvidence;
  modelProse?: string;
}): string {
  const deterministic = buildDeterministicFinalReportSections(input.evidence);
  const prose = String(input.modelProse || "")
    .replace(/^#\s*Final report\s*/i, "")
    .trim();

  // If model already echoed our headers, strip duplicate Key Findings / Executive blocks
  let extra = prose;
  if (extra) {
    // Drop model copies of the three mandatory sections so deterministic wins
    extra = extra
      .replace(/##\s*Executive summary\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "")
      .replace(/##\s*Key Findings\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "")
      .replace(/##\s*Recommendations\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (extra) {
    extra = stripTruncationMarkers(stripModelCoverageClaims(extra)).trim();
  }

  const parts = [deterministic.trim()];
  if (extra) {
    parts.push(``, `## Additional narrative`, ``, extra);
  }
  return stripTruncationMarkers(
    parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"
  );
}

/** Markers used by the fidelity rubric for findings coverage. */
export function finalReportHasFindingsCoverage(text: string): boolean {
  const t = String(text || "");
  return (
    /##\s*Executive summary\b/i.test(t) &&
    /##\s*Key Findings\b/i.test(t) &&
    /##\s*Recommendations\b/i.test(t)
  );
}

/** Deterministic RTM block - model must not invent alternate coverage/status. */
export function buildDeterministicRtmBlock(input: {
  reqRows: Array<{
    id: string;
    text?: string;
    status: string;
    codePaths?: string[];
    assessed?: boolean;
  }>;
  /** Implementation coverage (reported metric / build gate). */
  coverageRatio?: number;
  eligibleCount?: number;
  codeBackedCount?: number;
  /** Audit traceability (assessed REQs with search trace). */
  assessedCoverageRatio?: number;
  assessedCount?: number;
}): string {
  const rows = input.reqRows || [];
  if (!rows.length) {
    return [
      `## Requirements traceability (deterministic)`,
      ``,
      `_No REQs ingested - coverage N/A._`,
      ``,
    ].join("\n");
  }
  const implemented = rows.filter((r) => r.status === "implemented").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const missing = rows.filter((r) => r.status === "missing").length;
  const contradicts = rows.filter((r) => r.status === "contradicts").length;
  const unverified = rows.filter((r) => r.status === "unverified").length;
  const na = rows.filter((r) => r.status === "n/a").length;
  const codeBacked =
    typeof input.codeBackedCount === "number"
      ? input.codeBackedCount
      : implemented + partial + contradicts;
  const eligible =
    typeof input.eligibleCount === "number"
      ? input.eligibleCount
      : Math.max(1, rows.length - na);
  const ratio =
    typeof input.coverageRatio === "number" && !Number.isNaN(input.coverageRatio)
      ? input.coverageRatio
      : eligible
        ? codeBacked / eligible
        : 0;
  const coverageLine = formatGroundedCoverageLine({
    coverageRatio: ratio,
    codeBackedCount: codeBacked,
    eligibleCount: eligible,
  });
  const assessedCount =
    typeof input.assessedCount === "number"
      ? input.assessedCount
      : rows.filter(
          (r) =>
            r.status !== "n/a" &&
            (r.assessed === true || r.assessed === undefined)
        ).length;
  const assessedRatio =
    typeof input.assessedCoverageRatio === "number" &&
    !Number.isNaN(input.assessedCoverageRatio)
      ? input.assessedCoverageRatio
      : eligible
        ? assessedCount / eligible
        : 1;
  const assessedLine = formatAssessedCoverageLine({
    assessedCoverageRatio: assessedRatio,
    assessedCount,
    eligibleCount: eligible,
  });
  return [
    `## Requirements traceability (deterministic)`,
    ``,
    `SINGLE SOURCE OF TRUTH - do not invent alternate coverage percentages or N/M fractions.`,
    `Authoritative statuses are in this table; narrative must match (if a REQ is missing here, never call it implemented).`,
    coverageLine,
    assessedLine,
    `implemented=${implemented} partial=${partial} missing=${missing} contradicts=${contradicts} unverified=${unverified} n/a=${na}`,
    ``,
    `| ID | Status | Code paths | Requirement |`,
    `| --- | --- | --- | --- |`,
    ...rows.map((r) => {
      const paths = (r.codePaths || [])
        .slice(0, 3)
        .map((p) => `\`${p}\``)
        .join("<br>");
      const text = String(r.text || "")
        .replace(/\|/g, "/")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || "-";
      const status = String(r.status || "missing").trim() || "-";
      return `| ${r.id} | ${status} | ${paths || "-"} | ${text} |`;
    }),
    ``,
  ].join("\n");
}

/**
 * Key Findings block suitable for strategy drafts (no Executive verdict required).
 * Includes every failed/partial checklist item and unmet/partial REQ with severity + citations.
 */
export function buildDeterministicKeyFindingsBlock(input: {
  checklistFindings: ChecklistFinding[];
  reqRows: FinalReportEvidence["reqRows"];
  groundedCurrency?: string;
}): string {
  const issues = selectFailedChecklistFindings(input.checklistFindings || []);
  // P0 dependencies first so missing package.json deps are never buried
  const ordered = [...issues].sort((a, b) => {
    const aDep =
      a.category === "dependency" || /^DEP-/i.test(a.id) ? 0 : a.severity === "P0" ? 1 : 2;
    const bDep =
      b.category === "dependency" || /^DEP-/i.test(b.id) ? 0 : b.severity === "P0" ? 1 : 2;
    if (aDep !== bDep) return aDep - bDep;
    return String(a.id).localeCompare(String(b.id));
  });
  const reqs = selectUnmetReqRows(input.reqRows || []);
  const findingLines: string[] = [];
  for (const f of ordered) {
    const paths = [...(f.paths || [])];
    if (
      (f.category === "dependency" || /^DEP-/i.test(f.id)) &&
      !paths.some((p) => /package\.json/i.test(p))
    ) {
      paths.unshift("package.json");
    }
    findingLines.push(
      `- [${f.severity}] ${f.id} (${f.category}): ${f.summary} — ${citePaths(paths)}`
    );
  }
  for (const r of reqs) {
    findingLines.push(
      `- [${severityForReq(r.status)}] ${r.id} (${r.status}): ${String(r.text || "")
        .replace(/\s+/g, " ")
        .slice(0, 160)} — ${citePaths(r.codePaths || [])}`
    );
  }
  if (!findingLines.length) {
    findingLines.push(`- (no failed/partial checklist items or unmet REQs)`);
  }
  const currency = input.groundedCurrency || "EGP";
  return [
    `## Key Findings`,
    ``,
    `Deterministic findings from AUDIT_CHECKLIST.md / evidence.json / REQ_TRACEABILITY.md (currency=${currency}):`,
    ``,
    ...findingLines,
    ``,
  ].join("\n");
}

/** Detect start of a deterministic injected block. */
export function isDeterministicStrategySection(headingLine: string): boolean {
  return /##\s*(Requirements traceability \(deterministic\)|Key Findings)/i.test(
    headingLine
  );
}

/**
 * Compact RTM for LLM prompts: counts + EVERY REQ id/status.
 * Never truncated — auditors must not invent 41% coverage from a clipped table.
 */
export function formatCompactRtmSummary(input: {
  reqRows?: Array<{ id: string; status: string; kind?: string }>;
  coverageRatio?: number;
  assessedCoverageRatio?: number;
  eligibleCount?: number;
  codeBackedCount?: number;
  assessedCount?: number;
}): string {
  const rows = input.reqRows || [];
  const implemented = rows.filter((r) => r.status === "implemented").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const missing = rows.filter((r) => r.status === "missing").length;
  const contradicts = rows.filter((r) => r.status === "contradicts").length;
  const unverified = rows.filter((r) => r.status === "unverified").length;
  const na = rows.filter((r) => r.status === "n/a").length;
  const eligible =
    typeof input.eligibleCount === "number"
      ? input.eligibleCount
      : Math.max(0, rows.length - na);
  const codeBacked =
    typeof input.codeBackedCount === "number"
      ? input.codeBackedCount
      : implemented + partial + contradicts;
  const assessed =
    typeof input.assessedCount === "number" ? input.assessedCount : eligible;
  const implLine =
    typeof input.coverageRatio === "number"
      ? formatGroundedCoverageLine({
          coverageRatio: input.coverageRatio,
          codeBackedCount: codeBacked,
          eligibleCount: eligible || 1,
        })
      : "";
  const assessedLine =
    typeof input.assessedCoverageRatio === "number"
      ? formatAssessedCoverageLine({
          assessedCoverageRatio: input.assessedCoverageRatio,
          assessedCount: assessed,
          eligibleCount: eligible || 1,
        })
      : "";
  const statusLine = rows
    .map((r) => `${r.id}:${r.status}`)
    .join(" ");
  return [
    `DETERMINISTIC RTM SUMMARY (complete — ${rows.length} REQs; never invent alternate coverage):`,
    implLine || undefined,
    assessedLine || undefined,
    `implemented=${implemented} partial=${partial} missing=${missing} contradicts=${contradicts} unverified=${unverified} n/a=${na}`,
    statusLine || "(no REQs)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Strip full RTM / status-index tables from evidence so clip() cannot cut mid-table. */
export function stripRtmSectionsForPrompt(text: string): string {
  return String(text || "")
    .replace(
      /##\s*Requirements traceability\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      "\n## Requirements traceability\n_(full table omitted in prompt — see DETERMINISTIC RTM SUMMARY)_\n"
    )
    .replace(
      /##\s*REQ status index \(deterministic[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Clip strategy for LLM prompts without truncating deterministic RTM / Key Findings.
 * Those blocks are replaced by a compact ALL-REQ id:status summary; written files
 * must always keep the full blocks (never append "...(truncated)" into them).
 *
 * Prefer `opts.reqRows` (full list) so every REQ id/status reaches the auditor.
 */
export function clipStrategyForPrompt(
  strategy: string,
  max = 6000,
  opts?: {
    reqRowCount?: number;
    findingCount?: number;
    reqRows?: Array<{ id: string; status: string; kind?: string }>;
    coverageRatio?: number;
    assessedCoverageRatio?: number;
    eligibleCount?: number;
    codeBackedCount?: number;
    assessedCount?: number;
  }
): string {
  const text = String(strategy || "");
  const rtm = text.match(
    /##\s*Requirements traceability \(deterministic\)[\s\S]*?(?=\n##\s(?!Requirements traceability)|\n#\s|$)/i
  )?.[0];
  const findings = text.match(
    /##\s*Key Findings\b[\s\S]*?(?=\n##\s(?!Key Findings)|\n#\s|$)/i
  )?.[0];

  let narrative = text
    .replace(
      /##\s*REQ status index \(deterministic[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      ""
    )
    .replace(
      /##\s*Requirements traceability \(deterministic\)[\s\S]*?(?=\n##\s(?!Requirements traceability)|\n#\s|$)/gi,
      ""
    )
    .replace(/##\s*Key Findings\b[\s\S]*?(?=\n##\s(?!Key Findings)|\n#\s|$)/gi, "")
    .replace(/##\s*Deterministic blocks\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const parsedFromTable = [
    ...((rtm || "").matchAll(/\|\s*(REQ[-_]?\d+)\s*\|\s*([a-z/]+)/gi) || []),
  ].map((m) => ({ id: m[1].toUpperCase().replace("_", "-"), status: m[2].toLowerCase() }));
  // Also parse "REQ-001: missing" status-index style
  const parsedFromIndex = [
    ...((text || "").matchAll(/\b(REQ[-_]?\d+)\s*:\s*\*\*([a-z/]+)\*\*/gi) || []),
  ].map((m) => ({
    id: m[1].toUpperCase().replace("_", "-"),
    status: m[2].toLowerCase(),
  }));
  const optRows = opts?.reqRows || [];
  const compactRows =
    optRows.length > 0
      ? optRows
      : parsedFromTable.length
        ? parsedFromTable
        : parsedFromIndex;

  const parsedRows = compactRows.length;
  const reqRows =
    typeof opts?.reqRowCount === "number" && opts.reqRowCount >= 0
      ? opts.reqRowCount
      : parsedRows;
  const parsedFindings = (findings || "").match(/^\s*-\s+\[/gm)?.length || 0;
  const findingBullets =
    typeof opts?.findingCount === "number" && opts.findingCount >= 0
      ? opts.findingCount
      : parsedFindings;

  const compact = formatCompactRtmSummary({
    reqRows: compactRows,
    coverageRatio: opts?.coverageRatio,
    assessedCoverageRatio: opts?.assessedCoverageRatio,
    eligibleCount: opts?.eligibleCount,
    codeBackedCount: opts?.codeBackedCount,
    assessedCount: opts?.assessedCount,
  });

  // Prompt-only summary — never copy into written pack files
  const summary = [
    `<!-- PROMPT_ONLY_DETERMINISTIC_SUMMARY: do not copy into written strategy -->`,
    `Deterministic RTM/Key Findings live in the written strategy file — do not invent statuses, coverage, counts, or dependency lists.`,
    `RTM rows (grounded): ${reqRows}; Key Findings bullets (grounded): ${findingBullets}`,
    `Coverage line: ${(rtm || "").match(/Coverage[^\n]*/)?.[0] || "(see compact RTM)"}`,
    compact,
  ].join("\n");

  if (narrative.length > max) {
    narrative =
      narrative.slice(0, max) +
      "\n<!-- PROMPT_NARRATIVE_CLIPPED: full text remains in written strategy file -->";
  }
  // Compact RTM is NEVER truncated — append after narrative clip
  return `${narrative}\n\n${summary}\n`;
}

/**
 * Inject deterministic RTM + Key Findings into a strategy draft.
 * Model copies of those sections are stripped so evidence wins.
 */
export function injectGroundedStrategyBlocks(
  strategy: string,
  input: {
    checklistFindings: ChecklistFinding[];
    reqRows: FinalReportEvidence["reqRows"];
    /** Implementation coverage (reported / build gate). */
    coverageRatio?: number;
    eligibleCount?: number;
    codeBackedCount?: number;
    assessedCoverageRatio?: number;
    assessedCount?: number;
    groundedCurrency?: string;
  }
): string {
  // Model must not own per-REQ status, coverage, counts, or dependency lists
  let body = stripModelOwnedClaims(String(strategy || ""));
  // Strip any leftover model RTM / Key Findings / status index / prompt footers
  body = body
    .replace(
      /##\s*REQ status index \(deterministic[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      ""
    )
    .replace(
      /##\s*Requirements traceability\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      ""
    )
    .replace(/##\s*Key Findings\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "")
    .replace(
      /##\s*REQ(?:uirements)?\s+traceability\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      ""
    )
    .replace(/##\s*Deterministic blocks\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  body = stripModelCoverageClaims(body);

  const statusIndex = buildDeterministicReqStatusIndex(input.reqRows || []);
  const rtm = buildDeterministicRtmBlock({
    reqRows: input.reqRows || [],
    coverageRatio: input.coverageRatio,
    eligibleCount: input.eligibleCount,
    codeBackedCount: input.codeBackedCount,
    assessedCoverageRatio: input.assessedCoverageRatio,
    assessedCount: input.assessedCount,
  });
  const findings = buildDeterministicKeyFindingsBlock({
    checklistFindings: input.checklistFindings || [],
    reqRows: input.reqRows || [],
    groundedCurrency: input.groundedCurrency,
  });

  const parts = [
    body,
    ``,
    statusIndex.trim(),
    ``,
    rtm.trim(),
    ``,
    findings.trim(),
    ``,
  ];
  return stripTruncationMarkers(
    parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"
  );
}

/**
 * True when every failed checklist id and unmet REQ id appears in the report body.
 */
export function finalReportCoversStructuredFindings(
  text: string,
  evidence: {
    checklistFindings?: Array<{ id?: string; severity?: string; summary?: string }>;
    reqRows?: Array<{ id: string; status: string }>;
  }
): { ok: boolean; missing: string[] } {
  const body = String(text || "");
  const missing: string[] = [];
  for (const f of evidence.checklistFindings || []) {
    if (!f?.id) continue;
    if (/^CUR-OK$/i.test(f.id)) continue;
    if (
      f.severity === "P2" &&
      /grounded currency\/locale/i.test(f.summary || "")
    ) {
      continue;
    }
    if (!body.includes(f.id)) missing.push(f.id);
  }
  for (const r of evidence.reqRows || []) {
    if (!ISSUE_REQ_STATUSES.has(String(r.status || "").toLowerCase())) continue;
    if (!body.includes(r.id)) missing.push(r.id);
  }
  return { ok: missing.length === 0, missing };
}
