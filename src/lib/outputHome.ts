/**
 * Default agent output home — all run artifacts under Documents/Sam-Harness.
 * Override with SAM_OUTPUT_HOME.
 *
 * Layout (required):
 *   reports/  tasks/  state/  memory/  conversations/  backups/  logs/
 * Compat also kept: documents/  exports/  runs/  temp/
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type OutputLayout = {
  home: string;
  reports: string;
  tasks: string;
  state: string;
  memory: string;
  conversations: string;
  backups: string;
  logs: string;
  documents: string;
  exports: string;
  runs: string;
  temp: string;
};

let activeRunDir: string | null = null;

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/** Resolve SAM_OUTPUT_HOME or ~/Documents/Sam-Harness */
export function getOutputHome(): string {
  const raw = String(process.env.SAM_OUTPUT_HOME || "").trim();
  if (raw) {
    let cleaned = raw.replace(/^["']|["']$/g, "");
    if (cleaned.startsWith("~/") || cleaned === "~") {
      cleaned = path.join(homeDir(), cleaned.slice(2));
    }
    return path.normalize(path.resolve(cleaned));
  }
  return path.normalize(path.join(homeDir(), "Documents", "Sam-Harness"));
}

export function getOutputLayout(home: string = getOutputHome()): OutputLayout {
  return {
    home,
    reports: path.join(home, "reports"),
    tasks: path.join(home, "tasks"),
    state: path.join(home, "state"),
    memory: path.join(home, "memory"),
    conversations: path.join(home, "conversations"),
    backups: path.join(home, "backups"),
    logs: path.join(home, "logs"),
    documents: path.join(home, "documents"),
    exports: path.join(home, "exports"),
    runs: path.join(home, "runs"),
    temp: path.join(home, "temp"),
  };
}

/** Create the standard folder tree (idempotent). */
export function ensureOutputHome(home: string = getOutputHome()): OutputLayout {
  const layout = getOutputLayout(home);
  for (const dir of Object.values(layout)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const readme = path.join(layout.home, "README.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        "Sam-Harness agent output home",
        "",
        "reports/        — numbered review packs (Sam-Harness no.X)",
        "tasks/          — runtime task.ts / task.md / task.spec.json",
        "state/          — SQLite DB and session state",
        "memory/         — self-learning lessons + skills (+ agent-memory.md)",
        "conversations/  — chat session history",
        "backups/        — DB and config backups (never inside the repo)",
        "logs/           — run / control-plane logs",
        "documents/      — generated documents / help exports",
        "exports/        — export bundles",
        "runs/           — per-run staging (YYYY-MM-DD/<run-id>/)",
        "temp/           — scratch (safe to delete; auto-cleaned)",
        "",
        "Nothing is written into the Sam-Harness git repo or a target project",
        "repo except explicit GO Level-3 source edits.",
        "",
        "Override location with SAM_OUTPUT_HOME.",
        "",
      ].join("\n"),
      "utf-8"
    );
  }
  return layout;
}

function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Create runs/<YYYY-MM-DD>/<run-id>/{artifacts,logs} and mark it active.
 */
export function beginOutputRun(runId?: string): {
  runId: string;
  runDir: string;
  artifacts: string;
  logs: string;
} {
  const layout = ensureOutputHome();
  const id = runId || `run-${Date.now().toString(36)}`;
  const runDir = path.join(layout.runs, dayKey(), id);
  const artifacts = path.join(runDir, "artifacts");
  const logs = path.join(runDir, "logs");
  fs.mkdirSync(artifacts, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });
  activeRunDir = runDir;
  process.env.SAM_RUN_DIR = runDir;
  return { runId: id, runDir, artifacts, logs };
}

export function endOutputRun(): void {
  activeRunDir = null;
  delete process.env.SAM_RUN_DIR;
}

export function getActiveRunDir(): string | null {
  return activeRunDir || (process.env.SAM_RUN_DIR ? path.normalize(process.env.SAM_RUN_DIR) : null);
}

/** Path under the active run (or temp/) for an agent-generated file. */
export function agentArtifactPath(...segments: string[]): string {
  const base = getActiveRunDir() || ensureOutputHome().temp;
  return path.normalize(path.join(base, ...segments));
}

/** Path under reports/ for pack / report outputs. */
export function agentReportPath(...segments: string[]): string {
  return path.normalize(path.join(ensureOutputHome().reports, ...segments));
}

/** Path under documents/. */
export function agentDocumentPath(...segments: string[]): string {
  return path.normalize(path.join(ensureOutputHome().documents, ...segments));
}

/** Path under tasks/. */
export function agentTaskPath(...segments: string[]): string {
  return path.normalize(path.join(ensureOutputHome().tasks, ...segments));
}

/** Path under memory/. */
export function agentMemoryPath(...segments: string[]): string {
  return path.normalize(path.join(ensureOutputHome().memory, ...segments));
}

/** Path under backups/. */
export function agentBackupPath(...segments: string[]): string {
  return path.normalize(path.join(ensureOutputHome().backups, ...segments));
}

/** Path under logs/ (top-level output home logs, not per-run). */
export function agentLogPath(...segments: string[]): string {
  return path.normalize(path.join(ensureOutputHome().logs, ...segments));
}

/** Path under state/. */
export function agentStatePath(...segments: string[]): string {
  return path.normalize(path.join(ensureOutputHome().state, ...segments));
}

/**
 * True when absPath resolves under SAM_OUTPUT_HOME (never the git repo).
 */
export function isUnderOutputHome(absPath: string, home: string = getOutputHome()): boolean {
  const h = path.normalize(home).toLowerCase();
  const t = path.normalize(absPath).toLowerCase();
  return t === h || t.startsWith(h + path.sep);
}

/** Copy known cwd run products into the active run's artifacts/ folder. */
export function mirrorRunArtifacts(
  cwd: string = process.cwd(),
  names: string[] = [
    "final-report.md",
    "execution-result.md",
    "execution-plan.md",
    "audit-report.md",
    "ceo-draft.md",
    "evidence-pack.md",
    "pack-location.md",
  ]
): string | null {
  const runDir = getActiveRunDir();
  if (!runDir) return null;
  const dest = path.join(runDir, "artifacts");
  fs.mkdirSync(dest, { recursive: true });
  for (const name of names) {
    const src = path.join(cwd, name);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      try {
        fs.copyFileSync(src, path.join(dest, name));
      } catch {
        /* ignore */
      }
    }
  }
  return dest;
}

/** Remove temp/ files older than maxAgeMs (default 24h). */
export function cleanOutputTemp(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const temp = ensureOutputHome().temp;
  let removed = 0;
  const now = Date.now();
  try {
    for (const name of fs.readdirSync(temp)) {
      const abs = path.join(temp, name);
      try {
        const st = fs.statSync(abs);
        if (now - st.mtimeMs > maxAgeMs) {
          fs.rmSync(abs, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

export function __resetActiveRunDirForTests(): void {
  activeRunDir = null;
  delete process.env.SAM_RUN_DIR;
}
