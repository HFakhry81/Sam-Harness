import type { DetectedLanguage } from "./types.js";

const ARABIC_RE = /[\u0600-\u06FF]/;
const LATIN_WORD_RE = /[A-Za-z]{2,}/;

/** Detect dominant user language for reply matching. */
export function detectUserLanguage(text: string): DetectedLanguage {
  const t = String(text || "");
  const ar = ARABIC_RE.test(t);
  const en = LATIN_WORD_RE.test(t);
  if (ar && en) return "mixed";
  if (ar) return "ar";
  if (en) return "en";
  return "other";
}

/** Short system directive: reply in the user's language, no status dumps. */
export function languageReplyDirective(lang: DetectedLanguage): string {
  switch (lang) {
    case "ar":
      return [
        "Reply ONLY in Arabic (natural, short Egyptian-friendly phrasing is fine).",
        "Do NOT dump system status, pipelines, models, health checks, or JSON.",
        "Be brief and conversational.",
      ].join(" ");
    case "en":
      return [
        "Reply ONLY in English.",
        "Do NOT dump system status, pipelines, models, health checks, or JSON.",
        "Be brief and conversational.",
      ].join(" ");
    case "mixed":
      return [
        "Mirror the user's language mix; prefer Arabic if most of the message is Arabic, otherwise English.",
        "Do NOT dump system status, pipelines, models, health checks, or JSON.",
        "Be brief and conversational.",
      ].join(" ");
    default:
      return [
        "Reply in the same language as the user.",
        "Do NOT dump system status, pipelines, models, health checks, or JSON.",
        "Be brief and conversational.",
      ].join(" ");
  }
}

/** Soft check that a reply is mostly Arabic when expected. */
export function replyMatchesLanguage(
  reply: string,
  expected: DetectedLanguage
): boolean {
  const lang = detectUserLanguage(reply);
  if (expected === "ar") return lang === "ar" || lang === "mixed";
  if (expected === "en") return lang === "en" || lang === "mixed";
  return true;
}
