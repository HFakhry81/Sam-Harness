/**
 * Phase 6 — per-run evidence bundle under SAM_OUTPUT_HOME runs/ + reports/.
 */
import * as fs from "fs";
import * as path from "path";
import {
  agentReportPath,
  ensureOutputHome,
  getActiveRunDir,
  getOutputLayout,
} from "../outputHome.js";
import { getCostBudget, getRunTokenTotals } from "../costLedger.js";
import { getDriver, getPersistence, runsRepo } from "../db/index.js";
import { listGateResults } from "./gates.js";
import { listAudit, appendAudit } from "./auditLog.js";
import { listAllApprovals } from "./approvals.js";
import { getEffectiveTrustPolicy } from "./config.js";
import { getActiveTenantId } from "../tenant/context.js";

export type EvidenceBundle = {
  runId: string;
  tenantId: string;
  writtenAt: string;
  status: string | null;
  mode: string | null;
  steps: Array<{ name: string; status: string; at: string; detail?: unknown }>;
  gates: ReturnType<typeof listGateResults>;
  approvals: Array<{
    id: string;
    kind: string;
    subject: string;
    status: string;
    createdAt: string;
    decidedAt?: string;
  }>;
  cost: {
    runSpentUsd: number;
    daySpentUsd: number;
    capUsd: number;
    inputTokens: number;
    outputTokens: number;
    cloudCalls: number;
  };
  screenshots: string[];
  diffs: string[];
  auditHead: string | null;
  paths: {
    evidenceDir: string;
    reportJson: string;
    reportMd: string;
    reportsCopy?: string;
  };
};

function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function collectScreenshotRefs(runDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      try {
        const st = fs.statSync(abs);
        if (st.isDirectory()) walk(abs);
        else if (/\.(png|jpe?g|webp)$/i.test(name)) {
          found.push(path.relative(runDir, abs).split(path.sep).join("/"));
        }
      } catch {
        /* ignore */
      }
    }
  };
  walk(runDir);
  return found;
}

function collectDiffRefs(evidenceDir: string): string[] {
  const diffsDir = path.join(evidenceDir, "diffs");
  if (!fs.existsSync(diffsDir)) return [];
  return fs
    .readdirSync(diffsDir)
    .filter((n) => /\.(diff|patch|txt|md)$/i.test(n))
    .map((n) => `diffs/${n}`);
}

function toMarkdown(bundle: EvidenceBundle): string {
  const lines = [
    `# Run evidence — ${bundle.runId}`,
    "",
    `- Written: ${bundle.writtenAt}`,
    `- Tenant: ${bundle.tenantId}`,
    `- Status: ${bundle.status ?? "unknown"}`,
    `- Mode: ${bundle.mode ?? "unknown"}`,
    `- Audit head: ${bundle.auditHead ?? "(empty)"}`,
    "",
    "## Cost",
    "",
    `- Run: $${bundle.cost.runSpentUsd.toFixed(4)}`,
    `- Day: $${bundle.cost.daySpentUsd.toFixed(4)} / cap $${bundle.cost.capUsd.toFixed(2)}`,
    `- Tokens: in=${bundle.cost.inputTokens} out=${bundle.cost.outputTokens} cloudCalls=${bundle.cost.cloudCalls}`,
    "",
    "## Steps",
    "",
  ];
  if (!bundle.steps.length) lines.push("_No timeline steps._", "");
  for (const s of bundle.steps) {
    lines.push(`- **${s.name}** [${s.status}] @ ${s.at}`);
  }
  lines.push("", "## Gates", "");
  if (!bundle.gates.length) lines.push("_No gate results._", "");
  for (const g of bundle.gates) {
    lines.push(
      `- ${g.passed ? "PASS" : "FAIL"} \`${g.gateId}\` (${g.kind}) step=${g.stepId} attempts=${g.attempts}${g.escalated ? " ESCALATED" : ""}`
    );
  }
  lines.push("", "## Approvals", "");
  if (!bundle.approvals.length) lines.push("_No approvals linked._", "");
  for (const a of bundle.approvals) {
    lines.push(`- ${a.status} \`${a.id}\` ${a.kind} — ${a.subject}`);
  }
  lines.push("", "## Screenshots", "");
  if (!bundle.screenshots.length) lines.push("_None._", "");
  for (const s of bundle.screenshots) lines.push(`- \`${s}\``);
  lines.push("", "## Diffs", "");
  if (!bundle.diffs.length) lines.push("_None._", "");
  for (const d of bundle.diffs) lines.push(`- \`${d}\``);
  lines.push("");
  return lines.join("\n");
}

