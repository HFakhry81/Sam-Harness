/**
 * Verify cited paths exist on disk. Detect invalid claims (invented paths,
 * wrong currency, hallucinated Implemented status). Never insert [REMOVED]
 * placeholders or auto-substitute currency — rewrite via writer, then delete
 * offending sentences cleanly and normalize markdown structure.
 */
import * as fs from "fs";
import * as path from "path";
import type { ModelClaimError } from "./gatesStore.js";
import { normalizeMarkdownStructure } from "./markdownNormalize.js";
import { clipStrategyForPrompt } from "./finalReport.js";

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

export type InvalidClaim = {
  kind: "invalid_path" | "invalid_currency" | "invalid_req_status";
  claim: string;
  detail: string;
  /** Approximate sentence containing the claim (for deletion). */
  sentence?: string;
};

export type GroundedReqRow = {
  id: string;
  status: string;
  codePaths?: string[];
};

export type DetectClaimsResult = {
  invalid: InvalidClaim[];
  ok: boolean;
};

export type SanitizeDraftResult = {
  text: string;
  removedPaths: string[];
  removedCurrencies: string[];
  flags: string[];
  invalid: InvalidClaim[];
  modelErrors: ModelClaimError[];
  /** True when text still has forbidden residues after clean delete. */
  needsRewrite: boolean;
  rewritePrompt?: string;
};

const PATH_IN_BACKTICKS = /`([^`]+)`/g;
const PATHISH =
  /(?:^|[\s(])((?:packages|apps|src|docs|lib|scripts|config)\/[A-Za-z0-9_./\-]+)/g;
const BARE_ROOTS = /\b(packages\/[^\s`'",.]+|apps\/web(?:\/[^\s`'",.]*)?|apps\/mobile(?:\/[^\s`'",.]*)?)\b/gi;
/** Non-grounded ISO codes commonly hallucinated; matched case-insensitively. */
export const FORBIDDEN_CURRENCY_ALTERNATES =
  "SAR|USD|AED|QAR|KWD|BHD|OMR|EUR|GBP";
const BAD_CURRENCY = new RegExp(`\\b(${FORBIDDEN_CURRENCY_ALTERNATES})\\b`, "gi");

export const MAX_CLAIM_REWRITES = 2;

