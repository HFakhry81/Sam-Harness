import type { AppLocale } from "./types.js";
import { dirForLocale, isRtlLocale } from "./config.js";

/** Unicode RTL/LTR marks used in mixed documents. */
export const RLM = "\u200F";
export const LRM = "\u200E";
export const RLE = "\u202B";
export const PDF = "\u202C";

/** HTML attributes for the document element. */
export function htmlDirAttrs(locale: AppLocale): { lang: string; dir: "rtl" | "ltr" } {
  return {
    lang: locale === "ar" ? "ar-EG" : "en",
    dir: dirForLocale(locale),
  };
}

/**
 * Wrap plain text so Arabic/RTL segments render correctly in LTR hosts
 * (terminals, some Markdown previewers).
 */
export function wrapRtlText(text: string, locale: AppLocale = "ar"): string {
  if (!isRtlLocale(locale) || !text) return text;
  return `${RLM}${text}${RLM}`;
}

/**
 * Markdown document header for Arabic reports — sets dir + font hints.
 * Safe to prepend to generated .md under SAM_OUTPUT_HOME.
 */
export function arabicMarkdownPreamble(opts?: {
  title?: string;
  numerals?: "eastern" | "western";
}): string {
  const title = opts?.title || "تقرير Sam-Harness";
  const numerals = opts?.numerals || "eastern";
  return [
    `<!-- sam-harness:locale=ar dir=rtl numerals=${numerals} -->`,
    `<div dir="rtl" lang="ar-EG" style="font-family:'Segoe UI','Noto Naskh Arabic','Amiri','Readex Pro',Tahoma,sans-serif; text-align:right;">`,
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

export function arabicMarkdownEpilogue(): string {
  return ["", "</div>", ""].join("\n");
}

/**
 * CSS snippets helpers for logical properties — used by tests / docs.
 * Prefer inset-inline / margin-inline over left/right in new CSS.
 */
export function rtlLogicalHints(): Record<string, string> {
  return {
    "text-align-start": "text-align: start",
    "margin-inline-start": "margin-inline-start",
    "padding-inline-end": "padding-inline-end",
    "border-inline-start": "border-inline-start",
  };
}

/** Detect if a string contains Arabic script (for intent / mixed docs). */
export function containsArabicScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text || "");
}

/** Detect Latin letters of length ≥3 (for mixed locale). */
export function containsLatinWord(text: string): boolean {
  return /[A-Za-z]{3,}/.test(text || "");
}

export function detectTextLocale(text: string): AppLocale | "mixed" {
  const ar = containsArabicScript(text);
  const en = containsLatinWord(text);
  if (ar && en) return "mixed";
  if (ar) return "ar";
  return "en";
}
