/**
 * Phase 9 — visual workflow graph ↔ team config serialization + invariants.
 * Layout lives separately in workflowLayout.ts.
 */
import {
  defaultTeamConfig,
  validateTeamConfig,
  type TeamConfig,
  type TeamRoleConfig,
  type TeamRoleModels,
  type TeamRoleStage,
  type TeamValidationIssue,
  type TeamValidationResult,
} from "./teamConfig.js";

export type WorkflowNodeKind =
  | "router"
  | "operational"
  | "intake"
  | "evidence"
  | "review"
  | "go_gate"
  | "specialist"
  | "delivery"
  | "level3";

export type WorkflowNode = {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  /** Locked nodes cannot be removed, bypassed, or illegally reordered. */
  locked: boolean;
  enabled: boolean;
  roleId?: string;
  title?: string;
  mission?: string;
  prompt?: string;
  prefersCloud?: boolean;
  models?: TeamRoleModels;
  tools?: string[];
  temperature?: number;
  numPredict?: number;
  builtin?: boolean;
  stage?: TeamRoleStage;
  outputs?: string[];
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  locked: boolean;
  label?: string;
  kind?: "flow" | "reject_loop" | "branch";
};

export type WorkflowGraph = {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt?: string;
};

export type WorkflowGraphValidationResult = {
  ok: boolean;
  issues: TeamValidationIssue[];
};

/** Structural node ids that must always exist. */
export const LOCKED_NODE_IDS = [
  "router",
  "operational",
  "intake",
  "evidence",
  "review_strategist",
  "review_auditor",
  "go_gate",
  "delivery",
  "level3",
] as const;

const ROLE_ID_RE = /^[a-z][a-z0-9_]{0,47}$/;

function roleById(cfg: TeamConfig, id: string): TeamRoleConfig | undefined {
  return cfg.roles.find((r) => r.id === id);
}

function nodeFromRole(
  id: string,
  kind: WorkflowNodeKind,
  role: TeamRoleConfig | undefined,
  opts: { locked: boolean; label?: string }
): WorkflowNode {
  const label = opts.label || role?.title || id;
  return {
    id,
    kind,
    label,
    locked: opts.locked,
    enabled: role?.enabled !== false,
    roleId: role?.id,
    title: role?.title,
    mission: role?.mission,
    prompt: role?.prompt,
    prefersCloud: role?.prefersCloud,
    models: role ? { ...role.models } : undefined,
    tools: role?.tools ? [...role.tools] : undefined,
    temperature: role?.temperature,
    numPredict: role?.numPredict,
    builtin: role?.builtin,
    stage: role?.stage,
    outputs: role?.outputs ? [...role.outputs] : undefined,
  };
}

/**
 * Build the agency workflow graph from team config.
 * Fixed spine: router → (operational | intake→evidence→review→GO→specialists→delivery→level3)
 */
