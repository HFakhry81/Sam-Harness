/**
 * Retrieve top relevant memory entries for prompt injection.
 * Ranking: tag match + lexical relevance + hit/success weighting.
 */
import { loadMemoryConfig, type MemoryConfig } from "./config.js";
import { fingerprintText, tokenizeNormalized } from "./normalize.js";
import { memorySimilarity } from "./similarity.js";
import { listAllEntries } from "./store.js";
import type { MemoryEntry, RetrieveQuery } from "./types.js";

function tagScore(entry: MemoryEntry, tags: string[]): number {
  if (!tags.length) return 0;
  const set = new Set(entry.tags.map((t) => t.toLowerCase()));
  let hits = 0;
  for (const t of tags) {
    if (set.has(t.toLowerCase())) hits += 1;
  }
  return hits / tags.length;
}

function weightScore(entry: MemoryEntry): number {
  const hits = Math.log1p(entry.hitCount);
  const success = Math.log1p(entry.successCount);
  const fail = Math.log1p(entry.failureCount);
  // Failures (lessons) are still valuable; skills prefer success
  if (entry.kind === "skill") return hits + success * 1.5 - fail * 0.25;
  return hits + fail * 1.2 + success * 0.5;
}

export function scoreEntry(
  entry: MemoryEntry,
  query: RetrieveQuery
): number {
  const tags = query.tags || [];
  const text = query.text || "";
  const tScore = tagScore(entry, tags);
  let lex = 0;
  if (text) {
    lex = memorySimilarity(text, entry.text);
    // Light keyword overlap bonus
    const qTokens = new Set(tokenizeNormalized(fingerprintText(text)));
    const eTokens = new Set(tokenizeNormalized(entry.fingerprint));
    let inter = 0;
    for (const t of qTokens) if (eTokens.has(t)) inter += 1;
    if (qTokens.size) lex = Math.max(lex, inter / qTokens.size);
  }
  const w = weightScore(entry);
  return tScore * 2.5 + lex * 3 + w * 0.35 + (entry.promoted ? 0.5 : 0);
}

export function retrieveMemory(
  query: RetrieveQuery = {},
  home?: string,
  config?: MemoryConfig
): MemoryEntry[] {
  const cfg = config || loadMemoryConfig();
  const limit = query.limit ?? cfg.retrieveLimit;
  const kinds = query.kinds;
  let entries = listAllEntries(home);
  if (kinds?.length) {
    entries = entries.filter((e) => kinds.includes(e.kind));
  }
  const scored = entries
    .map((e) => ({ e, s: scoreEntry(e, query) }))
    .filter((x) => x.s > 0.05 || !query.text)
    .sort((a, b) => b.s - a.s || b.e.hitCount - a.e.hitCount);

  // Bound by token budget (approx 4 chars/token)
  const budgetChars = (query.tokenBudget ?? cfg.retrieveTokenBudget) * 4;
  const out: MemoryEntry[] = [];
  let used = 0;
  for (const { e } of scored) {
    if (out.length >= limit) break;
    const cost = e.text.length + 40;
    if (out.length > 0 && used + cost > budgetChars) break;
    out.push(e);
    used += cost;
  }
  return out;
}
