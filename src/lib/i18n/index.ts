import type { AppLocale, LocaleConfig, MessageCatalog } from "./types.js";
import { loadLocaleConfig, dirForLocale, isRtlLocale, parseAppLocale } from "./config.js";
import { CATALOGS, missingTranslationKeys, catalogKeys, AR_MESSAGES, EN_MESSAGES } from "./messages.js";
import { interpolate } from "./format.js";

export type { AppLocale, LocaleConfig, MessageCatalog, NumeralSystem } from "./types.js";
export {
  loadLocaleConfig,
  parseAppLocale,
  parseNumerals,
  dirForLocale,
  langTagForLocale,
  isRtlLocale,
} from "./config.js";
export {
  AR_MESSAGES,
  EN_MESSAGES,
  CATALOGS,
  missingTranslationKeys,
  catalogKeys,
} from "./messages.js";
export {
  toEasternNumerals,
  toWesternNumerals,
  formatNumber,
  interpolate,
} from "./format.js";
export {
  RLM,
  LRM,
  htmlDirAttrs,
  wrapRtlText,
  arabicMarkdownPreamble,
  arabicMarkdownEpilogue,
  rtlLogicalHints,
  containsArabicScript,
  containsLatinWord,
  detectTextLocale,
} from "./rtl.js";
export {
  languageSystemDirective,
  withLanguageDirective,
  ARABIC_INTENT_CUES,
  matchesArabicIntent,
} from "./prompts.js";
export {
  renderLocalizedDocument,
  evidenceHeading,
  documentFontStack,
} from "./documents.js";

/** Translate a key for the given (or configured) locale; falls back to English then Arabic. */
export function t(
  key: string,
  opts?: {
    locale?: AppLocale;
    vars?: Record<string, string | number>;
    config?: LocaleConfig;
  }
): string {
  const cfg = opts?.config ?? loadLocaleConfig();
  const locale = opts?.locale ?? cfg.locale;
  const primary = CATALOGS[locale]?.[key];
  const fallback = locale === "ar" ? EN_MESSAGES[key] : AR_MESSAGES[key];
  const other = locale === "ar" ? AR_MESSAGES[key] : EN_MESSAGES[key];
  const raw = primary ?? fallback ?? other ?? key;
  return opts?.vars ? interpolate(raw, opts.vars) : raw;
}

/** Full catalog for a locale (for Control Plane `/api/i18n`). */
export function getMessages(locale?: AppLocale): MessageCatalog {
  const loc = locale ?? loadLocaleConfig().locale;
  return { ...CATALOGS[loc] };
}

/** Public locale payload for UI boot. */
export function getLocalePayload(env: NodeJS.ProcessEnv = process.env) {
  const config = loadLocaleConfig(env);
  return {
    ...config,
    messages: getMessages(config.locale),
    available: ["ar", "en"] as AppLocale[],
  };
}

/** Ensure catalogs have identical key sets. Throws if not. */
export function assertTranslationCoverage(): void {
  const { missingInAr, missingInEn } = missingTranslationKeys();
  if (missingInAr.length || missingInEn.length) {
    throw new Error(
      `i18n coverage gap: missingInAr=${missingInAr.join(",")} missingInEn=${missingInEn.join(",")}`
    );
  }
}