export function teamConfigToGraph(cfg: TeamConfig): WorkflowGraph {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  nodes.push(
    nodeFromRole("router", "router", roleById(cfg, "ceo_router"), {
      locked: true,
      label: "CEO Router",
    })
  );
  nodes.push(
    nodeFromRole("operational", "operational", roleById(cfg, "operator"), {
      locked: true,
      label: "Operational (L1)",
    })
  );
  nodes.push(
    nodeFromRole("intake", "intake", roleById(cfg, "intake"), {
      locked: true,
      label: "Intake",
    })
  );
  nodes.push(
    nodeFromRole("evidence", "evidence", roleById(cfg, "evidence"), {
      locked: true,
      label: "Evidence",
    })
  );
  nodes.push(
    nodeFromRole("review_strategist", "review", roleById(cfg, "strategist"), {
      locked: true,
      label: "Strategist",
    })
  );
  nodes.push(
    nodeFromRole("review_auditor", "review", roleById(cfg, "auditor"), {
      locked: true,
      label: "Auditor",
    })
  );
  nodes.push({
    id: "go_gate",
    kind: "go_gate",
    label: "GO Gate",
    locked: true,
    enabled: true,
  });

  const byId = new Map(cfg.roles.map((r) => [r.id, r]));
  const specialistIds = [...cfg.pipeline.downstreamOrder];
  // Include custom/downstream roles missing from order (disabled or newly added)
  for (const r of cfg.roles) {
    if (
      (r.stage === "downstream" || (!r.builtin && r.stage !== "review")) &&
      !specialistIds.includes(r.id) &&
      !["ceo_router", "intake", "evidence", "strategist", "auditor", "operator", "implementer", "coder"].includes(
        r.id
      )
    ) {
      specialistIds.push(r.id);
    }
  }

  for (const sid of specialistIds) {
    const role = byId.get(sid);
    if (!role) continue;
    nodes.push(
      nodeFromRole(`specialist:${sid}`, "specialist", role, {
        locked: Boolean(role.builtin),
        label: role.title,
      })
    );
  }

  nodes.push({
    id: "delivery",
    kind: "delivery",
    label: "Delivery",
    locked: true,
    enabled: true,
  });
  nodes.push(
    nodeFromRole("level3", "level3", roleById(cfg, "implementer"), {
      locked: true,
      label: "Level-3 Implement",
    })
  );

  // Edges — locked structural spine
  const E = (
    source: string,
    target: string,
    locked: boolean,
    label?: string,
    kind: WorkflowEdge["kind"] = "flow"
  ): WorkflowEdge => ({
    id: `${source}->${target}`,
    source,
    target,
    locked,
    label,
    kind,
  });

  edges.push(E("router", "operational", true, "operational", "branch"));
  edges.push(E("router", "intake", true, "architecture", "branch"));
  edges.push(E("intake", "evidence", true));
  edges.push(E("evidence", "review_strategist", true));
  edges.push(E("review_strategist", "review_auditor", true));
  edges.push(E("review_auditor", "review_strategist", true, "reject ≤5", "reject_loop"));
  edges.push(E("review_auditor", "go_gate", true, "APPROVED"));

  let prev = "go_gate";
  for (const sid of specialistIds) {
    if (!byId.has(sid)) continue;
    const nid = `specialist:${sid}`;
    edges.push(E(prev, nid, false));
    prev = nid;
  }
  edges.push(E(prev, "delivery", false));
  edges.push(E("delivery", "level3", true, "GO + Level-3"));
  edges.push(E("operational", "delivery", true, "verify", "flow"));

  return {
    version: 1,
    nodes,
    edges,
    updatedAt: cfg.updatedAt,
  };
}

