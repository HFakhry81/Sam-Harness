/**
 * Persistent memory files under SAM_OUTPUT_HOME/memory/.
 * Atomic write (temp + rename), schema version, corrupted-file recovery.
 */
import * as fs from "fs";
import * as path from "path";
import { ensureOutputHome, getOutputLayout } from "../lib/outputHome.js";
import {
  MEMORY_SCHEMA_VERSION,
  type MemoryEntry,
  type MemoryFile,
  type MemoryKind,
} from "./types.js";

export const LESSONS_FILE = "lessons.json";
export const SKILLS_FILE = "skills.json";
export const RULES_FILE = "promoted-rules.json";

function emptyFile(): MemoryFile {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: [],
  };
}

/** Resolve memory directory (creates layout). */
export function getMemoryDir(home?: string): string {
  const layout = home
    ? getOutputLayout(home)
    : ensureOutputHome();
  fs.mkdirSync(layout.memory, { recursive: true });
  return layout.memory;
}

export function memoryFilePath(
  kind: MemoryKind | "rules",
  home?: string
): string {
  const dir = getMemoryDir(home);
  if (kind === "lesson") return path.join(dir, LESSONS_FILE);
  if (kind === "skill") return path.join(dir, SKILLS_FILE);
  return path.join(dir, RULES_FILE);
}

function backupCorrupt(file: string, raw: string): void {
  try {
    const stamp = Date.now().toString(36);
    const bak = `${file}.corrupt.${stamp}`;
    fs.writeFileSync(bak, raw, "utf-8");
  } catch {
    /* ignore */
  }
}

function coerceEntry(raw: unknown): MemoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const id = String(e.id || "").trim();
  const kind = e.kind === "skill" ? "skill" : e.kind === "lesson" ? "lesson" : "";
  const text = String(e.text || "").trim();
  const fingerprint = String(e.fingerprint || "").trim();
  if (!id || !kind || !text || !fingerprint) return null;
  return {
    id,
    kind,
    text,
    fingerprint,
    tags: Array.isArray(e.tags)
      ? e.tags.map((t) => String(t)).filter(Boolean)
      : [],
    sourceRunId: String(e.sourceRunId || "unknown"),
    createdAt: String(e.createdAt || new Date().toISOString()),
    updatedAt: String(e.updatedAt || new Date().toISOString()),
    hitCount: Math.max(1, Number(e.hitCount) || 1),
    successCount: Math.max(0, Number(e.successCount) || 0),
    failureCount: Math.max(0, Number(e.failureCount) || 0),
    relatedIds: Array.isArray(e.relatedIds)
      ? e.relatedIds.map((t) => String(t)).filter(Boolean)
      : [],
    parentId: e.parentId ? String(e.parentId) : undefined,
    promoted: Boolean(e.promoted),
    promoteRule:
      e.promoteRule && typeof e.promoteRule === "object"
        ? (e.promoteRule as MemoryEntry["promoteRule"])
        : undefined,
  };
}

/**
 * Load a memory JSON file. On corruption / bad schema: backup + return empty.
 */
export function loadMemoryFile(
  kind: MemoryKind,
  home?: string
): MemoryFile {
  const file = memoryFilePath(kind, home);
  if (!fs.existsSync(file)) return emptyFile();
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return emptyFile();
  }
  if (!raw.trim()) return emptyFile();
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryFile>;
    const version = Number(parsed.schemaVersion) || 0;
    if (version > MEMORY_SCHEMA_VERSION + 5) {
      // Unrecognized future major — recover empty rather than crash
      backupCorrupt(file, raw);
      return emptyFile();
    }
    const entries: MemoryEntry[] = [];
    for (const row of parsed.entries || []) {
      const c = coerceEntry(row);
      if (c && c.kind === kind) entries.push(c);
    }
    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      entries,
    };
  } catch {
    backupCorrupt(file, raw);
    return emptyFile();
  }
}

/** Atomic write: write temp then rename into place. */
export function saveMemoryFile(
  kind: MemoryKind,
  data: MemoryFile,
  home?: string
): void {
  const file = memoryFilePath(kind, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: MemoryFile = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: data.entries,
  };
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const body = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(tmp, body, "utf-8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows: rename may fail if target exists — try replace
    try {
      fs.copyFileSync(tmp, file);
      fs.unlinkSync(tmp);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

export function listAllEntries(home?: string): MemoryEntry[] {
  const lessons = loadMemoryFile("lesson", home).entries;
  const skills = loadMemoryFile("skill", home).entries;
  return [...lessons, ...skills];
}

export function findEntryById(
  id: string,
  home?: string
): MemoryEntry | undefined {
  return listAllEntries(home).find((e) => e.id === id);
}

export function updateEntry(
  entry: MemoryEntry,
  home?: string
): MemoryEntry {
  const file = loadMemoryFile(entry.kind, home);
  const idx = file.entries.findIndex((e) => e.id === entry.id);
  entry.updatedAt = new Date().toISOString();
  if (idx >= 0) file.entries[idx] = entry;
  else file.entries.unshift(entry);
  saveMemoryFile(entry.kind, file, home);
  return entry;
}

/** Remove by id from either file. Returns true if removed. */
export function removeEntry(id: string, home?: string): boolean {
  for (const kind of ["lesson", "skill"] as MemoryKind[]) {
    const file = loadMemoryFile(kind, home);
    const n = file.entries.length;
    file.entries = file.entries.filter((e) => e.id !== id);
    if (file.entries.length < n) {
      saveMemoryFile(kind, file, home);
      return true;
    }
  }
  return false;
}

/** Prune entries with hitCount below minHits (and not promoted). */
export function pruneMemory(
  opts: { minHits?: number; kind?: MemoryKind; home?: string } = {}
): { removed: number; kept: number } {
  const minHits = opts.minHits ?? 1;
  let removed = 0;
  let kept = 0;
  const kinds: MemoryKind[] = opts.kind
    ? [opts.kind]
    : ["lesson", "skill"];
  for (const kind of kinds) {
    const file = loadMemoryFile(kind, opts.home);
    const next: MemoryEntry[] = [];
    for (const e of file.entries) {
      if (e.promoted || e.hitCount >= minHits) {
        next.push(e);
        kept += 1;
      } else {
        removed += 1;
      }
    }
    file.entries = next;
    saveMemoryFile(kind, file, opts.home);
  }
  return { removed, kept };
}

export function newMemoryId(kind: MemoryKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
