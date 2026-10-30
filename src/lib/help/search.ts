/**
 * Keyword search over Help docs (no external search engine).
 */
import {
  HELP_TOPICS,
  loadHelpDoc,
  normalizeHelpLocale,
  type HelpDoc,
  type HelpLocale,
} from "./catalog.js";
import type { HelpTopicId } from "./topics.js";

export type HelpSearchHit = {
  id: HelpTopicId;
  title: string;
  summary: string;
  score: number;
  snippet: string;
};

function tokenize(q: string): string[] {
  return String(q || "")
    .toLowerCase()
    .split(/[\s,;|/\\]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function snippetAround(body: string, term: string, radius = 80): string {
  const lower = body.toLowerCase();
  const idx = lower.indexOf(term.toLowerCase());
  if (idx < 0) {
    const plain = body.replace(/^#+\s+/gm, "").replace(/\n+/g, " ").trim();
    return plain.slice(0, radius * 2) + (plain.length > radius * 2 ? "…" : "");
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + term.length + radius);
  let snip = body.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snip = "…" + snip;
  if (end < body.length) snip = snip + "…";
  return snip;
}

export function scoreHelpDoc(doc: HelpDoc, tokens: string[]): number {
  if (!tokens.length) return 0;
  const hayTitle = doc.title.toLowerCase();
  const haySummary = doc.summary.toLowerCase();
  const hayBody = doc.body.toLowerCase();
  const hayKw = doc.keywords.join(" ").toLowerCase();
  const meta = HELP_TOPICS.find((t) => t.id === doc.id);
  const hayAlias = (meta?.aliases || []).join(" ").toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (doc.id === tok || doc.id.includes(tok)) score += 12;
    if (hayAlias.split(/\s+/).includes(tok) || hayAlias.includes(tok)) score += 10;
    if (hayTitle.includes(tok)) score += 8;
    if (hayKw.includes(tok)) score += 6;
    if (haySummary.includes(tok)) score += 4;
    const bodyHits = hayBody.split(tok).length - 1;
    if (bodyHits > 0) score += Math.min(8, bodyHits);
  }
  return score;
}

export function searchHelp(opts: {
  query: string;
  locale?: HelpLocale | string;
  cwd?: string;
  limit?: number;
}): HelpSearchHit[] {
  const locale = normalizeHelpLocale(opts.locale);
  const tokens = tokenize(opts.query);
  if (!tokens.length) return [];
  const limit = Math.max(1, Math.min(50, opts.limit ?? 12));
  const hits: HelpSearchHit[] = [];
  for (const meta of HELP_TOPICS) {
    const doc = loadHelpDoc(meta.id, locale, opts.cwd);
    const score = scoreHelpDoc(doc, tokens);
    if (score <= 0) continue;
    const snipTerm = tokens.find((t) => doc.body.toLowerCase().includes(t)) || tokens[0];
    hits.push({
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      score,
      snippet: snippetAround(doc.body, snipTerm),
    });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}
