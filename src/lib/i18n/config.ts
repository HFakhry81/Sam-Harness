import type { AppLocale, LocaleConfig, NumeralSystem } from "./types.js";

const VALID_LOCALES = new Set<AppLocale>(["ar", "en"]);

export function parseAppLocale(raw: string | undefined | null, fallback: AppLocale = "ar"): AppLocale {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "ar" || v === "arabic" || v === "العربية") return "ar";
  if (v === "en" || v === "english" || v === "eng") return "en";
  if (VALID_LOCALES.has(v as AppLocale)) return v as AppLocale;
  return fallback;
}

export function parseNumerals(raw: string | undefined | null, locale: AppLocale): NumeralSystem {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "eastern" || v === "arabic" || v === "ar-east") return "eastern";
  if (v === "western" || v === "latin" || v === "en") return "western";
  // Default: eastern digits for Arabic UI, western otherwise
  return locale === "ar" ? "eastern" : "western";
}

export function dirForLocale(locale: AppLocale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function langTagForLocale(locale: AppLocale): string {
  // Egyptian-friendly Arabic tag; English uses en
  return locale === "ar" ? "ar-EG" : "en";
}

/**
 * Load locale settings from env.
 *
 * - `SAM_LOCALE` — primary UI + content locale (default **ar**)
 * - `SAM_UI_LOCALE` — optional UI override
 * - `SAM_CONTENT_LOCALE` — optional agent/report override
 * - `SAM_NUMERALS` — eastern | western
 * - `SAM_EGYPTIAN_FRIENDLY` — 1 (default) soft Egyptian/MSA-friendly phrasing
 */
export function loadLocaleConfig(env: NodeJS.ProcessEnv = process.env): LocaleConfig {
  const locale = parseAppLocale(env.SAM_LOCALE, "ar");
  const ui = parseAppLocale(env.SAM_UI_LOCALE || env.SAM_LOCALE, locale);
  const content = parseAppLocale(env.SAM_CONTENT_LOCALE || env.SAM_LOCALE, locale);
  const egyptian =
    String(env.SAM_EGYPTIAN_FRIENDLY ?? "1").trim() === "0" ? false : true;
  return {
    locale: ui,
    contentLocale: content,
    dir: dirForLocale(ui),
    lang: langTagForLocale(ui),
    numerals: parseNumerals(env.SAM_NUMERALS, ui),
    egyptianFriendly: egyptian,
  };
}

export function isRtlLocale(locale: AppLocale): boolean {
  return locale === "ar";
}