export function defaultWorkflowGraph(): WorkflowGraph {
  return teamConfigToGraph(defaultTeamConfig());
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate graph invariants (UI + server).
 * Review loop + GO gate are locked; cannot remove/bypass/reorder illegally.
 */
export function validateWorkflowGraph(raw: unknown): WorkflowGraphValidationResult {
  const issues: TeamValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: "", message: "workflow graph must be an object" }] };
  }
  if (raw.version !== 1) {
    issues.push({ path: "version", message: "version must be 1" });
  }
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1) {
    issues.push({ path: "nodes", message: "nodes must be a non-empty array" });
  }
  if (!Array.isArray(raw.edges)) {
    issues.push({ path: "edges", message: "edges must be an array" });
  }

  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const byId = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const p = `nodes[${i}]`;
    if (!isPlainObject(n)) {
      issues.push({ path: p, message: "node must be an object" });
      continue;
    }
    const id = String(n.id || "");
    if (!id) issues.push({ path: `${p}.id`, message: "id required" });
    if (byId.has(id)) issues.push({ path: `${p}.id`, message: `duplicate node id "${id}"` });
    byId.set(id, n);
    if (typeof n.locked !== "boolean") {
      issues.push({ path: `${p}.locked`, message: "locked must be boolean" });
    }
    if (typeof n.enabled !== "boolean") {
      issues.push({ path: `${p}.enabled`, message: "enabled must be boolean" });
    }
    if (n.kind === "specialist") {
      const roleId = String(n.roleId || "").trim();
      if (!ROLE_ID_RE.test(roleId)) {
        issues.push({ path: `${p}.roleId`, message: `invalid role id "${roleId}"` });
      }
      if (n.builtin === false && !String(n.prompt || "").trim()) {
        issues.push({
          path: `${p}.prompt`,
          message: "custom specialist roles require a prompt",
        });
      }
      if (
        !isPlainObject(n.models) ||
        typeof n.models.local !== "string" ||
        typeof n.models.cloud !== "string"
      ) {
        issues.push({
          path: `${p}.models`,
          message: "models.local and models.cloud required for specialist nodes",
        });
      }
    }
  }

  for (const lockedId of LOCKED_NODE_IDS) {
    if (!byId.has(lockedId)) {
      issues.push({
        path: "nodes",
        message: `missing locked node "${lockedId}" (cannot remove review loop / GO gate / spine)`,
      });
    } else {
      const n = byId.get(lockedId)!;
      if (n.locked !== true) {
        issues.push({
          path: `nodes.${lockedId}.locked`,
          message: `"${lockedId}" must remain locked`,
        });
      }
      if (
        (lockedId === "review_strategist" ||
          lockedId === "review_auditor" ||
          lockedId === "go_gate") &&
        n.enabled === false
      ) {
        issues.push({
          path: `nodes.${lockedId}.enabled`,
          message: `"${lockedId}" cannot be disabled (pipeline invariant)`,
        });
      }
    }
  }

  const edgeKeys = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const p = `edges[${i}]`;
    if (!isPlainObject(e)) {
      issues.push({ path: p, message: "edge must be an object" });
      continue;
    }
    const source = String(e.source || "");
    const target = String(e.target || "");
    if (!byId.has(source)) {
      issues.push({ path: `${p}.source`, message: `unknown source "${source}"` });
    }
    if (!byId.has(target)) {
      issues.push({ path: `${p}.target`, message: `unknown target "${target}"` });
    }
    edgeKeys.add(`${source}->${target}`);
  }

  // Required locked edges (cannot bypass review / GO)
  const requiredLockedEdges: Array<[string, string]> = [
    ["router", "operational"],
    ["router", "intake"],
    ["intake", "evidence"],
    ["evidence", "review_strategist"],
    ["review_strategist", "review_auditor"],
    ["review_auditor", "review_strategist"],
    ["review_auditor", "go_gate"],
    ["delivery", "level3"],
  ];
  for (const [s, t] of requiredLockedEdges) {
    if (!edgeKeys.has(`${s}->${t}`)) {
      issues.push({
        path: "edges",
        message: `missing required locked edge ${s} → ${t} (cannot bypass review loop / GO gate)`,
      });
    }
  }

  // go_gate must reach delivery without skipping into review illegally
  // Specialists may only sit between go_gate and delivery
  for (const [id, n] of byId) {
    if (n.kind === "specialist") {
      // Must not be wired as bypass around go_gate into delivery from evidence
      const incoming = edges.filter(
        (e) => isPlainObject(e) && String(e.target) === id
      ) as Array<Record<string, unknown>>;
      const outgoing = edges.filter(
        (e) => isPlainObject(e) && String(e.source) === id
      ) as Array<Record<string, unknown>>;
      for (const e of incoming) {
        const src = String(e.source);
        if (
          src === "evidence" ||
          src === "intake" ||
          src === "review_strategist" ||
          src === "review_auditor" ||
          src === "router"
        ) {
          issues.push({
            path: "edges",
            message: `illegal edge ${src} → ${id}: specialists cannot bypass review loop / GO gate`,
          });
        }
      }
      for (const e of outgoing) {
        const tgt = String(e.target);
        if (tgt === "review_strategist" || tgt === "review_auditor" || tgt === "go_gate") {
          issues.push({
            path: "edges",
            message: `illegal edge ${id} → ${tgt}: cannot reorder into locked review/GO spine`,
          });
        }
      }
      if (incoming.length === 0 || outgoing.length === 0) {
        issues.push({
          path: `nodes.${id}`,
          message: `specialist "${id}" must stay on the post-GO chain (connect after go_gate, before delivery)`,
        });
      }
    }
  }

  // Direct bypass evidence → delivery or auditor → delivery without go_gate
  if (edgeKeys.has("evidence->delivery") || edgeKeys.has("review_auditor->delivery")) {
    issues.push({
      path: "edges",
      message: "cannot bypass GO gate: review must flow through go_gate before delivery",
    });
  }
  if (edgeKeys.has("evidence->level3") || edgeKeys.has("go_gate->level3")) {
    // go_gate→level3 skipping specialists+delivery is illegal
    if (edgeKeys.has("go_gate->level3")) {
      issues.push({
        path: "edges",
        message: "cannot bypass delivery: go_gate must not connect directly to level3",
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Walk specialist chain from go_gate until delivery.
 */
export function extractDownstreamOrder(graph: WorkflowGraph): string[] {
  const out: string[] = [];
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind === "reject_loop") continue;
    const list = outgoing.get(e.source) || [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }
  let cur = "go_gate";
  const seen = new Set<string>();
  while (true) {
    const nexts = (outgoing.get(cur) || []).filter((t) => t !== "delivery" || cur === "go_gate" || cur.startsWith("specialist:"));
    // Prefer specialist targets; then delivery
    const specialistNext = nexts.find((t) => t.startsWith("specialist:"));
    const deliveryNext = nexts.find((t) => t === "delivery");
    const nxt = specialistNext || deliveryNext;
    if (!nxt) break;
    if (seen.has(nxt)) break;
    seen.add(nxt);
    if (nxt.startsWith("specialist:")) {
      const roleId = nxt.slice("specialist:".length);
      out.push(roleId);
      cur = nxt;
      continue;
    }
    break;
  }
  return out;
}

/**
 * Convert graph → TeamConfig (merging role fields from specialist + fixed role nodes).
 */
export function graphToTeamConfig(
  graph: WorkflowGraph,
  base?: TeamConfig
): { config: TeamConfig; validation: TeamValidationResult; graphValidation: WorkflowGraphValidationResult } {
  const graphValidation = validateWorkflowGraph(graph);
  const baseCfg = base ? structuredClone(base) : defaultTeamConfig();
  const roleMap = new Map(baseCfg.roles.map((r) => [r.id, { ...r, models: { ...r.models } }]));

  const applyRoleNode = (node: WorkflowNode, roleId: string) => {
    const prev = roleMap.get(roleId);
    if (!prev && node.kind !== "specialist") return;
    if (!prev) {
      // new custom
      if (!node.models?.local || !node.models?.cloud) return;
      roleMap.set(roleId, {
        id: roleId,
        title: node.title || node.label || roleId,
        mission: node.mission || "",
        enabled: node.enabled !== false,
        builtin: false,
        prefersCloud: Boolean(node.prefersCloud),
        models: {
          local: node.models.local,
          cloud: node.models.cloud,
          free: node.models.free ?? null,
        },
        prompt: node.prompt || "",
        tools: node.tools || ["write_report", "write_file", "read_file", "list_dir", "finish"],
        temperature: node.temperature ?? 0.3,
        numPredict: node.numPredict ?? 1000,
        order: 500,
        stage: "downstream",
        outputs: node.outputs || [`${roleId}-output.md`],
      });
      return;
    }
    roleMap.set(roleId, {
      ...prev,
      title: node.title || prev.title,
      mission: node.mission ?? prev.mission,
      enabled: node.enabled,
      prefersCloud: node.prefersCloud ?? prev.prefersCloud,
      models: node.models
        ? {
            local: node.models.local || prev.models.local,
            cloud: node.models.cloud || prev.models.cloud,
            free: node.models.free ?? prev.models.free ?? null,
          }
        : prev.models,
      prompt: node.prompt ?? prev.prompt,
      tools: node.tools ?? prev.tools,
      temperature: node.temperature ?? prev.temperature,
      numPredict: node.numPredict ?? prev.numPredict,
      outputs: node.outputs ?? prev.outputs,
      stage: prev.builtin ? prev.stage : node.stage || prev.stage,
    });
  };

  for (const node of graph.nodes) {
    if (node.roleId) applyRoleNode(node, node.roleId);
    else if (node.kind === "specialist" && node.id.startsWith("specialist:")) {
      applyRoleNode(node, node.id.slice("specialist:".length));
    }
  }

  // Drop custom roles removed from graph
  const specialistRoleIds = new Set(
    graph.nodes
      .filter((n) => n.kind === "specialist")
      .map((n) => n.roleId || n.id.replace(/^specialist:/, ""))
  );
  for (const [id, role] of [...roleMap.entries()]) {
    if (!role.builtin && role.stage === "downstream" && !specialistRoleIds.has(id)) {
      roleMap.delete(id);
    }
  }

  const downstreamOrder = extractDownstreamOrder(graph);
  // Ensure all specialist nodes appear
  for (const id of specialistRoleIds) {
    if (!downstreamOrder.includes(id)) downstreamOrder.push(id);
  }

  const config: TeamConfig = {
    version: 1,
    updatedAt: graph.updatedAt || new Date().toISOString(),
    roles: [...roleMap.values()],
    pipeline: {
      downstreamOrder,
      keepReviewLoop: true,
      keepGoGate: true,
    },
  };

  const validation = validateTeamConfig(config);
  return { config, validation, graphValidation };
}

/**
 * Apply a draft graph to produce a validated TeamConfig or throw with issues.
 */
export function applyGraphToTeamConfig(graph: WorkflowGraph, base?: TeamConfig): TeamConfig {
  const { config, validation, graphValidation } = graphToTeamConfig(graph, base);
  const issues = [...graphValidation.issues, ...validation.issues];
  if (issues.length) {
    throw new Error(
      `Invalid workflow graph: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
    );
  }
  return config;
}

/** Round-trip helper for tests. */
export function roundTripTeamConfig(cfg: TeamConfig): TeamConfig {
  const graph = teamConfigToGraph(cfg);
  return applyGraphToTeamConfig(graph, cfg);
}

/**
 * UI/server helper: attempt to delete a node; returns error if locked.
 */
export function assertCanDeleteNode(graph: WorkflowGraph, nodeId: string): TeamValidationIssue | null {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return { path: nodeId, message: `node not found: ${nodeId}` };
  if (node.locked) {
    return {
      path: nodeId,
      message: `locked node "${nodeId}" cannot be deleted (review loop / GO gate / spine invariant)`,
    };
  }
  if (node.builtin) {
    return {
      path: nodeId,
      message: `builtin specialist "${nodeId}" cannot be deleted — disable it instead`,
    };
  }
  return null;
}

/**
 * Reorder specialist chain. Locked spine untouched.
 */
export function reorderSpecialists(
  graph: WorkflowGraph,
  order: string[]
): WorkflowGraph {
  const next = structuredClone(graph);
  const specialistNodes = next.nodes.filter((n) => n.kind === "specialist");
  const byRole = new Map(
    specialistNodes.map((n) => [n.roleId || n.id.replace(/^specialist:/, ""), n])
  );
  for (const id of order) {
    if (!byRole.has(id)) {
      throw new Error(`Unknown specialist role "${id}"`);
    }
  }
  // Remove non-locked edges from go_gate through specialists to delivery
  next.edges = next.edges.filter((e) => {
    if (e.locked && e.source !== "go_gate") return true;
    if (e.source === "go_gate" && e.target.startsWith("specialist:")) return false;
    if (e.source.startsWith("specialist:")) return false;
    if (e.target === "delivery" && e.source.startsWith("specialist:")) return false;
    if (e.source === "go_gate" && e.target === "delivery") return false;
    return true;
  });

  const mk = (source: string, target: string): WorkflowEdge => ({
    id: `${source}->${target}`,
    source,
    target,
    locked: false,
    kind: "flow",
  });
  let prev = "go_gate";
  for (const id of order) {
    const nid = `specialist:${id}`;
    next.edges.push(mk(prev, nid));
    prev = nid;
  }
  next.edges.push(mk(prev, "delivery"));
  return next;
}
