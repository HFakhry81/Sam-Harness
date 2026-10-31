/**
 * Phase 9 — visual workflow graph: serialization, invariants, layout, undo/redo, API.
 * Offline (no CDN).
 */
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  __resetTeamConfigCacheForTests,
  defaultTeamConfig,
  loadTeamConfig,
  saveTeamConfig,
  upsertTeamRole,
  validateTeamConfig,
} from "../src/agency/teamConfig.js";
import {
  applyGraphToTeamConfig,
  assertCanDeleteNode,
  extractDownstreamOrder,
  graphToTeamConfig,
  reorderSpecialists,
  roundTripTeamConfig,
  teamConfigToGraph,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "../src/agency/workflowGraph.js";
import { WorkflowHistory } from "../src/agency/workflowHistory.js";
import {
  defaultWorkflowLayout,
  ensureLayoutForGraph,
  loadWorkflowLayout,
  saveWorkflowLayout,
  validateWorkflowLayout,
} from "../src/agency/workflowLayout.js";
import { getPersistence } from "../src/lib/db/index.js";
import { makeIsolatedCpEnv } from "./helpers/isolatedCpEnv.js";
import {
  waitForListenPort,
  waitForLocalHealth,
} from "./helpers/ephemeralPort.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let tmp: string;
let prevCwd: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-p9-"));
  prevCwd = process.cwd();
  process.chdir(tmp);
  fs.mkdirSync(path.join(tmp, "config"), { recursive: true });
  saveTeamConfig(tmp, defaultTeamConfig(), { audit: false });
  __resetTeamConfigCacheForTests();
  getPersistence();
});

afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  __resetTeamConfigCacheForTests();
});

describe("graph ↔ team config round-trip", () => {
  it("preserves downstream order and review invariants", () => {
    const cfg = loadTeamConfig(tmp);
    cfg.pipeline.downstreamOrder = ["verifier", "architect", "help", "marketer"];
    saveTeamConfig(tmp, cfg, { audit: false });
    const again = roundTripTeamConfig(loadTeamConfig(tmp));
    expect(again.pipeline.keepReviewLoop).toBe(true);
    expect(again.pipeline.keepGoGate).toBe(true);
    expect(again.pipeline.downstreamOrder).toEqual([
      "verifier",
      "architect",
      "help",
      "marketer",
    ]);
    expect(again.roles.find((r) => r.id === "strategist")?.stage).toBe("review");
    expect(again.roles.find((r) => r.id === "auditor")?.stage).toBe("review");
  });

  it("round-trips custom specialist roles", () => {
    upsertTeamRole(tmp, {
      id: "research_analyst",
      title: "Research",
      prompt: "Cite sources.",
      stage: "downstream",
      prefersCloud: false,
      models: { local: "qwen2.5:1.5b", cloud: "gemma4:cloud", free: null },
    });
    const cfg = loadTeamConfig(tmp);
    let graph = teamConfigToGraph(cfg);
    graph = reorderSpecialists(graph, [
      "architect",
      "research_analyst",
      "help",
      "marketer",
      "verifier",
    ]);
    const back = applyGraphToTeamConfig(graph, cfg);
    expect(back.pipeline.downstreamOrder).toEqual([
      "architect",
      "research_analyst",
      "help",
      "marketer",
      "verifier",
    ]);
    expect(back.roles.find((r) => r.id === "research_analyst")?.prompt).toMatch(/Cite/);
  });

  it("extractDownstreamOrder follows go_gate chain", () => {
    const graph = teamConfigToGraph(loadTeamConfig(tmp));
    expect(extractDownstreamOrder(graph)).toEqual([
      "architect",
      "help",
      "marketer",
      "verifier",
    ]);
  });
});

