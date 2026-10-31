/**
 * Verify that cited paths in strategy/audit reports exist on disk.
 * Reject / strip invented packages/*, apps/web, wrong currency (SAR vs EGP).
 */
import * as fs from "fs";
import * as path from "path";

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

export type SanitizeDraftResult = {
  text: string;
  removedPaths: string[];
  removedCurrencies: string[];
  flags: string[];
};

const PATH_IN_BACKTICKS = /`([^`]+)`/g;
const PATHISH =
  /(?:^|[\s(])((?:packages|apps|src|docs|lib|scripts|config)\/[A-Za-z0-9_./\-]+)/g;

/** Bare invented roots that must exist as directories if claimed. */
const BARE_ROOTS = /\b(packages|apps\/web|apps\/mobile)\b/gi;

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
  // Also catch bare packages/ or apps/web mentions
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

/**
 * Strip or flag nonexistent path claims and wrong currency codes.
 * groundedCurrency defaults to EGP for Egyptian owner profile.
 */
export function sanitizeDraftClaims(
  text: string,
  targetRepo: string,
  groundedCurrency = "EGP"
): SanitizeDraftResult {
  let out = String(text || "");
  const removedPaths: string[] = [];
  const removedCurrencies: string[] = [];
  const flags: string[] = [];
  const verify = verifyCitationsAgainstRepo(out, targetRepo);

  for (const miss of verify.missing) {
    removedPaths.push(miss.raw);
    // Remove backtick citations
    const bt = new RegExp(
      "`" + miss.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "`",
      "gi"
    );
    out = out.replace(bt, "`[REMOVED: path not found]`");
    // Remove bare mentions of packages/ apps/web
    if (/^(packages|apps\/)/i.test(miss.raw)) {
      const bare = new RegExp(
        "\\b" + miss.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
        "gi"
      );
      out = out.replace(bare, "[REMOVED: path not found]");
    }
  }

  // Currency: remove/replace non-grounded ISO codes that conflict
  const currencyRe = /\b(SAR|USD|AED|QAR|KWD|BHD|OMR)\b/g;
  out = out.replace(currencyRe, (code) => {
    if (code.toUpperCase() === groundedCurrency.toUpperCase()) return code;
    removedCurrencies.push(code);
    return groundedCurrency;
  });
  // Also catch "Saudi Riyal" style
  if (/saudi\s*riyal|ريال\s*سعودي/i.test(out) && groundedCurrency === "EGP") {
    out = out.replace(/saudi\s*riyal/gi, "Egyptian Pound (EGP)");
    out = out.replace(/ريال\s*سعودي/g, "جنيه مصري (EGP)");
    removedCurrencies.push("Saudi Riyal");
  }

  if (removedPaths.length) {
    flags.push(`stripped ${removedPaths.length} nonexistent path claim(s)`);
  }
  if (removedCurrencies.length) {
    flags.push(
      `replaced ${removedCurrencies.length} currency mention(s) with ${groundedCurrency}`
    );
  }
  if (flags.length) {
    out +=
      `\n\n<!-- CLAIM_SANITIZER: ${flags.join("; ")}; removedPaths=${removedPaths
        .slice(0, 8)
        .join(",")} -->\n`;
  }

  return { text: out, removedPaths, removedCurrencies, flags };
}