/** True when token is a forbidden currency relative to the grounded code. */
export function isForbiddenCurrencyToken(
  token: string,
  groundedCurrency = "EGP"
): boolean {
  const code = String(token || "").toUpperCase();
  const grounded = String(groundedCurrency || "EGP").toUpperCase();
  if (!code || code === grounded) return false;
  return new RegExp(`^(?:${FORBIDDEN_CURRENCY_ALTERNATES})$`, "i").test(code);
}

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
  const bare = new RegExp(BARE_ROOTS.source, "gi");
  while ((m = bare.exec(text))) {
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
    if (/^https?:/i.test(raw)) continue;
    if (!/[\\/]/.test(raw) && !/\.\w+$/.test(raw) && !/^(packages|apps)/i.test(raw)) {
      continue;
    }
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

/** Split text into sentences (simple; good enough for claim deletion). */
export function splitSentences(text: string): string[] {
  const parts = String(text || "").split(/(?<=[.!?\n])\s+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Spec-doc paths are not code evidence for an Implemented status. */
export function isSpecOnlyCitation(raw: string): boolean {
  const p = String(raw || "").replace(/\\/g, "/").toLowerCase();
  if (!p) return true;
  if (/\.(docx?|pdf|pptx?)$/i.test(p)) return true;
  if (/requirements?\.md$/i.test(p)) return true;
  if (/(^|\/)(specs?|docs|documents?|brief)(\/|$)/i.test(p) && !/\.(m?[jt]sx?|jsx?)$/i.test(p)) {
    return true;
  }
  // Code evidence
  if (/(^|\/)src\//i.test(p) || /\.(m?[jt]sx?|jsx?|json)$/i.test(p)) return false;
  if (/package\.json/i.test(p)) return false;
  return !/[\\/]/.test(p); // bare words → treat as non-code
}

function extractInlineCitations(chunk: string): string[] {
  const out: string[] = [];
  const bt = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = bt.exec(chunk))) {
    const p = m[1].trim();
    if (/[\\/]/.test(p) || /\.\w{1,5}$/.test(p)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/**
 * Reject "Implemented" claims whose only citations are spec files, or that
 * contradict the grounded RTM status for that REQ.
 */
export function detectHallucinatedImplementedStatus(
  text: string,
  groundedRows: GroundedReqRow[] = []
): InvalidClaim[] {
  const invalid: InvalidClaim[] = [];
  const byId = new Map(
    groundedRows.map((r) => [r.id.toUpperCase(), r] as const)
  );
  const lines = String(text || "").split(/\r?\n/);
  const implRe =
    /\b(REQ[-_]?\d+)\b[\s\S]{0,120}?\b(implemented|complete|done)\b|\b(implemented|complete|done)\b[\s\S]{0,80}?\b(REQ[-_]?\d+)\b/i;

  for (const line of lines) {
    // Skip the deterministic RTM block we inject (authoritative)
    if (/^\|\s*REQ/i.test(line) && /\|\s*(missing|partial|implemented|contradicts)\s*\|/i.test(line)) {
      continue;
    }
    const m = line.match(implRe);
    if (!m) continue;
    const reqId = (m[1] || m[4] || "").toUpperCase().replace(/_/g, "-");
    if (!/^REQ-\d+/i.test(reqId) && !/^REQ\d+/i.test(reqId)) continue;
    const normalized = reqId.includes("-")
      ? reqId
      : reqId.replace(/^REQ/i, "REQ-");
    const statusWord = (m[2] || m[3] || "").toLowerCase();
    if (!/implemented|complete|done/i.test(statusWord)) continue;

    const grounded = byId.get(normalized) || byId.get(reqId);
    if (grounded && !/^implemented$/i.test(grounded.status)) {
      invalid.push({
        kind: "invalid_req_status",
        claim: `${normalized}=Implemented`,
        detail: `REQ ${normalized} marked Implemented but grounded RTM status is ${grounded.status}`,
        sentence: line.trim(),
      });
      continue;
    }

    const cites = extractInlineCitations(line);
    const codeCites = cites.filter((c) => !isSpecOnlyCitation(c));
    if (cites.length > 0 && codeCites.length === 0) {
      invalid.push({
        kind: "invalid_req_status",
        claim: `${normalized}=Implemented(spec-only)`,
        detail: `Implemented status for ${normalized} cites only spec files (${cites.join(", ")}); require code evidence paths`,
        sentence: line.trim(),
      });
      continue;
    }
    // "Implemented" with zero citations while grounded says missing/partial
    if (
      cites.length === 0 &&
      grounded &&
      /^(missing|partial|contradicts)$/i.test(grounded.status)
    ) {
      invalid.push({
        kind: "invalid_req_status",
        claim: `${normalized}=Implemented`,
        detail: `Implemented claim for ${normalized} has no code citation; grounded status=${grounded.status}`,
        sentence: line.trim(),
      });
    }
  }
  return invalid;
}

function sentenceContaining(text: string, claim: string): string | undefined {
  const lowerClaim = claim.toLowerCase();
  for (const sent of splitSentences(text)) {
    if (sent.toLowerCase().includes(lowerClaim)) return sent;
  }
  // Also try line-based
  for (const line of text.split(/\r?\n/)) {
    if (line.toLowerCase().includes(lowerClaim)) return line.trim();
  }
  return undefined;
}

/**
 * Detect invalid claims without mutating text.
 */
export function detectInvalidClaims(
  text: string,
  targetRepo: string,
  groundedCurrency = "EGP",
  groundedReqRows: GroundedReqRow[] = []
): DetectClaimsResult {
  const invalid: InvalidClaim[] = [];
  const verify = verifyCitationsAgainstRepo(text, targetRepo);
  for (const miss of verify.missing) {
    invalid.push({
      kind: "invalid_path",
      claim: miss.raw,
      detail: `path does not exist under ${targetRepo}`,
      sentence: sentenceContaining(text, miss.raw),
    });
  }

  const currencyRe = new RegExp(BAD_CURRENCY.source, BAD_CURRENCY.flags);
  let m: RegExpExecArray | null;
  const seenCur = new Set<string>();
  while ((m = currencyRe.exec(text))) {
    const code = m[1].toUpperCase();
    if (!isForbiddenCurrencyToken(code, groundedCurrency)) continue;
    if (seenCur.has(code)) continue;
    seenCur.add(code);
    // Prefer the exact matched casing for sentence lookup (tables/code spans included)
    const matched = m[0];
    invalid.push({
      kind: "invalid_currency",
      claim: code,
      detail: `currency ${code} conflicts with grounded ${groundedCurrency} — do not invent; rewrite using ${groundedCurrency}`,
      sentence:
        sentenceContaining(text, matched) ||
        sentenceContaining(text, code) ||
        sentenceContaining(text, code.toLowerCase()),
    });
  }
  if (/saudi\s*riyal|ريال\s*سعودي/i.test(text) && groundedCurrency === "EGP") {
    invalid.push({
      kind: "invalid_currency",
      claim: "Saudi Riyal",
      detail: `use grounded currency ${groundedCurrency}`,
      sentence: sentenceContaining(text, "Saudi") || sentenceContaining(text, "ريال"),
    });
  }

  for (const h of detectHallucinatedImplementedStatus(text, groundedReqRows)) {
    invalid.push(h);
  }

  return { invalid, ok: invalid.length === 0 };
}

/**
 * Delete sentences that contain invalid claims — no placeholders.
 */
export function deleteClaimSentences(
  text: string,
  invalid: InvalidClaim[]
): { text: string; deleted: string[] } {
  let out = String(text || "");
  const deleted: string[] = [];
  for (const inv of invalid) {
    if (inv.kind === "invalid_currency") {
      // Wipe EVERY line / table row / list item / code-span line that carries
      // the token (case-insensitive). Do not stop after one sentence — SAR can
      // reappear in tables and `sar` spans in the same document.
      const token = inv.claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const lineRe = new RegExp(`^.*\\b${token}\\b.*$\\n?`, "gmi");
      const before = out;
      out = out.replace(lineRe, "");
      if (out !== before) deleted.push(`lines containing ${inv.claim}`);
      for (const chunk of splitSentences(out)) {
        if (new RegExp(`\\b${token}\\b`, "i").test(chunk) && chunk.length >= 3) {
          out = out.split(chunk).join("");
          deleted.push(chunk.slice(0, 160));
        }
      }
      continue;
    }

    const sent = inv.sentence;
    if (sent && sent.length >= 8 && out.includes(sent)) {
      out = out.replace(sent, "");
      deleted.push(sent.slice(0, 160));
      continue;
    }
    // Fallback: remove backtick path or bare claim token from its line
    if (inv.kind === "invalid_path") {
      const lineRe = new RegExp(
        `^.*(?:\`${inv.claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`|\\b${inv.claim
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\//g, "\\/")}\\b).*$\n?`,
        "gmi"
      );
      const before = out;
      out = out.replace(lineRe, "");
      if (out !== before) deleted.push(`line containing ${inv.claim}`);
    } else if (inv.kind === "invalid_req_status") {
      const sent = inv.sentence;
      if (sent && out.includes(sent)) {
        out = out.replace(sent, "");
        deleted.push(sent.slice(0, 160));
      } else {
        const lineRe = new RegExp(
          `^.*${inv.claim.split("=")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$\\n?`,
          "gmi"
        );
        const before = out;
        out = out.replace(lineRe, "");
        if (out !== before) deleted.push(`line containing ${inv.claim}`);
      }
    }
  }
  // Normalize structure after deletions — never insert [REMOVED]
  out = normalizeMarkdownStructure(out);
  return { text: out, deleted };
}

/** Build a rewrite prompt for the strategist with grounded facts. */
export function buildClaimRewritePrompt(input: {
  draft: string;
  invalid: InvalidClaim[];
  groundedCurrency: string;
  evidenceClip: string;
  /** Prior auditor rejection issues — must be addressed explicitly. */
  priorAuditorIssues?: string[];
}): string {
  const list = input.invalid
    .map((i, n) => `${n + 1}. [${i.kind}] ${i.claim} — ${i.detail}`)
    .join("\n");
  const auditorBlock =
    input.priorAuditorIssues && input.priorAuditorIssues.length
      ? [
          ``,
          `PRIOR AUDITOR ISSUES (must fix each explicitly — no empty sections/bullets):`,
          ...input.priorAuditorIssues.map((x, i) => `${i + 1}. ${x}`),
          ``,
        ].join("\n")
      : "";
  return `REWRITE REQUIRED — your draft contains invalid claims. Fix them using grounded facts only.

INVALID CLAIMS (must not appear in the rewrite):
${list}
${auditorBlock}
GROUNDED CURRENCY: ${input.groundedCurrency} (never write SAR/USD/AED unless that is the grounded currency)
Cite ONLY paths that exist in EVIDENCE. Do not mention packages/ or apps/web unless those folders exist.
Do NOT write erasure placeholders (bracketed REMOVED tokens) or the bare word REMOVED as a stand-in.
Do NOT mark a REQ Implemented unless you cite real code paths (not only .docx / spec files).
Do NOT invent RTM coverage percentages — use the deterministic RTM block from evidence.
After edits, every heading must have content; no empty bullets; ordered lists must be contiguous 1..N.

EVIDENCE (real paths only):
${input.evidenceClip}

PRIOR DRAFT (deterministic RTM/Key Findings summarized — keep full blocks when writing the file):
${clipStrategyForPrompt(input.draft, 5000)}

Return the full corrected strategy. Re-include or leave room for the harness to re-inject the full deterministic RTM and Key Findings blocks.`;
}

function toModelErrorKind(
  kind: InvalidClaim["kind"]
): ModelClaimError["kind"] {
  if (kind === "invalid_path" || kind === "invalid_currency") return kind;
  return "other";
}

/**
 * Detect invalid claims and prepare rewrite / clean-delete.
 * Does NOT auto-substitute currency. Does NOT insert [REMOVED] placeholders.
 */
export function sanitizeDraftClaims(
  text: string,
  targetRepo: string,
  groundedCurrency = "EGP",
  groundedReqRows: GroundedReqRow[] = [],
  priorAuditorIssues: string[] = []
): SanitizeDraftResult {
  const detected = detectInvalidClaims(
    text,
    targetRepo,
    groundedCurrency,
    groundedReqRows
  );
  const removedPaths = detected.invalid
    .filter((i) => i.kind === "invalid_path")
    .map((i) => i.claim);
  const removedCurrencies = detected.invalid
    .filter((i) => i.kind === "invalid_currency")
    .map((i) => i.claim);
  const modelErrors: ModelClaimError[] = detected.invalid.map((i) => ({
    at: new Date().toISOString(),
    kind: toModelErrorKind(i.kind),
    claim: i.claim,
    detail: i.detail,
  }));

  if (detected.ok) {
    return {
      text,
      removedPaths: [],
      removedCurrencies: [],
      flags: [],
      invalid: [],
      modelErrors: [],
      needsRewrite: false,
    };
  }

  return {
    text, // unchanged until rewrite or clean delete
    removedPaths,
    removedCurrencies,
    flags: [
      `detected ${detected.invalid.length} invalid claim(s) — rewrite required (no auto-substitute)`,
    ],
    invalid: detected.invalid,
    modelErrors,
    needsRewrite: true,
    rewritePrompt: buildClaimRewritePrompt({
      draft: text,
      invalid: detected.invalid,
      groundedCurrency,
      evidenceClip: `(targetRepo=${targetRepo}; currency=${groundedCurrency})`,
      priorAuditorIssues,
    }),
  };
}

/**
 * After rewrite attempts exhausted: clean-delete offending sentences (no placeholders).
 */
export function finalizeClaimsClean(
  text: string,
  targetRepo: string,
  groundedCurrency = "EGP",
  groundedReqRows: GroundedReqRow[] = []
): SanitizeDraftResult {
  const detected = detectInvalidClaims(
    text,
    targetRepo,
    groundedCurrency,
    groundedReqRows
  );
  if (detected.ok) {
    return {
      text: normalizeMarkdownStructure(text),
      removedPaths: [],
      removedCurrencies: [],
      flags: [],
      invalid: [],
      modelErrors: [],
      needsRewrite: false,
    };
  }
  let current = text;
  let passes = 0;
  let lastInvalid = detected.invalid;
  while (passes < 4) {
    passes += 1;
    const round = detectInvalidClaims(
      current,
      targetRepo,
      groundedCurrency,
      groundedReqRows
    );
    if (round.ok) break;
    lastInvalid = round.invalid;
    current = deleteClaimSentences(current, round.invalid).text;
  }
  const finalCheck = detectInvalidClaims(
    current,
    targetRepo,
    groundedCurrency,
    groundedReqRows
  );
  // Absolute ban: strip any leftover [REMOVED] if a prior version left them
  let finalText = current.replace(/\s*\[REMOVED[^\]]*\]\s*/gi, " ");
  finalText = normalizeMarkdownStructure(finalText);

  return {
    text: finalText,
    removedPaths: lastInvalid
      .filter((i) => i.kind === "invalid_path")
      .map((i) => i.claim),
    removedCurrencies: lastInvalid
      .filter((i) => i.kind === "invalid_currency")
      .map((i) => i.claim),
    flags: [
      `clean-deleted invalid claim sentence(s) in ${passes} pass(es)`,
      finalCheck.ok ? "clean" : "residual claims remain after delete",
    ],
    invalid: finalCheck.invalid,
    modelErrors: detected.invalid.map((i) => ({
      at: new Date().toISOString(),
      kind: toModelErrorKind(i.kind),
      claim: i.claim,
      detail: i.detail,
    })),
    needsRewrite: !finalCheck.ok,
  };
}

/**
 * Detect → rewrite (max 2) → clean-delete. Never placeholders / never auto-sub currency.
 * `rewriteFn` is optional (tests / offline packs skip straight to clean-delete).
 */
export async function remediateInvalidClaims(
  text: string,
  targetRepo: string,
  groundedCurrency = "EGP",
  rewriteFn?: (prompt: string) => Promise<string>,
  maxRewrites = MAX_CLAIM_REWRITES,
  groundedReqRows: GroundedReqRow[] = [],
  priorAuditorIssues: string[] = []
): Promise<SanitizeDraftResult> {
  let current = String(text || "");
  let detected = sanitizeDraftClaims(
    current,
    targetRepo,
    groundedCurrency,
    groundedReqRows,
    priorAuditorIssues
  );
  if (!detected.needsRewrite) {
    return { ...detected, text: normalizeMarkdownStructure(current) };
  }

  if (rewriteFn) {
    for (let attempt = 0; attempt < maxRewrites && detected.needsRewrite; attempt++) {
      const prompt =
        detected.rewritePrompt ||
        buildClaimRewritePrompt({
          draft: current,
          invalid: detected.invalid,
          groundedCurrency,
          evidenceClip: `(targetRepo=${targetRepo}; currency=${groundedCurrency})`,
          priorAuditorIssues,
        });
      try {
        current = await rewriteFn(prompt);
        // Never accept an auto-substituted token swap as success without re-detect
        detected = sanitizeDraftClaims(
          current,
          targetRepo,
          groundedCurrency,
          groundedReqRows,
          priorAuditorIssues
        );
      } catch {
        break;
      }
    }
  }

  if (detected.needsRewrite) {
    return finalizeClaimsClean(
      current,
      targetRepo,
      groundedCurrency,
      groundedReqRows
    );
  }
  // Strip placeholders even when rewrite succeeded
  current = current.replace(/\s*\[REMOVED[^\]]*\]\s*/gi, " ");
  current = normalizeMarkdownStructure(current);
  return { ...detected, text: current, needsRewrite: false };
}