describe("invariant validation (server-side)", () => {
  it("rejects removing review / GO locked nodes", () => {
    const graph = teamConfigToGraph(loadTeamConfig(tmp));
    graph.nodes = graph.nodes.filter((n) => n.id !== "go_gate");
    const v = validateWorkflowGraph(graph);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => /go_gate/.test(i.message))).toBe(true);
  });

  it("rejects unlocking review nodes", () => {
    const graph = teamConfigToGraph(loadTeamConfig(tmp));
    const strat = graph.nodes.find((n) => n.id === "review_strategist")!;
    strat.locked = false;
    expect(validateWorkflowGraph(graph).ok).toBe(false);
  });

  it("rejects bypassing GO gate (auditor → delivery)", () => {
    const graph = teamConfigToGraph(loadTeamConfig(tmp));
    graph.edges = graph.edges.filter((e) => e.id !== "review_auditor->go_gate");
    graph.edges.push({
      id: "review_auditor->delivery",
      source: "review_auditor",
      target: "delivery",
      locked: false,
      kind: "flow",
    });
    const v = validateWorkflowGraph(graph);
    expect(v.ok).toBe(false);
    expect(
      v.issues.some((i) =>
        /bypass|go_gate|missing required locked edge/i.test(`${i.path} ${i.message}`)
      )
    ).toBe(true);
  });

  it("rejects deleting locked nodes via assertCanDeleteNode", () => {
    const graph = teamConfigToGraph(loadTeamConfig(tmp));
    expect(assertCanDeleteNode(graph, "go_gate")).toBeTruthy();
    expect(assertCanDeleteNode(graph, "review_auditor")).toBeTruthy();
  });

  it("rejects custom specialist without prompt (graph + team)", () => {
    const base = loadTeamConfig(tmp);
    let graph = teamConfigToGraph(base);
    graph.nodes.push({
      id: "specialist:orphan_bot",
      kind: "specialist",
      label: "Orphan",
      locked: false,
      enabled: true,
      roleId: "orphan_bot",
      title: "Orphan",
      builtin: false,
      stage: "downstream",
      prompt: "",
      models: { local: "qwen2.5:1.5b", cloud: "gemma4:cloud", free: null },
    });
    graph = reorderSpecialists(graph, [
      ...extractDownstreamOrder(graph),
      "orphan_bot",
    ]);
    const gv = validateWorkflowGraph(graph);
    expect(gv.ok).toBe(false);
    expect(gv.issues.some((i) => /prompt/i.test(i.message))).toBe(true);
    const { validation } = graphToTeamConfig(graph, base);
    // team side also flags custom downstream without prompt
    expect(validation.ok).toBe(false);
  });

  it("keeps team validation aligned after legal reorder", () => {
    const graph = reorderSpecialists(teamConfigToGraph(loadTeamConfig(tmp)), [
      "marketer",
      "verifier",
      "architect",
      "help",
    ]);
    expect(validateWorkflowGraph(graph).ok).toBe(true);
    const cfg = applyGraphToTeamConfig(graph, loadTeamConfig(tmp));
    expect(validateTeamConfig(cfg).ok).toBe(true);
    expect(cfg.pipeline.downstreamOrder).toEqual([
      "marketer",
      "verifier",
      "architect",
      "help",
    ]);
  });
});

describe("layout persistence (separate from semantic config)", () => {
  it("validates and saves layout without touching team.json", () => {
    const before = fs.readFileSync(path.join(tmp, "config", "team.json"), "utf-8");
    const graph = teamConfigToGraph(loadTeamConfig(tmp));
    const layout = defaultWorkflowLayout(graph);
    layout.positions.router = { x: 12, y: 34 };
    const saved = saveWorkflowLayout(tmp, layout, { audit: false });
    expect(saved.positions.router).toEqual({ x: 12, y: 34 });
    expect(fs.existsSync(path.join(tmp, "config", "workflow-layout.json"))).toBe(true);
    const after = fs.readFileSync(path.join(tmp, "config", "team.json"), "utf-8");
    expect(after).toBe(before);
    const loaded = loadWorkflowLayout(tmp);
    expect(loaded.positions.router.x).toBe(12);
    const ensured = ensureLayoutForGraph(loaded, graph);
    expect(ensured.positions["specialist:architect"]).toBeTruthy();
  });

  it("rejects non-finite positions", () => {
    expect(
      validateWorkflowLayout({
        version: 1,
        positions: { router: { x: Number.NaN, y: 1 } },
      }).ok
    ).toBe(false);
  });
});

describe("undo/redo history", () => {
  it("undoes and redoes graph drafts", () => {
    const h = new WorkflowHistory<WorkflowGraph>(10);
    const g0 = teamConfigToGraph(defaultTeamConfig());
    h.reset(g0, "init");
    const g1 = reorderSpecialists(g0, ["verifier", "architect", "help", "marketer"]);
    h.push(g1, "reorder");
    expect(extractDownstreamOrder(h.current!)).toEqual([
      "verifier",
      "architect",
      "help",
      "marketer",
    ]);
    const back = h.undo()!;
    expect(extractDownstreamOrder(back)).toEqual([
      "architect",
      "help",
      "marketer",
      "verifier",
    ]);
    expect(h.canRedo).toBe(true);
    const fwd = h.redo()!;
    expect(extractDownstreamOrder(fwd)[0]).toBe("verifier");
    h.push(reorderSpecialists(fwd, ["help", "architect", "marketer", "verifier"]), "again");
    expect(h.canRedo).toBe(false);
    expect(h.undoDepth).toBeGreaterThan(0);
  });

  it("skips no-op pushes", () => {
    const h = new WorkflowHistory<{ n: number }>();
    h.reset({ n: 1 });
    h.push({ n: 1 });
    expect(h.undoDepth).toBe(0);
    h.push({ n: 2 });
    expect(h.undoDepth).toBe(1);
  });
});

