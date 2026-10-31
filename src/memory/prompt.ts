/**
 * Delimited memory block for strategist / auditor prompts.
 * English-only ASCII console messages; prompt content may include original text.
 */
import { loadMemoryConfig } from "./config.js";
import { retrieveMemory } from "./retrieve.js";
import type { MemoryEntry, RetrieveQuery } from "./types.js";

export const MEMORY_BLOCK_START = "<<<SAM_HARNESS_LEARNED_MEMORY>>>";
export const MEMORY_BLOCK_END = "<<<END_SAM_HARNESS_LEARNED_MEMORY>>>";

function formatEntry(e: MemoryEntry, i: number): string {
  const tags = e.tags.length ? ` tags=[${e.tags.slice(0, 6).join(",")}]` : "";
  const stats = ` hits=${e.hitCount} ok=${e.successCount} fail=${e.failureCount}`;
  const promo = e.promoted ? " [PROMOTED]" : "";
  const parent = e.parentId ? ` parent=${e.parentId}` : "";
  return `${i + 1}. [${e.kind}]${promo}${stats}${tags}${parent}\n   ${e.text}`;
}

/** Build a clearly delimited learned-memory block (empty string if none). */
export function formatMemoryPromptBlock(
  entries: MemoryEntry[],
  opts?: { maxChars?: number }
): string {
  if (!entries.length) return "";
  const maxChars = opts?.maxChars ?? 3600;
  const lines = [
    MEMORY_BLOCK_START,
    "Obey these learned lessons and skills from prior runs. Do not repeat known failures.",
    "Prefer skills that match the current task; treat lessons as hard constraints when applicable.",
    "",
  ];
  let body = "";
  for (let i = 0; i < entries.length; i++) {
    const chunk = formatEntry(entries[i], i) + "\n";
    if (body.length + chunk.length > maxChars) break;
    body += chunk;
  }
  lines.push(body.trimEnd());
  lines.push(MEMORY_BLOCK_END);
  return lines.join("\n");
}

/**
 * Retrieve + format for injection before planning / auditing.
 */
export function learningMemoryPromptBlock(
  query: RetrieveQuery = {},
  home?: string
): string {
  const cfg = loadMemoryConfig();
  const entries = retrieveMemory(
    {
      limit: query.limit ?? cfg.retrieveLimit,
      tokenBudget: query.tokenBudget ?? cfg.retrieveTokenBudget,
      text: query.text,
      tags: query.tags,
      kinds: query.kinds,
    },
    home
  );
  return formatMemoryPromptBlock(entries, {
    maxChars: (query.tokenBudget ?? cfg.retrieveTokenBudget) * 4,
  });
}
