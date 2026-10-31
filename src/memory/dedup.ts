/**
 * Three-band dedup: duplicate (hit++), variant (new + link), distinct (new).
 */
import { loadMemoryConfig, type MemoryConfig } from "./config.js";
import { fingerprintText } from "./normalize.js";
import { memorySimilarity } from "./similarity.js";
import {
  loadMemoryFile,
  newMemoryId,
  saveMemoryFile,
  updateEntry,
} from "./store.js";
import type {
  DedupBand,
  DedupDecision,
  MemoryEntry,
  MemoryKind,
  UpsertResult,
} from "./types.js";

export function classifySimilarity(
  similarity: number,
  cfg: MemoryConfig = loadMemoryConfig()
): DedupBand {
  if (similarity >= cfg.duplicateThreshold) return "duplicate";
  if (similarity >= cfg.variantThreshold) return "variant";
  return "distinct";
}

/** Find best match among same-kind entries by similarity. */
export function findBestMatch(
  text: string,
  entries: MemoryEntry[],
  cfg: MemoryConfig = loadMemoryConfig()
): DedupDecision {
  const fp = fingerprintText(text);
  if (!fp || !entries.length) {
    return { band: "distinct", similarity: 0 };
  }
  let best: DedupDecision = { band: "distinct", similarity: 0 };
  for (const e of entries) {
    // Fast path: exact fingerprint
    if (e.fingerprint === fp) {
      return { band: "duplicate", similarity: 1, matchId: e.id };
    }
    const sim = memorySimilarity(text, e.text);
    if (sim > best.similarity) {
      best = {
        band: classifySimilarity(sim, cfg),
        similarity: sim,
        matchId: e.id,
      };
    }
  }
  best.band = classifySimilarity(best.similarity, cfg);
  return best;
}

export type UpsertInput = {
  kind: MemoryKind;
  text: string;
  tags?: string[];
  sourceRunId?: string;
  /** Increment success (approved skill / useful) or failure (rejection). */
  outcome?: "success" | "failure" | "hit";
  home?: string;
  config?: MemoryConfig;
};

/**
 * Upsert with three-band dedup.
 * - duplicate: increment hit (+ outcome counters); do NOT create a new entry
 * - variant: create new entry linked to parent via parentId + relatedIds
 * - distinct: create new unlinked entry
 */
export function upsertMemoryEntry(input: UpsertInput): UpsertResult {
  const cfg = input.config || loadMemoryConfig();
  const text = String(input.text || "").trim();
  if (!text) {
    throw new Error("memory text is required");
  }
  const kind = input.kind;
  const file = loadMemoryFile(kind, input.home);
  const decision = findBestMatch(text, file.entries, cfg);
  const now = new Date().toISOString();
  const tags = (input.tags || []).map((t) => String(t).trim()).filter(Boolean);
  const runId = String(input.sourceRunId || "unknown");

  if (decision.band === "duplicate" && decision.matchId) {
    const existing = file.entries.find((e) => e.id === decision.matchId)!;
    existing.hitCount += 1;
    existing.updatedAt = now;
    if (input.outcome === "success") existing.successCount += 1;
    if (input.outcome === "failure") existing.failureCount += 1;
    // Merge tags
    for (const t of tags) {
      if (!existing.tags.includes(t)) existing.tags.push(t);
    }
    if (runId && runId !== "unknown") {
      existing.sourceRunId = existing.sourceRunId || runId;
    }
    saveMemoryFile(kind, file, input.home);
    return {
      entry: existing,
      created: false,
      band: "duplicate",
      similarity: decision.similarity,
    };
  }

  const entry: MemoryEntry = {
    id: newMemoryId(kind),
    kind,
    text,
    fingerprint: fingerprintText(text),
    tags: [...tags],
    sourceRunId: runId,
    createdAt: now,
    updatedAt: now,
    hitCount: 1,
    successCount: input.outcome === "success" ? 1 : 0,
    failureCount: input.outcome === "failure" ? 1 : 0,
    relatedIds: [],
  };

  if (decision.band === "variant" && decision.matchId) {
    entry.parentId = decision.matchId;
    entry.relatedIds.push(decision.matchId);
    const parent = file.entries.find((e) => e.id === decision.matchId);
    if (parent) {
      if (!parent.relatedIds.includes(entry.id)) {
        parent.relatedIds.push(entry.id);
      }
      parent.updatedAt = now;
    }
  }

  file.entries.unshift(entry);
  // Soft cap
  if (file.entries.length > cfg.maxEntriesPerKind) {
    // Prefer dropping low-hit unpromoted tails
    file.entries.sort((a, b) => {
      if (a.promoted !== b.promoted) return a.promoted ? -1 : 1;
      return b.hitCount - a.hitCount || b.updatedAt.localeCompare(a.updatedAt);
    });
    file.entries = file.entries.slice(0, cfg.maxEntriesPerKind);
  }
  saveMemoryFile(kind, file, input.home);
  return {
    entry,
    created: true,
    band: decision.band,
    similarity: decision.similarity,
  };
}

/** Record a hit/outcome on an existing id (no text change). */
export function bumpEntry(
  id: string,
  outcome: "success" | "failure" | "hit" = "hit",
  home?: string
): MemoryEntry | null {
  const lessons = loadMemoryFile("lesson", home);
  const skills = loadMemoryFile("skill", home);
  const pool = [...lessons.entries, ...skills.entries];
  const found = pool.find((e) => e.id === id);
  if (!found) return null;
  found.hitCount += 1;
  found.updatedAt = new Date().toISOString();
  if (outcome === "success") found.successCount += 1;
  if (outcome === "failure") found.failureCount += 1;
  return updateEntry(found, home);
}
