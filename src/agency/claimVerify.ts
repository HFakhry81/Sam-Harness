/**
 * Verify cited paths exist on disk. Detect invalid claims (invented paths,
 * wrong currency). Never insert [REMOVED] placeholders or auto-substitute
 * currency — rewrite via writer, then delete offending sentences cleanly.
 */
import * as fs from "fs";
import * as path from "path";
import type { ModelClaimError } from "./gatesStore.js";

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
  kind: "invalid_path" | "invalid_currency";
  claim: string;
  detail: string;
  /** Approximate sentence containing the claim (for deletion). */
  sentence?: string;
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
const BAD_CURRENCY = /\b(SAR|USD|AED|QAR|KWD|BHD|OMR)\b/g;

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
  groundedCurrency = "EGP"
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

  const currencyRe = new RegExp(BAD_CURRENCY.source, "g");
  let m: RegExpExecArray | null;
  const seenCur = new Set<string>();
  while ((m = currencyRe.exec(text))) {
    const code = m[1].toUpperCase();
    if (code === groundedCurrency.toUpperCase()) continue;
    if (seenCur.has(code)) continue;
    seenCur.add(code);
    invalid.push({
      kind: "invalid_currency",
      claim: code,
      detail: `currency ${code} conflicts with grounded ${groundedCurrency} — do not invent; rewrite using ${groundedCurrency}`,
      sentence: sentenceContaining(text, code),
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
    } else if (inv.kind === "invalid_currency") {
      const lineRe = new RegExp(
        `^.*\\b${inv.claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b.*$\n?`,
        "gmi"
      );
      const before = out;
      out = out.replace(lineRe, "");
      if (out !== before) deleted.push(`line containing ${inv.claim}`);
    }
  }
  // Clean leftover blank runs — never insert [REMOVED]
  out = out.replace(/\n{3,}/g, "\n\n").trim() + (out.trim() ? "\n" : "");
  return { text: out, deleted };
}

/** Build a rewrite prompt for the strategist with grounded facts. */
export function buildClaimRewritePrompt(input: {
  draft: string;
  invalid: InvalidClaim[];
  groundedCurrency: string;
  evidenceClip: string;
}): string {
  const list = input.invalid
    .map((i, n) => `${n + 1}. [${i.kind}] ${i.claim} — ${i.detail}`)
    .join("\n");
  return `REWRITE REQUIRED — your draft contains invalid claims. Fix them using grounded facts only.

INVALID CLAIMS (must not appear in the rewrite):
${list}

GROUNDED CURRENCY: ${input.groundedCurrency} (never write SAR/USD/AED unless that is the grounded currency)
Cite ONLY paths that exist in EVIDENCE. Do not mention packages/ or apps/web unless those folders exist.
Do NOT write the tokens [REMOVED] or REMOVED.

EVIDENCE (real paths only):
${input.evidenceClip}

PRIOR DRAFT:
${input.draft.slice(0, 6000)}

Return the full corrected strategy.`;
}

/**
 * Detect invalid claims and prepare rewrite / clean-delete.
 * Does NOT auto-substitute currency. Does NOT insert [REMOVED] placeholders.
 */
export function sanitizeDraftClaims(
  text: string,
  targetRepo: string,
  groundedCurrency = "EGP"
): SanitizeDraftResult {
  const detected = detectInvalidClaims(text, targetRepo, groundedCurrency);
  const removedPaths = detected.invalid
    .filter((i) => i.kind === "invalid_path")
    .map((i) => i.claim);
  const removedCurrencies = detected.invalid
    .filter((i) => i.kind === "invalid_currency")
    .map((i) => i.claim);
  const modelErrors: ModelClaimError[] = detected.invalid.map((i) => ({
    at: new Date().toISOString(),
    kind: i.kind,
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
    }),
  };
}

/**
 * After rewrite attempts exhausted: clean-delete offending sentences (no placeholders).
 */
export function finalizeClaimsClean(
  text: string,
  targetRepo: string,
  groundedCurrency = "EGP"
): SanitizeDraftResult {
  const detected = detectInvalidClaims(text, targetRepo, groundedCurrency);
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
  const cleaned = deleteClaimSentences(text, detected.invalid);
  const again = detectInvalidClaims(cleaned.text, targetRepo, groundedCurrency);
  // Second pass on leftovers
  const cleaned2 = again.ok
    ? cleaned
    : deleteClaimSentences(cleaned.text, again.invalid);
  const finalCheck = detectInvalidClaims(cleaned2.text, targetRepo, groundedCurrency);
  // Absolute ban: strip any leftover [REMOVED] if a prior version left them
  let finalText = cleaned2.text.replace(/\s*\[REMOVED[^\]]*\]\s*/gi, " ");
  finalText = finalText.replace(/\n{3,}/g, "\n\n").trim() + "\n";

  return {
    text: finalText,
    removedPaths: detected.invalid
      .filter((i) => i.kind === "invalid_path")
      .map((i) => i.claim),
    removedCurrencies: detected.invalid
      .filter((i) => i.kind === "invalid_currency")
      .map((i) => i.claim),
    flags: [
      `clean-deleted ${detected.invalid.length} invalid claim sentence(s)`,
      finalCheck.ok ? "clean" : "residual claims remain after delete",
    ],
    invalid: finalCheck.invalid,
    modelErrors: detected.invalid.map((i) => ({
      at: new Date().toISOString(),
      kind: i.kind,
      claim: i.claim,
      detail: i.detail,
    })),
    needsRewrite: !finalCheck.ok,
  };
}
