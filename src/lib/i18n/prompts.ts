import type { AppLocale } from "./types.js";
import { loadLocaleConfig } from "./config.js";
import { detectTextLocale } from "./rtl.js";

function resolveReplyLocale(opts?: {
  locale?: AppLocale | "mixed" | "auto";
  userText?: string;
}): AppLocale | "mixed" {
  const cfg = loadLocaleConfig();
  if (opts?.locale && opts.locale !== "auto") return opts.locale;

  if (opts?.userText?.trim()) {
    const detected = detectTextLocale(opts.userText);
    // Arabic-first product: mixed prompts still prefer Arabic replies
    if (detected === "en" && cfg.contentLocale === "en") return "en";
    if (detected === "en" && cfg.contentLocale === "ar") return "en";
    return detected;
  }

  return cfg.contentLocale;
}

/**
 * System / prompt directive so agents reply in the right language with RTL awareness.
 * Prepend to specialist / CEO prompts when content locale is Arabic or the user wrote Arabic.
 */
export function languageSystemDirective(opts?: {
  locale?: AppLocale | "mixed" | "auto";
  userText?: string;
  egyptianFriendly?: boolean;
}): string {
  const cfg = loadLocaleConfig();
  const locale = resolveReplyLocale(opts);
  const egyptian = opts?.egyptianFriendly ?? cfg.egyptianFriendly;

  if (locale === "en") {
    return [
      "## Language",
      "- Reply in clear professional English.",
      "- Keep code identifiers, paths, and tool names unchanged.",
      "",
    ].join("\n");
  }

  if (locale === "mixed") {
    return [
      "## Language",
      "- The user mixed Arabic and English. Reply primarily in Arabic (Egyptian/MSA-friendly).",
      "- Keep technical identifiers, file paths, APIs, and code in English/Latin script.",
      "- Use RTL-friendly structure for Arabic prose; do not reverse Latin tokens.",
      egyptian
        ? "- Prefer natural Egyptian-friendly phrasing where colloquial tone helps clarity; keep formal MSA for reports."
        : "- Prefer clear Modern Standard Arabic for reports.",
      "",
    ].join("\n");
  }

  return [
    "## اللغة / Language",
    "- أجب بالعربية الفصحى السهلة" +
      (egyptian ? " مع لمسة مصرية ودّية عند الحوار" : "") +
      "، إلا إذا طُلب غير ذلك.",
    "- أبقِ أسماء الملفات والمسارات والأدوات والكود كما هي (لاتيني).",
    "- عند كتابة تقارير Markdown ضع المحتوى باتجاه RTL (dir=rtl) واستخدم عناوين عربية واضحة.",
    "- افهم طلبات المهام باللهجة المصرية والعربية الفصحى (مثال: اعمل ملف، انقل، احذف، حلّل، راجع).",
    "- Do not translate code fences, JSON keys, or shell commands.",
    "",
  ].join("\n");
}

/** Prepend language directive to a prompt body. */
export function withLanguageDirective(
  prompt: string,
  opts?: Parameters<typeof languageSystemDirective>[0]
): string {
  const dir = languageSystemDirective(opts);
  if (!dir.trim()) return prompt;
  return `${dir}\n${prompt}`;
}

/**
 * Lightweight Arabic intent cues for task classification (Egyptian + MSA).
 * taskSpec already matches many of these; this list is the Phase 7 contract.
 */
export const ARABIC_INTENT_CUES = {
  create_file: ["اعمل ملف", "أنشئ ملف", "انشئ ملف", "اكتب ملف", "سوّي ملف"],
  move_file: ["انقل", "حرّك", "حرك", "ودّي", "ودي"],
  delete_file: ["احذف", "امسح", "شِيل", "شيل"],
  open: ["افتح", "شغّل", "شغل"],
  analyze: ["حلّل", "حلل", "راجع", "تحليل", "تقرير", "فجوات"],
  implement: ["طبّق", "طبق", "عدّل الكود", "عدل الكود", "نفّذ", "نفذ"],
  copy: ["انسخ", "انقلي نسخة", "خذ نسخة"],
  help: ["مساعدة", "المساعدة", "ساعدني", "اشرحلي", "اشرح لي", "دليل الاستخدام", "فهرس المساعدة"],
} as const;

export function matchesArabicIntent(
  text: string,
  intent: keyof typeof ARABIC_INTENT_CUES
): boolean {
  const t = text || "";
  return ARABIC_INTENT_CUES[intent].some((cue) => t.includes(cue));
}
