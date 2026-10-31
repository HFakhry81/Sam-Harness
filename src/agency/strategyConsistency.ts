/**
 * Deterministic strategy consistency checks + repair.
 * Run BEFORE the LLM auditor so we never spend a loop on prose/RTM drift,
 * truncation markers, empty sections, or claim residue.
 */
import type { ChecklistFinding } from "./auditChecklist.js";
import {
  detectInvalidClaims,
  type GroundedCoverage,
  type GroundedReqRow,
} from "./claimVerify.js";
import {
  buildDeterministicReqStatusIndex,
  injectGroundedStrategyBlocks,
  stripModelOwnedClaims,
  stripTruncationMarkers,
} from "./finalReport.js";
import {
  hasStructuralMarkdownHoles,
  normalizeMarkdownStructure,
} from "./markdownNormalize.js";

export type ConsistencyIssue = {
  kind:
    | "prose_rtm_mismatch"
    | "coverage_mismatch"
    | "truncation_marker"
    | "empty_section"
    | "claim_residue"
    | "missing_rtm"
    | "missing_key_findings"
    | "missing_dep_finding"
    | "rtm_row_count";
  detail: string;
};

export type ConsistencyGrounding = {
  reqRows: Array<{
    id: string;
    text?: string;
    status: string;
    codePaths?: string[];
  }>;
  checklistFindings: ChecklistFinding[];
  coverageRatio?: number;
  eligibleCount?: number;
  codeBackedCount?: number;
  groundedCurrency?: string;
  targetRepo?: string;
};

const STATUS_WORDS =
  "implemented|partial|missing|contradicts|unverified|complete|done|n\\/a";

/** Lines that invent per-REQ / feature status outside the deterministic RTM table. */
export function findProseStatusMismatches(
  text: string,
  reqRows: ConsistencyGrounding["reqRows"]
): ConsistencyIssue[] {
  const byId = new Map(reqRows.map((r) => [r.id.toUpperCase(), r] as const));
  const issues: ConsistencyIssue[] = [];
  const lines = String(text || "").split(/\r?\n/);
  let inRtm = false;
  let inStatusIndex = false;

  for (const line of lines) {
    if (/##\s*Requirements traceability/i.test(line)) {
      inRtm = true;
      inStatusIndex = false;
      continue;
    }
    if (/##\s*REQ status index \(deterministic/i.test(line)) {
      inStatusIndex = true;
      inRtm = false;
      continue;
    }
    if (/^##\s+/.test(line)) {
      inRtm = false;
      inStatusIndex = false;
    }
    if (inRtm || inStatusIndex) continue;
    if (/^\s*-\s*\[P[012]\]\s+REQ-\d+/i.test(line)) continue;

    const reqRe = new RegExp(
      `\\b(REQ[-_]?\\d+)\\b[\\s\\S]{0,100}?\\b(${STATUS_WORDS})\\b|\\b(${STATUS_WORDS})\\b[\\s\\S]{0,80}?\\b(REQ[-_]?\\d+)\\b`,
      "i"
    );
    const m = line.match(reqRe);
    if (m) {
      const rawId = (m[1] || m[4] || "").toUpperCase().replace(/_/g, "-");
      const id = rawId.includes("-") ? rawId : rawId.replace(/^REQ/, "REQ-");
      const statusWord = (m[2] || m[3] || "")
        .toLowerCase()
        .replace(/complete|done/, "implemented");
      const grounded = byId.get(id);
      if (grounded && statusWord !== grounded.status.toLowerCase()) {
        issues.push({
          kind: "prose_rtm_mismatch",
          detail: `prose says ${id}=${statusWord} but RTM is ${grounded.status}: ${line.trim().slice(0, 160)}`,
        });
      }
    }

    const featRe = new RegExp(
      `\\b(ocr|voice|speech|receipt\\s*scan|async-storage|supabase)\\b[\\s\\S]{0,80}?\\b(${STATUS_WORDS})\\b|\\b(${STATUS_WORDS})\\b[\\s\\S]{0,60}?\\b(ocr|voice|speech|receipt\\s*scan)\\b`,
      "i"
    );
    const fm = line.match(featRe);
    if (fm) {
      const feature = (fm[1] || fm[4] || "").toLowerCase();
      const statusWord = (fm[2] || fm[3] || "")
        .toLowerCase()
        .replace(/complete|done/, "implemented");
      const matchRow = reqRows.find((r) => {
        const t = String(r.text || "").toLowerCase();
        if (/ocr|receipt|scan/.test(feature)) return /\bocr\b|receipt|scan/.test(t);
        if (/voice|speech/.test(feature)) return /\bvoice\b|speech|microphone/.test(t);
        if (/supabase/.test(feature)) return /supabase/.test(t);
        if (/async-storage/.test(feature))
          return /async.?storage|offline|persist/.test(t);
        return false;
      });
      if (matchRow && statusWord !== matchRow.status.toLowerCase()) {
        issues.push({
          kind: "prose_rtm_mismatch",
          detail: `prose says ${feature}=${statusWord} but RTM ${matchRow.id} is ${matchRow.status}: ${line.trim().slice(0, 160)}`,
        });
      }
    }
  }
  return issues;
}

