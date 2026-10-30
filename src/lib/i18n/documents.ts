import type { AppLocale, NumeralSystem } from "./types.js";
import { loadLocaleConfig } from "./config.js";
import { formatNumber } from "./format.js";
import {
  arabicMarkdownEpilogue,
  arabicMarkdownPreamble,
  wrapRtlText,
} from "./rtl.js";

export type DocumentRenderOpts = {
  locale?: AppLocale;
  numerals?: NumeralSystem;
  title?: string;
};

/**
 * Render a plain-text / Markdown report body with locale-aware RTL wrapper
 * and optional eastern numerals in numeric tokens.
 */
export function renderLocalizedDocument(
  body: string,
  opts: DocumentRenderOpts = {}
): string {
  const cfg = loadLocaleConfig();
  const locale = opts.locale ?? cfg.contentLocale;
  const numerals = opts.numerals ?? cfg.numerals;

  let text = body;
  if (numerals === "eastern") {
    // Only reshape standalone numbers / simple decimals — leave code fences alone.
    const parts = text.split(/(```[\s\S]*?```)/g);
    text = parts
      .map((part, i) => {
        if (i % 2 === 1) return part; // code fence
        return part.replace(/\b\d+(?:\.\d+)?\b/g, (n) => formatNumber(n, { numerals }));
      })
      .join("");
  }

  if (locale !== "ar") {
    return text;
  }

  const title = opts.title;
  return (
    arabicMarkdownPreamble({ title, numerals }) +
    text.replace(/^\s*#\s+.+\n?/, "") + // drop duplicate H1 if preamble adds one
    arabicMarkdownEpilogue()
  );
}

/** Short bilingual label for evidence / trust reports. */
export function evidenceHeading(locale: AppLocale, runId: string): string {
  if (locale === "ar") {
    return wrapRtlText(`أدلة التشغيل — ${runId}`, "ar");
  }
  return `Run evidence — ${runId}`;
}

export function documentFontStack(locale: AppLocale): string {
  if (locale === "ar") {
    return "'Segoe UI','Noto Naskh Arabic','Amiri','Readex Pro',Tahoma,sans-serif";
  }
  return "ui-sans-serif,system-ui,sans-serif";
}
