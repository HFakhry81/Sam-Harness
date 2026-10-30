/**
 * Detect owner/operator "help" intents and answer from Help docs (no invented capabilities).
 */
import {
  loadHelpDoc,
  listHelpIndex,
  normalizeHelpLocale,
  resolveTopicId,
  tryLoadHelpDoc,
  type HelpLocale,
} from "./catalog.js";
import { searchHelp } from "./search.js";
import { HELP_TOPICS } from "./topics.js";

const HELP_CUES_AR = [
  "مساعدة",
  "المساعدة",
  "ساعدني",
  "عايز مساعدة",
  "عاوز مساعدة",
  "اشرحلي",
  "اشرح لي",
  "ما هي الوكالة",
  "ايش تقدر",
  "إيه تقدر",
  "كيف أستخدم",
  "ازاي أستخدم",
  "دليل",
  "فهرس المساعدة",
];

const HELP_CUES_EN = [
  "help",
  "how do i",
  "how does",
  "what can you",
  "what can sam",
  "documentation",
  "docs?",
  "show me the help",
  "agency help",
  "user guide",
  "faq",
];

/** True when the user text is primarily asking for Help-system content. */
export function detectHelpIntent(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  // Short explicit commands
  if (/^(help|مساعدة|المساعدة|docs?|faq|glossary|doctor)(\s|$)/i.test(t)) return true;
  if (/^(pnpm\s+run\s+)?help(\s|$)/i.test(t)) return true;
  const lower = t.toLowerCase();
  if (HELP_CUES_EN.some((c) => lower.includes(c))) return true;
  if (HELP_CUES_AR.some((c) => t.includes(c))) return true;
  // Topic alias alone
  if (resolveTopicId(t)) return true;
  return false;
}

export type HelpAnswer = {
  ok: boolean;
  locale: HelpLocale;
  topicId?: string;
  title: string;
  body: string;
  related: { id: string; title: string }[];
  source: "topic" | "search" | "index";
};

function stripFirstHeading(md: string): string {
  return md.replace(/^#\s+.+\n+/, "");
}

/**
 * Answer a help query from docs. Prefer exact topic; else keyword search; else index.
 */
export function answerHelpQuery(opts: {
  query: string;
  locale?: HelpLocale | string;
  cwd?: string;
  maxChars?: number;
}): HelpAnswer {
  const locale = normalizeHelpLocale(opts.locale);
  const q = String(opts.query || "").trim();
  const maxChars = opts.maxChars ?? 12000;

  // Exact topic / alias
  const exact = tryLoadHelpDoc(q, locale, opts.cwd);
  if (exact && !/^(help|مساعدة|docs?)$/i.test(q)) {
    return {
      ok: true,
      locale,
      topicId: exact.id,
      title: exact.title,
      body: exact.body.slice(0, maxChars),
      related: listHelpIndex(locale, opts.cwd)
        .filter((e) => e.id !== exact.id)
        .slice(0, 5)
        .map((e) => ({ id: e.id, title: e.title })),
      source: "topic",
    };
  }

  // "help workflow" / "مساعدة التكلفة"
  const tokens = q.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const id = resolveTopicId(tok);
    if (id && id !== "index") {
      const doc = loadHelpDoc(id, locale, opts.cwd);
      return {
        ok: true,
        locale,
        topicId: doc.id,
        title: doc.title,
        body: doc.body.slice(0, maxChars),
        related: [],
        source: "topic",
      };
    }
  }

  const hits = searchHelp({ query: q, locale, cwd: opts.cwd, limit: 5 });
  if (hits.length && hits[0].score >= 4) {
    const doc = loadHelpDoc(hits[0].id, locale, opts.cwd);
    const more = hits.slice(1).map((h) => `- **${h.id}** — ${h.title}`).join("\n");
    const body =
      stripFirstHeading(doc.body).slice(0, maxChars - 400) +
      (more
        ? `\n\n---\n\n${locale === "ar" ? "## مواضيع ذات صلة" : "## Related"}\n${more}\n`
        : "");
    return {
      ok: true,
      locale,
      topicId: doc.id,
      title: doc.title,
      body,
      related: hits.slice(1).map((h) => ({ id: h.id, title: h.title })),
      source: "search",
    };
  }

  // Fallback: index
  const index = listHelpIndex(locale, opts.cwd);
  const lines =
    locale === "ar"
      ? [
          "# فهرس المساعدة",
          "",
          "اسأل عن موضوع محدد أو شغّل `pnpm run help <topic>`.",
          "",
          ...index.map((e) => `- \`${e.id}\` — **${e.title}**: ${e.summary}`),
        ]
      : [
          "# Help index",
          "",
          "Ask about a topic or run `pnpm run help <topic>`.",
          "",
          ...index.map((e) => `- \`${e.id}\` — **${e.title}**: ${e.summary}`),
        ];
  return {
    ok: true,
    locale,
    topicId: "index",
    title: locale === "ar" ? "فهرس المساعدة" : "Help index",
    body: lines.join("\n") + "\n",
    related: index.filter((e) => e.id !== "index").slice(0, 8).map((e) => ({
      id: e.id,
      title: e.title,
    })),
    source: "index",
  };
}

/** Format answer for CLI / agent console. */
export function formatHelpAnswerForCli(answer: HelpAnswer): string {
  const head =
    answer.locale === "ar"
      ? `══ مساعدة Sam-Harness · ${answer.title} (${answer.topicId || "—"}) ══`
      : `══ Sam-Harness Help · ${answer.title} (${answer.topicId || "—"}) ══`;
  return `${head}\n\n${answer.body.trim()}\n`;
}

export function helpIntentCues(): { ar: string[]; en: string[]; topics: string[] } {
  return {
    ar: [...HELP_CUES_AR],
    en: [...HELP_CUES_EN],
    topics: HELP_TOPICS.map((t) => t.id),
  };
}
