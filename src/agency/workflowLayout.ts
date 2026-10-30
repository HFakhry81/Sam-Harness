/**
 * Phase 9 — workflow canvas layout (node positions) persisted separately from team.json.
 */
import * as fs from "fs";
import * as path from "path";
import { appendAudit } from "../lib/trust/auditLog.js";
import { LOCKED_NODE_IDS, type WorkflowGraph } from "./workflowGraph.js";

export type NodePosition = { x: number; y: number };

export type WorkflowLayout = {
  version: 1;
  positions: Record<string, NodePosition>;
  updatedAt?: string;
};

export type LayoutValidationResult = {
  ok: boolean;
  issues: Array<{ path: string; message: string }>;
};

/** Compact columns so the full spine fits a typical Control Plane canvas (~900px). */
const DEFAULT_COLUMN_X = [40, 200, 360, 520, 680, 840, 1000, 1160];
const ROW_Y = {
  top: 40,
  mid: 160,
  bottom: 300,
  specialists: 160,
};

/** Sensible default positions for the agency spine (LTR coords; UI mirrors for RTL). */
export function defaultWorkflowLayout(graph?: WorkflowGraph): WorkflowLayout {
  const positions: Record<string, NodePosition> = {
    router: { x: DEFAULT_COLUMN_X[0], y: ROW_Y.mid },
    operational: { x: DEFAULT_COLUMN_X[1], y: ROW_Y.top },
    intake: { x: DEFAULT_COLUMN_X[1], y: ROW_Y.bottom },
    evidence: { x: DEFAULT_COLUMN_X[2], y: ROW_Y.bottom },
    review_strategist: { x: DEFAULT_COLUMN_X[3], y: ROW_Y.bottom - 50 },
    review_auditor: { x: DEFAULT_COLUMN_X[3], y: ROW_Y.bottom + 70 },
    go_gate: { x: DEFAULT_COLUMN_X[4], y: ROW_Y.bottom },
    delivery: { x: DEFAULT_COLUMN_X[6], y: ROW_Y.mid },
    level3: { x: DEFAULT_COLUMN_X[7], y: ROW_Y.mid },
  };

  if (graph) {
    const specialists = graph.nodes.filter((n) => n.kind === "specialist");
    specialists.forEach((n, i) => {
      positions[n.id] = {
        x: DEFAULT_COLUMN_X[5],
        y: 40 + i * 90,
      };
    });
  } else {
    // Default team specialists
    const defaults = ["architect", "help", "marketer", "verifier"];
    defaults.forEach((id, i) => {
      positions[`specialist:${id}`] = {
        x: DEFAULT_COLUMN_X[5],
        y: 40 + i * 90,
      };
    });
  }

  return {
    version: 1,
    positions,
    updatedAt: new Date().toISOString(),
  };
}

export function workflowLayoutPath(cwd: string = process.cwd()): string {
  return path.join(cwd, "config", "workflow-layout.json");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export function validateWorkflowLayout(raw: unknown): LayoutValidationResult {
  const issues: Array<{ path: string; message: string }> = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: "", message: "layout must be an object" }] };
  }
  if (raw.version !== 1) {
    issues.push({ path: "version", message: "version must be 1" });
  }
  if (!isPlainObject(raw.positions)) {
    issues.push({ path: "positions", message: "positions object required" });
  } else {
    for (const [id, pos] of Object.entries(raw.positions)) {
      if (!isPlainObject(pos) || typeof pos.x !== "number" || typeof pos.y !== "number") {
        issues.push({
          path: `positions.${id}`,
          message: "each position needs numeric x and y",
        });
      } else if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        issues.push({
          path: `positions.${id}`,
          message: "x/y must be finite numbers",
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function loadWorkflowLayout(cwd: string = process.cwd()): WorkflowLayout {
  const file = workflowLayoutPath(cwd);
  if (!fs.existsSync(file)) {
    return defaultWorkflowLayout();
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const result = validateWorkflowLayout(raw);
  if (!result.ok) {
    throw new Error(
      `Invalid workflow layout: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
    );
  }
  return raw as WorkflowLayout;
}

export function saveWorkflowLayout(
  cwd: string,
  layout: WorkflowLayout,
  opts: { actor?: string; audit?: boolean } = {}
): WorkflowLayout {
  const result = validateWorkflowLayout(layout);
  if (!result.ok) {
    throw new Error(
      `Invalid workflow layout: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
    );
  }
  const dir = path.join(cwd, "config");
  fs.mkdirSync(dir, { recursive: true });
  const toWrite: WorkflowLayout = {
    version: 1,
    positions: { ...layout.positions },
    updatedAt: new Date().toISOString(),
  };
  const file = workflowLayoutPath(cwd);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, file);
  if (opts.audit !== false) {
    try {
      appendAudit({
        category: "system",
        action: "workflow_layout.save",
        actor: opts.actor || "owner",
        detail: {
          nodeCount: Object.keys(toWrite.positions).length,
          updatedAt: toWrite.updatedAt,
        },
      });
    } catch {
      /* optional */
    }
  }
  return toWrite;
}

/** Merge defaults for any missing locked / specialist nodes. */
export function ensureLayoutForGraph(
  layout: WorkflowLayout,
  graph: WorkflowGraph
): WorkflowLayout {
  const base = defaultWorkflowLayout(graph);
  const positions = { ...base.positions, ...layout.positions };
  let extra = 0;
  for (const n of graph.nodes) {
    if (!positions[n.id]) {
      positions[n.id] = base.positions[n.id] || {
        x: 200 + (extra % 5) * 40,
        y: 200 + Math.floor(extra / 5) * 80,
      };
      extra += 1;
    }
  }
  // Keep locked ids present
  for (const id of LOCKED_NODE_IDS) {
    if (!positions[id]) positions[id] = base.positions[id] || { x: 80, y: 220 };
  }
  return { version: 1, positions, updatedAt: layout.updatedAt };
}
