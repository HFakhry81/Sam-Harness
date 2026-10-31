/**
 * One-time English ASCII warning when legacy run artifacts still sit in the
 * Sam-Harness repo root or docs/. Never deletes user files.
 */
import * as fs from "fs";
import * as path from "path";
import { getOutputHome } from "./outputHome.js";

const ROOT_FILES = [
  "task.md",
  "task.spec.json",
  "task.draft.json",
  "task.pending.md",
  "task-last-failure.md",
  "task-archive",
  "review-loop",
  "execution-plan.md",
  "evidence-pack.md",
  "pack-location.md",
  "project-memory.json",
  "agent-memory.md",
  "controlplane-session.md",
  "controlplane-session.json",
  "engagement.json",
  "marketing-campaign.md",
  "help-system-spec.md",
  "NEXT_SPRINT.md",
  "IMPLEMENTATION_BACKLOG.md",
  "CODE_VS_PLAN_GAP_MATRIX.md",
  "TICKET_P0_STARTER.md",
  "AUDIT_CHECKLIST.md",
  "REQ_TRACEABILITY.md",
  "gates.json",
  "evidence.json",
  "agency-verdict.md",
  "audit-report.md",
  "audit-history.md",
  "ceo-draft.md",
  "final-report.md",
  "execution-result.md",
  "DELIVERY_BOARD.md",
  "delivery-board.json",
  "go-nogo.json",
  "rollback-journal.json",
  "rollback-backups",
  "sam_harness_reports",
];

const PACK_DIR_RE = /^Sam-Harness no\.\d+/i;
const TEAM_BACKUP_RE = /^team\.backup/i;

let warned = false;

export type LegacyScanResult = {
  found: string[];
  outputHome: string;
};

/** Scan repo root + docs/ + config/ for leftover run artifacts. */
export function scanLegacyRepoArtifacts(
  repoRoot: string = process.cwd()
): LegacyScanResult {
  const found: string[] = [];
  const root = path.normalize(repoRoot);

  for (const name of ROOT_FILES) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) found.push(name);
  }

  // Attempt leftovers like ceo-draft-attempt-*.md
  try {
    for (const name of fs.readdirSync(root)) {
      if (/^(ceo-draft-attempt-|audit-attempt-)/i.test(name)) {
        found.push(name);
      }
    }
  } catch {
    /* ignore */
  }

  const docs = path.join(root, "docs");
  try {
    if (fs.existsSync(docs) && fs.statSync(docs).isDirectory()) {
      for (const name of fs.readdirSync(docs)) {
        if (PACK_DIR_RE.test(name)) found.push(path.join("docs", name));
      }
    }
  } catch {
    /* ignore */
  }

  const configDir = path.join(root, "config");
  try {
    if (fs.existsSync(configDir) && fs.statSync(configDir).isDirectory()) {
      for (const name of fs.readdirSync(configDir)) {
        if (TEAM_BACKUP_RE.test(name)) found.push(path.join("config", name));
      }
    }
  } catch {
    /* ignore */
  }

  return { found: [...new Set(found)].sort(), outputHome: getOutputHome() };
}

/**
 * Log a one-shot English ASCII warning if legacy artifacts exist in the repo.
 * Safe to call on every start; only prints once per process.
 */
export function warnLegacyRepoArtifacts(
  repoRoot: string = process.cwd(),
  log: (line: string) => void = console.warn
): LegacyScanResult {
  const result = scanLegacyRepoArtifacts(repoRoot);
  if (warned || result.found.length === 0) return result;
  warned = true;
  log(
    `[Sam-Harness] WARNING: legacy run artifacts still in the repo (${result.found.length}). ` +
      `New packs/tasks/state go only under ${result.outputHome} ` +
      `(reports/, tasks/, state/, memory/, conversations/, backups/, logs/). ` +
      `Found: ${result.found.slice(0, 12).join(", ")}${
        result.found.length > 12 ? ", ..." : ""
      }. Not deleting user files.`
  );
  return result;
}

/** Test helper. */
export function __resetLegacyWarnForTests(): void {
  warned = false;
}
