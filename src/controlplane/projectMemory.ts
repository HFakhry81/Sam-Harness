/**
 * P9 — Lightweight per-project memory / lessons store.
 */
import * as fs from "fs";
import * as path from "path";

export type MemoryEntry = {
  key: string;
  value: string;
  updatedAt: string;
};

export type MemoryStore = { entries: MemoryEntry[] };

const FILE = "project-memory.json";

function load(cwd: string): MemoryStore {
  const p = path.join(cwd, FILE);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    /* ignore */
  }
  return { entries: [] };
}

function save(cwd: string, store: MemoryStore): void {
  fs.writeFileSync(path.join(cwd, FILE), JSON.stringify(store, null, 2), "utf-8");
}

export function loadMemory(cwd: string): MemoryStore {
  return load(cwd);
}

export function listMemory(cwd: string): MemoryEntry[] {
  return load(cwd).entries;
}

export function upsertMemory(cwd: string, key: string, value: string): MemoryEntry {
  const k = key.trim();
  const v = value.trim();
  if (!k || !v) throw new Error("المفتاح والقيمة مطلوبان");
  const store = load(cwd);
  const existing = store.entries.find((e) => e.key.toLowerCase() === k.toLowerCase());
  if (existing) {
    existing.value = v;
    existing.updatedAt = new Date().toISOString();
    save(cwd, store);
    return existing;
  }
  const entry: MemoryEntry = { key: k, value: v, updatedAt: new Date().toISOString() };
  store.entries.unshift(entry);
  if (store.entries.length > 200) store.entries.length = 200;
  save(cwd, store);
  return entry;
}

export function removeMemory(cwd: string, key: string): boolean {
  const store = load(cwd);
  const n = store.entries.length;
  store.entries = store.entries.filter((e) => e.key.toLowerCase() !== key.toLowerCase());
  save(cwd, store);
  return store.entries.length < n;
}

export function memoryPromptBlock(cwd: string, max = 12): string {
  const entries = listMemory(cwd).slice(0, max);
  if (!entries.length) return "";
  return "## Project memory\n" + entries.map((e) => `- ${e.key}: ${e.value}`).join("\n");
}

/** Lessons + recent ledger lines for CEO / Strategist prompts (closed learning loop). */
export function learningContextBlock(cwd: string, maxLessons = 10, maxLedger = 6): string {
  const parts: string[] = [];
  const mem = memoryPromptBlock(cwd, maxLessons);
  if (mem) parts.push(mem);

  try {
    const am = path.join(cwd, "agent-memory.md");
    if (fs.existsSync(am)) {
      const lines = fs
        .readFileSync(am, "utf-8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- ["));
      const recent = lines.slice(-maxLedger);
      if (recent.length) {
        parts.push("## Recent run lessons\n" + recent.join("\n"));
      }
    }
  } catch {
    /* ignore */
  }

  return parts.join("\n\n");
}

/** Seed durable lessons discovered by harness review (idempotent upsert). */
export function seedHarnessLessons(cwd: string): void {
  const seeds: Array<[string, string]> = [
    [
      "lesson:run-shell-powershell",
      "run_shell PowerShell must exec powershell.exe directly — never cmd /c (pipes like Select-Object break).",
    ],
    [
      "lesson:excel-inventory-write",
      "Excel inventory on a drive: after run_shell/list_dir always write_file the .txt report — scan alone is not success.",
    ],
    [
      "lesson:goal-fidelity",
      "Reject strategies that drift from ## Goal (e.g. BookingType when goal is memory/Daily Ops/UI).",
    ],
    [
      "lesson:target-repo-absolute",
      "targetRepo label Sam-Harness must resolve to this workspace absolute path — never nest packs under ./Sam-Harness/docs.",
    ],
    [
      "lesson:no-task-overwrite-while-running",
      "Do not replace task.ts/md while a run is active — causes wrong-goal contamination in LangGraph loops.",
    ],
    [
      "lesson:self-report-pack-home",
      "Self-intro / Sam-Harness capability reports archive under THIS repo docs (Sam-Harness no.X) — never Maw3ed unless the goal is Maw3ed.",
    ],
  ];
  for (const [k, v] of seeds) upsertMemory(cwd, k, v);
}
