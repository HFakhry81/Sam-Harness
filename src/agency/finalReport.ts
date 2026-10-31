/**
 * Deterministic final-report sections from structured evidence.
 * The model may add prose around these sections but must not drop them.
 */
import type { AgencyVerdict } from "./agencyVerdict.js";
import type { ChecklistFinding } from "./auditChecklist.js";

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

const ISSUE_REQ_STATUSES = new Set(["missing", "partial", "contradicts"]);

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

  const parts = [deterministic.trim()];
  if (extra) {
    parts.push(``, `## Additional narrative`, ``, extra);
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
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

/** Deterministic RTM block — model must not invent alternate coverage/status. */
export function buildDeterministicRtmBlock(input: {
  reqRows: Array<{
    id: string;
    text?: string;
    status: string;
    codePaths?: string[];
  }>;
  coverageRatio?: number;
}): string {
  const rows = input.reqRows || [];
  if (!rows.length) {
    return [
      `## Requirements traceability (deterministic)`,
      ``,
      `_No REQs ingested — coverage N/A._`,
      ``,
    ].join("\n");
  }
  const implemented = rows.filter((r) => r.status === "implemented").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const missing = rows.filter((r) => r.status === "missing").length;
  const contradicts = rows.filter((r) => r.status === "contradicts").length;
  const addressed = implemented + partial + contradicts;
  const ratio =
    typeof input.coverageRatio === "number" && !Number.isNaN(input.coverageRatio)
      ? input.coverageRatio
      : rows.length
        ? addressed / rows.length
        : 0;
  return [
    `## Requirements traceability (deterministic)`,
    ``,
    `Do NOT restate or invent alternate REQ statuses or coverage percentages.`,
    `Coverage (non-missing): ${(ratio * 100).toFixed(1)}% (${addressed}/${rows.length})`,
    `implemented=${implemented} partial=${partial} missing=${missing} contradicts=${contradicts}`,
    ``,
    `| ID | Status | Code paths | Requirement |`,
    `| --- | --- | --- | --- |`,
    ...rows.map((r) => {
      const paths = (r.codePaths || [])
        .slice(0, 4)
        .map((p) => `\`${p}\``)
        .join("<br>");
      const text = String(r.text || "")
        .replace(/\|/g, "/")
        .replace(/\s+/g, " ")
        .slice(0, 100);
      return `| ${r.id} | ${r.status} | ${paths || "—"} | ${text} |`;
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
  const reqs = selectUnmetReqRows(input.reqRows || []);
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

/**
 * Inject deterministic RTM + Key Findings into a strategy draft.
 * Model copies of those sections are stripped so evidence wins.
 */
export function injectGroundedStrategyBlocks(
  strategy: string,
  input: {
    checklistFindings: ChecklistFinding[];
    reqRows: FinalReportEvidence["reqRows"];
    coverageRatio?: number;
    groundedCurrency?: string;
  }
): string {
  let body = String(strategy || "");
  // Strip model-authored RTM / Key Findings so deterministic blocks win
  body = body
    .replace(
      /##\s*Requirements traceability\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      ""
    )
    .replace(/##\s*Key Findings\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi, "")
    .replace(
      /##\s*REQ(?:uirements)?\s+traceability\b[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const rtm = buildDeterministicRtmBlock({
    reqRows: input.reqRows || [],
    coverageRatio: input.coverageRatio,
  });
  const findings = buildDeterministicKeyFindingsBlock({
    checklistFindings: input.checklistFindings || [],
    reqRows: input.reqRows || [],
    groundedCurrency: input.groundedCurrency,
  });

  const parts = [body, ``, rtm.trim(), ``, findings.trim(), ``];
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
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