describe("Control Plane workflow API", () => {
  // Ephemeral CONTROL_PLANE_PORT=0 on 127.0.0.1 — avoids Windows fixed-port conflicts
  let PORT = 0;
  const TOKEN = "phase9-test-owner-token-0123456789abcdef";
  let child: ChildProcess | null = null;
  let cpIso: ReturnType<typeof makeIsolatedCpEnv> | null = null;
  let layoutBackup: string | null = null;
  let teamBackup: string | null = null;

  beforeAll(async () => {
    const teamPath = path.join(REPO_ROOT, "config", "team.json");
    const layoutPath = path.join(REPO_ROOT, "config", "workflow-layout.json");
    teamBackup = fs.existsSync(teamPath) ? fs.readFileSync(teamPath, "utf-8") : null;
    layoutBackup = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, "utf-8") : null;

    cpIso = makeIsolatedCpEnv({
      CONTROL_PLANE_PORT: "0",
      CONTROL_PLANE_TOKEN: TOKEN,
    });
    const tsxBin = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    child = spawn(process.execPath, [tsxBin, path.join(REPO_ROOT, "src/controlplane/server.ts")], {
      cwd: REPO_ROOT,
      env: cpIso.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    PORT = await waitForListenPort(child!, 20000);
    await waitForLocalHealth(PORT, "/api/auth/status", 15000);
  }, 30000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    cpIso?.cleanup();
    const teamPath = path.join(REPO_ROOT, "config", "team.json");
    const layoutPath = path.join(REPO_ROOT, "config", "workflow-layout.json");
    if (teamBackup != null) fs.writeFileSync(teamPath, teamBackup);
    if (layoutBackup != null) fs.writeFileSync(layoutPath, layoutBackup);
    else if (layoutBackup === null && fs.existsSync(layoutPath)) {
      fs.rmSync(layoutPath, { force: true });
    }
  });

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Origin: `http://127.0.0.1:${PORT}`,
    };
  }

  it("GET /api/workflow returns graph + layout + routing", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/workflow`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.graph.nodes.some((n: { id: string }) => n.id === "go_gate")).toBe(true);
    expect(body.graph.nodes.some((n: { id: string }) => n.id === "review_auditor")).toBe(true);
    expect(body.layout.positions.router).toBeTruthy();
    expect(Array.isArray(body.routing)).toBe(true);
  });

  it("POST /api/workflow/validate catches invariant breaks", async () => {
    const load = await fetch(`http://127.0.0.1:${PORT}/api/workflow`, {
      headers: authHeaders(),
    }).then((r) => r.json());
    const graph = structuredClone(load.graph) as WorkflowGraph;
    graph.nodes = graph.nodes.filter((n) => n.id !== "review_strategist");
    const res = await fetch(`http://127.0.0.1:${PORT}/api/workflow/validate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ graph }),
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.graphIssues?.length).toBeGreaterThan(0);
  });

  it("PUT layout then graph apply/load round-trips", async () => {
    const load = await fetch(`http://127.0.0.1:${PORT}/api/workflow`, {
      headers: authHeaders(),
    }).then((r) => r.json());
    const layout = structuredClone(load.layout);
    layout.positions.router = { x: 111, y: 222 };
    const layoutRes = await fetch(`http://127.0.0.1:${PORT}/api/workflow/layout`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ layout }),
    });
    expect((await layoutRes.json()).ok).toBe(true);

    let graph = structuredClone(load.graph) as WorkflowGraph;
    graph = reorderSpecialists(graph, ["help", "architect", "verifier", "marketer"]);
    const applyRes = await fetch(`http://127.0.0.1:${PORT}/api/workflow/graph`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ graph }),
    });
    const applied = await applyRes.json();
    expect(applied.ok).toBe(true);
    expect(applied.applied).toBe(true);
    expect(applied.config.pipeline.downstreamOrder).toEqual([
      "help",
      "architect",
      "verifier",
      "marketer",
    ]);

    const again = await fetch(`http://127.0.0.1:${PORT}/api/workflow`, {
      headers: authHeaders(),
    }).then((r) => r.json());
    expect(again.layout.positions.router).toEqual({ x: 111, y: 222 });
    expect(extractDownstreamOrder(again.graph)).toEqual([
      "help",
      "architect",
      "verifier",
      "marketer",
    ]);

    await fetch(`http://127.0.0.1:${PORT}/api/workflow/reset`, {
      method: "POST",
      headers: authHeaders(),
      body: "{}",
    });
  });

  it("draft mode does not write team.json", async () => {
    const teamPath = path.join(REPO_ROOT, "config", "team.json");
    const before = fs.readFileSync(teamPath, "utf-8");
    const load = await fetch(`http://127.0.0.1:${PORT}/api/workflow`, {
      headers: authHeaders(),
    }).then((r) => r.json());
    const res = await fetch(`http://127.0.0.1:${PORT}/api/workflow/graph`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ graph: load.graph, draft: true }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(false);
    expect(fs.readFileSync(teamPath, "utf-8")).toBe(before);
  });
});