export function runStrategyConsistencyChecks(
  strategy: string,
  grounded: ConsistencyGrounding
): { ok: boolean; issues: ConsistencyIssue[] } {
  const text = String(strategy || "");
  const issues: ConsistencyIssue[] = [];

  if (!/##\s*Requirements traceability \(deterministic\)/i.test(text)) {
    issues.push({ kind: "missing_rtm", detail: "missing deterministic RTM section" });
  }
  if (!/##\s*Key Findings\b/i.test(text)) {
    issues.push({
      kind: "missing_key_findings",
      detail: "missing deterministic Key Findings section",
    });
  }
  if (!/##\s*REQ status index \(deterministic/i.test(text)) {
    issues.push({
      kind: "missing_rtm",
      detail: "missing deterministic REQ status index",
    });
  }

  const rtmMatch = text.match(
    /##\s*Requirements traceability \(deterministic\)[\s\S]*?(?=\n##\s(?!Requirements traceability)|\n#\s|$)/i
  )?.[0];
  const tableRows = (rtmMatch || "").match(/\|\s*REQ[-_]?\d+/gi)?.length || 0;
  const expected = (grounded.reqRows || []).length;
  if (expected > 0 && tableRows !== expected) {
    issues.push({
      kind: "rtm_row_count",
      detail: `RTM table has ${tableRows} REQ rows but reqTrace has ${expected}`,
    });
  }

  const depFindings = (grounded.checklistFindings || []).filter(
    (f) =>
      f.severity === "P0" &&
      (f.category === "dependency" || /^DEP-/i.test(f.id || ""))
  );
  for (const f of depFindings) {
    if (!text.includes(f.id)) {
      issues.push({
        kind: "missing_dep_finding",
        detail: `P0 dependency ${f.id} missing from strategy Key Findings`,
      });
    }
  }
  if (depFindings.length > 0 && !/`package\.json`|package\.json/i.test(text)) {
    issues.push({
      kind: "missing_dep_finding",
      detail: "dependency P0s lack package.json citation in strategy",
    });
  }

  if (/\.\.\.\(\s*truncated/i.test(text)) {
    issues.push({
      kind: "truncation_marker",
      detail: "truncation marker present in written strategy",
    });
  }

  if (hasStructuralMarkdownHoles(text)) {
    issues.push({
      kind: "empty_section",
      detail: "structural markdown holes (empty sections/bullets)",
    });
  }

  issues.push(...findProseStatusMismatches(text, grounded.reqRows || []));

  const coverage: GroundedCoverage | null =
    typeof grounded.eligibleCount === "number" &&
    grounded.eligibleCount > 0 &&
    typeof grounded.codeBackedCount === "number"
      ? {
          coverageRatio:
            typeof grounded.coverageRatio === "number" ? grounded.coverageRatio : 0,
          codeBackedCount: grounded.codeBackedCount,
          eligibleCount: grounded.eligibleCount,
        }
      : null;

  const groundedReqRows: GroundedReqRow[] = (grounded.reqRows || []).map((r) => ({
    id: r.id,
    status: r.status,
    codePaths: r.codePaths,
  }));

  const claims = detectInvalidClaims(
    text,
    grounded.targetRepo || process.cwd(),
    grounded.groundedCurrency || "EGP",
    groundedReqRows,
    coverage
  );
  for (const inv of claims.invalid) {
    if (inv.kind === "invalid_coverage") {
      issues.push({ kind: "coverage_mismatch", detail: inv.detail });
    } else if (inv.kind === "invalid_req_status") {
      issues.push({ kind: "prose_rtm_mismatch", detail: inv.detail });
    } else if (inv.kind === "invalid_currency") {
      issues.push({ kind: "claim_residue", detail: inv.detail });
    }
    // invalid_path: file:line and cross-root spec cites are handled by
    // verifyCitationsAgainstRepo / auditor gates — not consistency pre-check
  }

  if (/\[REMOVED\]/i.test(text)) {
    issues.push({
      kind: "claim_residue",
      detail: "forbidden [REMOVED] residue in strategy",
    });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Deterministically repair strategy: strip model-owned claims, reinject RTM /
 * Key Findings / status index, normalize markdown.
 */
export function repairStrategyDeterministically(
  strategy: string,
  grounded: ConsistencyGrounding
): string {
  let body = stripModelOwnedClaims(strategy);
  body = body.replace(
    /##\s*REQ status index \(deterministic[\s\S]*?(?=\n##\s|\n#\s|$)/gi,
    ""
  );

  body = injectGroundedStrategyBlocks(body, {
    checklistFindings: grounded.checklistFindings || [],
    reqRows: grounded.reqRows || [],
    coverageRatio: grounded.coverageRatio,
    eligibleCount: grounded.eligibleCount,
    codeBackedCount: grounded.codeBackedCount,
    groundedCurrency: grounded.groundedCurrency,
  });

  // injectGroundedStrategyBlocks already adds status index; ensure present
  if (!/##\s*REQ status index \(deterministic/i.test(body)) {
    const statusIndex = buildDeterministicReqStatusIndex(grounded.reqRows || []);
    body = body.replace(
      /##\s*Requirements traceability \(deterministic\)/i,
      `${statusIndex.trim()}\n\n## Requirements traceability (deterministic)`
    );
  }

  body = normalizeMarkdownStructure(body);
  if (hasStructuralMarkdownHoles(body)) {
    body = normalizeMarkdownStructure(body);
  }
  return stripTruncationMarkers(body);
}
