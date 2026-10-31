/**
 * Promote recurring lessons into deterministic pre-check rules.
 * Expressible cases: forbidden patterns / residue-like checks.
 */
import * as fs from "fs";
import { loadMemoryConfig, type MemoryConfig } from "./config.js";
import {
  loadMemoryFile,
  memoryFilePath,
  saveMemoryFile,
  updateEntry,
} from "./store.js";
import type { MemoryEntry, PromoteRule } from "./types.js";

export type PromotedRulesFile = {
  schemaVersion: number;
  updatedAt: string;
  rules: PromoteRule[];
};

function emptyRules(): PromotedRulesFile {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    rules: [],
  };
}

export function loadPromotedRules(home?: string): PromotedRulesFile {
  const file = memoryFilePath("rules", home);
  if (!fs.existsSync(file)) return emptyRules();
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as PromotedRulesFile;
    return {
      schemaVersion: 1,
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    // Corrupted — backup and recover empty
    try {
      fs.writeFileSync(
        `${file}.corrupt.${Date.now().toString(36)}`,
        fs.readFileSync(file, "utf-8"),
        "utf-8"
      );
    } catch {
      /* ignore */
    }
    return emptyRules();
  }
}

export function savePromotedRules(
  data: PromotedRulesFile,
  home?: string
): void {
  const file = memoryFilePath("rules", home);
  const payload: PromotedRulesFile = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    rules: data.rules,
  };
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Heuristic: can this lesson become a forbidden-pattern pre-check?
 * Looks for quoted tokens, path fragments, residue keywords.
 */
export function extractForbiddenPattern(lessonText: string): string | null {
  const text = String(lessonText || "").trim();
  if (!text) return null;

  // Quoted fragment
  const quoted = text.match(/["'`]([^"'`]{4,80})["'`]/);
  if (quoted?.[1]) return quoted[1].trim();

  // Explicit residue / forbidden phrases
  const residue = text.match(
    /\b(?:forbidden|residue|do not (?:use|cite|write)|never (?:use|cite|write)|must not contain)\s*:?\s*([A-Za-z0-9_./\[\]-]{4,80})/i
  );
  if (residue?.[1]) return residue[1].trim();

  // Path-like tokens often cited in gate failures
  const pathish = text.match(
    /\b((?:packages|apps)\/[A-Za-z0-9_./-]+|\[REMOVED[^\]]*\])\b/i
  );
  if (pathish?.[1]) return pathish[1];

  // Currency residue shorthand
  if (/invalid currency|wrong currency|must use \w+/i.test(text)) {
    const cur = text.match(/\b(USD|EUR|GBP|SAR|AED)\b/i);
    if (cur?.[1]) return cur[1].toUpperCase();
  }

  return null;
}

export function isPromotableLesson(entry: MemoryEntry): boolean {
  if (entry.kind !== "lesson") return false;
  if (entry.promoted) return false;
  return Boolean(extractForbiddenPattern(entry.text));
}

/**
 * Scan lessons and promote those that hit the recurrence threshold
 * and have an expressible forbidden pattern.
 */
export function promoteEligibleLessons(
  home?: string,
  config?: MemoryConfig
): PromoteRule[] {
  const cfg = config || loadMemoryConfig();
  const file = loadMemoryFile("lesson", home);
  const rulesDoc = loadPromotedRules(home);
  const created: PromoteRule[] = [];
  const now = new Date().toISOString();

  for (const entry of file.entries) {
    if (entry.promoted) continue;
    if (entry.hitCount < cfg.promoteHitThreshold) continue;
    const pattern = extractForbiddenPattern(entry.text);
    if (!pattern) continue;

    // Skip if identical pattern already promoted
    if (
      rulesDoc.rules.some(
        (r) => r.pattern.toLowerCase() === pattern.toLowerCase()
      )
    ) {
      entry.promoted = true;
      entry.updatedAt = now;
      continue;
    }

    const rule: PromoteRule = {
      id: `rule-${entry.id}`,
      description: `Promoted from lesson (${entry.hitCount} hits): ${entry.text.slice(0, 120)}`,
      pattern,
      regex: false,
      gate: entry.tags.find((t) => t.startsWith("gate:"))?.slice(5) || "other",
      createdAt: now,
      fromLessonId: entry.id,
    };
    entry.promoted = true;
    entry.promoteRule = rule;
    entry.updatedAt = now;
    if (!entry.relatedIds.includes(rule.id)) entry.relatedIds.push(rule.id);
    rulesDoc.rules.push(rule);
    created.push(rule);
  }

  saveMemoryFile("lesson", file, home);
  savePromotedRules(rulesDoc, home);
  return created;
}

/** Mark a specific lesson promoted (tests / CLI). */
export function forcePromoteLesson(
  lessonId: string,
  home?: string
): PromoteRule | null {
  const file = loadMemoryFile("lesson", home);
  const entry = file.entries.find((e) => e.id === lessonId);
  if (!entry) return null;
  const pattern = extractForbiddenPattern(entry.text);
  if (!pattern) return null;
  const now = new Date().toISOString();
  const rule: PromoteRule = {
    id: `rule-${entry.id}`,
    description: `Forced promote: ${entry.text.slice(0, 120)}`,
    pattern,
    regex: false,
    createdAt: now,
    fromLessonId: entry.id,
  };
  entry.promoted = true;
  entry.promoteRule = rule;
  entry.updatedAt = now;
  updateEntry(entry, home);
  const rulesDoc = loadPromotedRules(home);
  if (!rulesDoc.rules.some((r) => r.id === rule.id)) {
    rulesDoc.rules.push(rule);
    savePromotedRules(rulesDoc, home);
  }
  return rule;
}
