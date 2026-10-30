/**
 * Infer locale/currency from code signals + owner profile defaults (ar-EG / EGP).
 * Never invent SAR/USD from the model alone.
 */
import type { RepoIndexResult } from "./repoIndex.js";

export type LocaleCurrencyProfile = {
  locale: string;
  currency: string;
  source: "code" | "owner_default" | "mixed";
  evidence: string[];
};

const OWNER_DEFAULT_LOCALE = String(process.env.SAM_OWNER_LOCALE || "ar-EG").trim() || "ar-EG";
const OWNER_DEFAULT_CURRENCY =
  String(process.env.SAM_OWNER_CURRENCY || "EGP").trim() || "EGP";

export function inferLocaleCurrency(index: RepoIndexResult): LocaleCurrencyProfile {
  const evidence: string[] = [];
  let currency = "";
  let locale = "";

  if (index.currencies.includes("EGP")) {
    currency = "EGP";
    evidence.push("code references EGP");
  } else if (index.currencies.length === 1) {
    currency = index.currencies[0];
    evidence.push(`code references ${currency}`);
  } else if (index.currencies.length > 1) {
    // Prefer EGP when present among multiples; else first
    currency = index.currencies.includes("EGP") ? "EGP" : index.currencies[0];
    evidence.push(`code references multiple currencies: ${index.currencies.join(",")}`);
  }

  if (index.locales.includes("ar-EG")) {
    locale = "ar-EG";
    evidence.push("code locale ar-EG");
  } else if (index.locales.find((l) => l.startsWith("ar"))) {
    locale = index.locales.find((l) => l.startsWith("ar"))!;
    evidence.push(`code locale ${locale}`);
  } else if (index.locales[0]) {
    locale = index.locales[0];
    evidence.push(`code locale ${locale}`);
  }

  if (!currency && !locale) {
    return {
      locale: OWNER_DEFAULT_LOCALE,
      currency: OWNER_DEFAULT_CURRENCY,
      source: "owner_default",
      evidence: [
        `owner default locale=${OWNER_DEFAULT_LOCALE} currency=${OWNER_DEFAULT_CURRENCY}`,
      ],
    };
  }

  if (!currency) {
    currency = OWNER_DEFAULT_CURRENCY;
    evidence.push(`currency defaulted to owner ${OWNER_DEFAULT_CURRENCY}`);
  }
  if (!locale) {
    locale = OWNER_DEFAULT_LOCALE;
    evidence.push(`locale defaulted to owner ${OWNER_DEFAULT_LOCALE}`);
  }

  return {
    locale,
    currency,
    source: evidence.some((e) => e.startsWith("owner") || e.includes("defaulted"))
      ? "mixed"
      : "code",
    evidence,
  };
}

export function localeCurrencyMarkdown(profile: LocaleCurrencyProfile): string {
  return [
    `# Locale / currency (grounded)`,
    ``,
    `- locale: **${profile.locale}**`,
    `- currency: **${profile.currency}**`,
    `- source: ${profile.source}`,
    ...profile.evidence.map((e) => `- evidence: ${e}`),
    ``,
    `Do NOT invent a different currency (e.g. SAR) unless code evidence shows it.`,
    ``,
  ].join("\n");
}
