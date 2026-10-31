/**
 * In-session journal of tasks composed + executed via Control Plane.
 * Persists lightly so refresh keeps the report (like ChatGPT/Open WebUI history rail).
 */
import * as fs from "fs";
import * as path from "path";
import type { UiRoute } from "./taskWriter.js";
import { artifactNamesForSession } from "./artifacts.js";
import { loadStoreDoc, saveStoreDoc } from "../lib/db/storeBridge.js";
import {
  agentLogPath,
  agentReportPath,
  ensureOutputHome,
  getActiveRunDir,
} from "../lib/outputHome.js";

export type SessionEntry = {
  id: string;
  title: string;
  route: UiRoute | string;
  mode: string;
  promptPreview: string;
  targetRepo?: string;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  success: boolean;
  summary: string;
  artifacts: string[];
  logTail: string;
  /** LangGraph audit gate */
  auditPassed?: boolean | null;
  /** Goal fidelity / ops verification */
  goalPassed?: boolean | null;
  goalFidelityScore?: number | null;
  /** Path badge: chat / research / task / complex (legacy quick/web/agency accepted) */
  replyPath?:
    | "quick"
    | "web"
    | "agency"
    | "chat"
    | "research"
    | "task"
    | "complex"
    | "clarify";
  report?: {
    headline: string;
    bullets: string[];
    nextSteps: string[];
    tone: "ok" | "fail";
  };
  taskLifecycle?: "cleared" | "retained" | "unchanged";
};

export type AgencySession = {
  id: string;
  startedAt: string;
  updatedAt: string;
  entries: SessionEntry[];
};

function newSession(): AgencySession {
  const now = new Date().toISOString();
  return {
    id: `sess-${Date.now().toString(36)}`,
    startedAt: now,
    updatedAt: now,
    entries: [],
  };
}

export function loadSession(cwd: string): AgencySession {
  const j = loadStoreDoc<Partial<AgencySession>>(
    cwd,
    "controlplane-session",
    "controlplane-session.json",
    {}
  );
  if (j?.id && Array.isArray(j.entries)) return j as AgencySession;
  return newSession();
}

export function saveSession(cwd: string, session: AgencySession): void {
  session.updatedAt = new Date().toISOString();
  saveStoreDoc(cwd, "controlplane-session", session);
  const md = renderSessionMarkdown(session);
  try {
    ensureOutputHome();
    const dest = agentLogPath("controlplane-session.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, md, "utf-8");
  } catch {
    /* markdown mirror is best-effort */
  }
}

export function resetSession(cwd: string): AgencySession {
  const s = newSession();
  saveSession(cwd, s);
  return s;
}

export function readExecutionArtifacts(cwd: string): {
  summary: string;
  artifacts: string[];
} {
  const artifacts: string[] = [];
  const bits: string[] = [];

  const runDir = getActiveRunDir();
  const searchRoots = [
    runDir ? path.join(runDir, "artifacts") : "",
    agentReportPath(),
    cwd,
  ].filter(Boolean);

  function findArtifact(name: string): string | null {
    for (const root of searchRoots) {
      const p = path.join(root, name);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return null;
  }

  const execResult = findArtifact("execution-result.md");
  if (execResult) {
    artifacts.push("execution-result.md");
    bits.push(fs.readFileSync(execResult, "utf-8").trim().slice(0, 1200));
  }

  const finalReport = findArtifact("final-report.md");
  if (finalReport) {
    artifacts.push("final-report.md");
    const raw = fs.readFileSync(finalReport, "utf-8");
    try {
      const j = JSON.parse(raw);
      if (j.summary) bits.push(String(j.summary));
      else bits.push(raw.slice(0, 600));
    } catch {
      bits.push(raw.slice(0, 600));
    }
  }

  if (findArtifact("DELIVERY_BOARD.md")) artifacts.push("DELIVERY_BOARD.md");
  if (findArtifact("evidence-pack.md")) artifacts.push("evidence-pack.md");

  // Prefer richer list (pack + reports) when available
  try {
    const rich = artifactNamesForSession(cwd);
    if (rich.length) {
      for (const n of rich) {
        if (!artifacts.includes(n)) artifacts.push(n);
      }
    }
  } catch {
    /* keep base list */
  }

  return {
    summary: bits.filter(Boolean).join("\n---\n").slice(0, 2000) || "Run finished (no summary file).",
    artifacts,
  };
}

export function renderSessionMarkdown(session: AgencySession): string {
  const lines = [
    `# Sam-Harness Control Plane — Session Report`,
    ``,
    `- Session: \`${session.id}\``,
    `- Started: ${session.startedAt}`,
    `- Updated: ${session.updatedAt}`,
    `- Tasks: **${session.entries.length}**`,
    ``,
  ];
  if (!session.entries.length) {
    lines.push("_No tasks executed in this session yet._");
    return lines.join("\n");
  }
  session.entries.forEach((e, i) => {
    lines.push(`## ${i + 1}. ${e.title}`);
    lines.push(`- id: \`${e.id}\``);
    lines.push(`- route: \`${e.route}\` · mode: \`${e.mode}\``);
    lines.push(`- result: ${e.success ? "OK" : "FAIL"} (exit ${e.exitCode})`);
    lines.push(`- window: ${e.startedAt} → ${e.endedAt}`);
    if (e.targetRepo) lines.push(`- target: \`${e.targetRepo}\``);
    lines.push(`- artifacts: ${e.artifacts.join(", ") || "—"}`);
    lines.push(``);
    lines.push(`### Goal preview`);
    lines.push(e.promptPreview || "—");
    lines.push(``);
    lines.push(`### Summary`);
    lines.push(e.summary || "—");
    lines.push(``);
  });
  return lines.join("\n");
}