/**
 * Write evidence bundle for a run.
 * Prefers active run dir; otherwise runs/<day>/<runId>/evidence/.
 */
export function writeEvidenceBundle(input: {
  runId: string;
  cwd?: string;
  tenantId?: string;
  runDir?: string;
}): EvidenceBundle | null {
  const policy = getEffectiveTrustPolicy(input.cwd);
  if (!policy.evidenceEnabled) return null;

  const tenantId = input.tenantId || getActiveTenantId();
  const layout = ensureOutputHome();
  const active = input.runDir || getActiveRunDir();
  const runDir =
    active && path.basename(active) === input.runId
      ? active
      : path.join(layout.runs, dayKey(), input.runId);

  const evidenceDir = path.join(runDir, "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(path.join(evidenceDir, "diffs"), { recursive: true });

  getPersistence();
  const driver = getDriver();
  const run = runsRepo.getRun(driver, tenantId, input.runId);
  const timeline = runsRepo.listRunEvents(driver, tenantId, input.runId);
  const gates = listGateResults(input.runId, tenantId);
  const approvals = listAllApprovals(tenantId).filter(
    (a) =>
      (typeof a.meta?.runId === "string" && a.meta.runId === input.runId) ||
      a.subject.includes(input.runId)
  );
  const tokens = getRunTokenTotals(input.cwd || process.cwd(), input.runId);
  const budget = getCostBudget(input.cwd || process.cwd());
  const audit = listAudit({ tenantId, runId: input.runId, limit: 500 });
  const head =
    audit.length > 0
      ? [...audit].sort((a, b) => a.seq - b.seq).at(-1)?.entryHash ?? null
      : null;

  const bundle: EvidenceBundle = {
    runId: input.runId,
    tenantId,
    writtenAt: new Date().toISOString(),
    status: run?.status ?? null,
    mode: run?.mode ?? null,
    steps: timeline.map((e) => ({
      name: e.name,
      status: e.status,
      at: e.at,
      detail: e.detail,
    })),
    gates,
    approvals: approvals.map((a) => ({
      id: a.id,
      kind: a.kind,
      subject: a.subject,
      status: a.status,
      createdAt: a.createdAt,
      decidedAt: a.decidedAt,
    })),
    cost: {
      runSpentUsd: tokens.costUsd,
      daySpentUsd: budget.spentUsd,
      capUsd: budget.capUsd,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cloudCalls: tokens.cloudCalls,
    },
    screenshots: collectScreenshotRefs(runDir),
    diffs: collectDiffRefs(evidenceDir),
    auditHead: head,
    paths: {
      evidenceDir,
      reportJson: path.join(evidenceDir, "report.json"),
      reportMd: path.join(evidenceDir, "report.md"),
    },
  };

  fs.writeFileSync(bundle.paths.reportJson, JSON.stringify(bundle, null, 2), "utf-8");
  fs.writeFileSync(bundle.paths.reportMd, toMarkdown(bundle), "utf-8");

  // Mirror under reports/ for easy discovery
  const reportsName = `evidence-${input.runId}.md`;
  const reportsCopy = agentReportPath(reportsName);
  try {
    fs.copyFileSync(bundle.paths.reportMd, reportsCopy);
    bundle.paths.reportsCopy = reportsCopy;
  } catch {
    /* ignore */
  }

  // Also keep a gates.json snapshot
  fs.writeFileSync(
    path.join(evidenceDir, "gates.json"),
    JSON.stringify(gates, null, 2),
    "utf-8"
  );

  appendAudit({
    category: "evidence",
    action: "evidence_written",
    runId: input.runId,
    detail: {
      evidenceDir,
      reportJson: bundle.paths.reportJson,
      gates: gates.length,
      steps: bundle.steps.length,
    },
    tenantId,
  });

  return bundle;
}

export function readEvidenceBundle(
  runId: string,
  runDir?: string
): EvidenceBundle | null {
  const layout = getOutputLayout();
  const candidates = [
    runDir ? path.join(runDir, "evidence", "report.json") : "",
    getActiveRunDir()
      ? path.join(getActiveRunDir()!, "evidence", "report.json")
      : "",
    path.join(layout.runs, dayKey(), runId, "evidence", "report.json"),
  ].filter(Boolean);

  // Also scan recent day folders for the run id
  try {
    for (const day of fs.readdirSync(layout.runs).sort().reverse().slice(0, 14)) {
      candidates.push(
        path.join(layout.runs, day, runId, "evidence", "report.json")
      );
    }
  } catch {
    /* ignore */
  }

  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf-8")) as EvidenceBundle;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
