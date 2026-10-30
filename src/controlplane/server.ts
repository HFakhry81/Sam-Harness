/**
 * Sam-Harness Control Plane — compose → run → session report → ready for next task.
 */
import "./../lib/loadEnv.js";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import {
  buildTaskDraft,
  persistComposeDraft,
  readComposeDraft,
  readCurrentTaskMeta,
  writeTaskFiles,
  type TaskDraft,
  type TaskDraftInput,
  type UiRoute,
} from "./taskWriter.js";
import { readTaskSpec } from "./taskSpec.js";
import { listAllowlistRoots } from "../lib/paths.js";
import { beginCostRun, endCostRun, getCostBudget } from "../lib/costLedger.js";
import {
  loadSession,
  readExecutionArtifacts,
  resetSession,
  saveSession,
  type AgencySession,
  type SessionEntry,
} from "./session.js";
import {
  archiveAndClearOnSuccess,
  assertNotRepeatSuccess,
  buildRunReport,
  retainOnFailure,
} from "./taskLifecycle.js";
import {
  addDailyJob,
  loadDailyOps,
  removeDailyJob,
  toggleDailyJob,
} from "./dailyOps.js";
import { loadHybridProfile, saveHybridProfile } from "./hybridProfile.js";
import { loadMemory, removeMemory, seedHarnessLessons, upsertMemory } from "./projectMemory.js";
import { createCommDraft, loadComms, requestCommSend } from "./comms.js";
import { loadRollbackJournal } from "../agency/delivery/rollbackJournal.js";
import {
  listRunArtifacts,
  openArtifactInOs,
  readArtifactText,
} from "./artifacts.js";
import { appendRunLesson, parseRunQualityFlags } from "./runLessons.js";
import {
  authenticateRequest,
  clearSessionCookieHeader,
  createSession,
  destroySession,
  isAllowedHost,
  isAllowedOrigin,
  loadOrCreateOwnerToken,
  parseCookies,
  SESSION_COOKIE,
  sessionCookieHeader,
  timingSafeEqualString,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.CONTROL_PLANE_PORT || 8787);
const OWNER_TOKEN = loadOrCreateOwnerToken(ROOT);

type RunMode = "agency" | "implement" | "smoke" | "legacy";
type UiPhase = "idle" | "running" | "done";

type SseClient = { id: number; res: http.ServerResponse };
let sseId = 0;
const sseClients = new Map<number, SseClient>();
let activeChild: ChildProcessWithoutNullStreams | null = null;
let session: AgencySession = loadSession(ROOT);
let currentDraft: TaskDraft | null = null;
let runLogBuffer = "";
let smokePending = 0;

let lastRun: {
  mode: RunMode;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  running: boolean;
  phase: UiPhase;
} | null = null;

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function broadcast(event: string, payload: unknown) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of sseClients.values()) {
    c.res.write(line);
  }
}

function serveStatic(reqPath: string, res: http.ServerResponse) {
  let rel = reqPath === "/" ? "/index.html" : reqPath;
  rel = rel.replace(/\?.*$/, "");
  const abs = path.normalize(path.join(PUBLIC, rel));
  if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": contentType(abs) });
  fs.createReadStream(abs).pipe(res);
}

async function readTaskConfig(): Promise<{
  id: string | null;
  route: UiRoute | null;
  title: string | null;
  targetRepo: string | null;
  body?: string;
}> {
  try {
    const mod = await import(
      pathToFileURL(path.join(ROOT, "task.ts")).href + `?t=${Date.now()}`
    );
    const cfg = mod.taskConfig || mod.default;
    return {
      id: cfg?.id ?? null,
      route: cfg?.route ?? null,
      title: cfg?.title ?? null,
      targetRepo: cfg?.targetRepo ?? null,
      body: cfg?.body,
    };
  } catch {
    return { id: null, route: null, title: null, targetRepo: null };
  }
}

async function handleCompose(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  const body = JSON.parse(raw || "{}") as TaskDraftInput & {
    save?: boolean;
    answers?: Record<string, string>;
    forceSave?: boolean;
  };
  const draft = buildTaskDraft({
    ...body,
    answers: body.answers,
  });

  const clarify =
    !draft.ready &&
    draft.needsClarification.length > 0 &&
    body.forceSave !== true;

  // Always keep a recoverable draft (prompt must not vanish from the UI)
  persistComposeDraft(ROOT, draft, body.prompt || draft.spec.rawPrompt || "");

  if (body.save === false || clarify) {
    sendJson(res, 200, {
      ok: true,
      draft: {
        ...draft,
      },
      saved: false,
      needsClarification: draft.needsClarification,
      confidence: draft.confidence,
      ready: draft.ready,
      spec: draft.spec,
      clarify,
      draftPersisted: true,
    });
    return;
  }

  // Never overwrite canonical task.* while an agent run is live (prevents goal contamination)
  if (activeChild) {
    sendJson(res, 409, {
      ok: false,
      error:
        "تشغيل جارٍ — لن يُستبدل task.ts/md حتى ينتهي. المسودة محفوظة؛ أعد الحفظ بعد الانتهاء.",
      saved: false,
      draftPersisted: true,
      blockedWhileRunning: true,
      draft,
      spec: draft.spec,
      confidence: draft.confidence,
      ready: draft.ready,
    });
    return;
  }

  try {
    const files = writeTaskFiles(ROOT, draft);
    currentDraft = draft;
    broadcast("task", { draft, files, spec: draft.spec });
    sendJson(res, 200, {
      ok: true,
      draft,
      saved: true,
      files,
      needsClarification: [],
      confidence: draft.confidence,
      ready: true,
      spec: draft.spec,
      clarify: false,
    });
  } catch (e: any) {
    sendJson(res, 400, {
      ok: false,
      error: e?.message || String(e),
      needsClarification: draft.needsClarification,
      confidence: draft.confidence,
      ready: draft.ready,
      spec: draft.spec,
      clarify: true,
    });
  }
}

function runArgsForMode(mode: RunMode): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
  // Invoke tsx directly — avoids pnpm forwarding a bare "--" that used to become the task text
  const tsxCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  if (mode === "smoke") {
    return { cmd: tsxCmd, args: ["run", "smoke:agency"] };
  }
  if (mode === "implement") {
    return {
      cmd: tsxCmd,
      args: ["exec", "tsx", "index.ts", "--yes", "--implement", "--go"],
    };
  }
  if (mode === "legacy") {
    return {
      cmd: tsxCmd,
      args: ["exec", "tsx", "index.ts", "--yes"],
      env: { ...process.env, AGENCY_MODE: "0" },
    };
  }
  const nodeOpts = [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ");
  return {
    cmd: tsxCmd,
    args: ["exec", "tsx", "index.ts", "--yes"],
    env: { ...process.env, NODE_OPTIONS: nodeOpts },
  };
}

function appendLog(text: string) {
  runLogBuffer += text;
  if (runLogBuffer.length > 80000) {
    runLogBuffer = runLogBuffer.slice(-60000);
  }
  broadcast("log", { stream: "out", text });
}

async function finalizeRun(mode: RunMode, exitCode: number | null) {
  endCostRun();
  const endedAt = new Date().toISOString();
  if (lastRun) {
    lastRun.running = false;
    lastRun.exitCode = exitCode;
    lastRun.endedAt = endedAt;
    lastRun.phase = "done";
  }

  const cfg = await readTaskConfig();
  const arts = readExecutionArtifacts(ROOT);
  // Prefer tool-level success from final-report (file may have ## Verification appended)
  // Ignore stale artifacts older than this run's start (architecture crash left old ops report)
  let success = exitCode === 0;
  let auditPassed: boolean | null = null;
  let goalPassed: boolean | null = null;
  let goalFidelityScore: number | null = null;
  const startedMs = lastRun?.startedAt ? Date.parse(lastRun.startedAt) : 0;
  try {
    const fr = path.join(ROOT, "final-report.md");
    let qualityBlob = arts.summary || "";
    if (fs.existsSync(fr)) {
      const st = fs.statSync(fr);
      const fresh = !startedMs || st.mtimeMs >= startedMs - 2000;
      if (fresh) {
        const raw = fs.readFileSync(fr, "utf-8");
        qualityBlob += "\n" + raw;
        const jsonMatch = raw.match(/\{[\s\S]*?\n\}/);
        if (jsonMatch) {
          const j = JSON.parse(jsonMatch[0]) as { success?: boolean };
          if (typeof j.success === "boolean") success = j.success && exitCode === 0;
        }
        if (/verified\s*=\s*false/i.test(raw)) success = false;
      } else if (exitCode !== 0) {
        success = false;
      }
    }
    const er = path.join(ROOT, "execution-result.md");
    if (fs.existsSync(er)) {
      const st = fs.statSync(er);
      if (!startedMs || st.mtimeMs >= startedMs - 2000) {
        const erText = fs.readFileSync(er, "utf-8");
        qualityBlob += "\n" + erText;
        if (/\[FAIL\]/i.test(erText)) success = false;
        if (/auditPassed:\s*false/i.test(erText) || /gate:\s*CLOSED/i.test(erText)) {
          success = false;
        }
        if (/goalPassed:\s*false/i.test(erText)) success = false;
      }
    }
    if (/\[Error\] Fatal:|UNABLE_TO_VERIFY|fetch failed/i.test(runLogBuffer)) {
      success = false;
    }
    const flags = parseRunQualityFlags(qualityBlob);
    auditPassed = flags.auditPassed;
    goalPassed = flags.goalPassed ?? flags.verified;
    goalFidelityScore = flags.goalFidelityScore;
    if (flags.verified === false) success = false;
    if (flags.goalPassed === false) success = false;
    if (flags.auditPassed === false) success = false;
  } catch {
    /* keep exit-based */
  }

  const title = currentDraft?.title || cfg.title || "Untitled task";
  const body = currentDraft?.body || cfg.body || "";
  const route = currentDraft?.route || cfg.route || "unknown";

  let taskLifecycle: "cleared" | "retained" | "unchanged" = "unchanged";
  if (mode !== "smoke") {
    if (success) {
      archiveAndClearOnSuccess(ROOT, {
        title,
        body,
        summary: arts.summary,
      });
      taskLifecycle = "cleared";
      currentDraft = null;
    } else {
      retainOnFailure(ROOT, {
        title,
        body,
        reason: arts.summary || `exit ${exitCode}`,
      });
      taskLifecycle = "retained";
    }
  }

  const report = buildRunReport({
    success,
    title,
    route: String(route),
    mode,
    summary: arts.summary,
    artifacts: arts.artifacts,
    taskLifecycle,
    auditPassed,
    goalPassed,
    goalFidelityScore,
  });

  const entry: SessionEntry = {
    id: `run-${Date.now().toString(36)}`,
    title,
    route,
    mode,
    promptPreview: body
      .replace(/^[\s\S]*?## Goal\s*\n/i, "")
      .split(/\n## /)[0]
      .trim()
      .slice(0, 400),
    targetRepo: currentDraft?.targetRepo || cfg.targetRepo || undefined,
    startedAt: lastRun?.startedAt || endedAt,
    endedAt,
    exitCode,
    success,
    summary: arts.summary,
    artifacts: arts.artifacts,
    logTail: runLogBuffer.slice(-2500),
    auditPassed,
    goalPassed,
    goalFidelityScore,
    report,
    taskLifecycle,
  };
  session.entries.unshift(entry);
  if (session.entries.length > 50) session.entries.length = 50;
  saveSession(ROOT, session);

  try {
    appendRunLesson(ROOT, {
      title,
      route: String(route),
      mode,
      success,
      summary: arts.summary,
      auditPassed,
      goalPassed,
      goalFidelityScore,
      exitCode,
    });
  } catch {
    /* non-fatal */
  }

  broadcast("run", {
    type: "end",
    exitCode,
    at: endedAt,
    ready: true,
    phase: "done",
    entry,
    report,
  });
  broadcast("session", session);
  broadcast("ready", {
    message: success
      ? "نجحت المهمة — تم إفراغ Task. اكتب مهمة جديدة."
      : "فشلت المهمة — Task محفوظ لإعادة المحاولة.",
    at: endedAt,
    taskLifecycle,
  });
}

async function handleRun(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  const body = JSON.parse(raw || "{}") as { mode?: RunMode; confirmImplement?: boolean };
  const mode = (body.mode || "agency") as RunMode;

  if (activeChild) {
    sendJson(res, 409, { ok: false, error: "A run is already in progress" });
    return;
  }

  if (mode === "implement" && body.confirmImplement !== true) {
    sendJson(res, 400, {
      ok: false,
      error: "Implement mode requires confirmImplement: true (GO)",
    });
    return;
  }

  const meta = readCurrentTaskMeta(ROOT);
  if (!meta.exists && mode !== "smoke") {
    sendJson(res, 400, { ok: false, error: "No task.ts/task.md yet — compose & save first" });
    return;
  }

  if (!currentDraft) {
    const cfg = await readTaskConfig();
    if (cfg.title) {
      currentDraft = {
        id: cfg.id || "from-disk",
        route: (cfg.route as UiRoute) || "architecture",
        title: cfg.title,
        targetRepo: cfg.targetRepo || "",
        packDir: "",
        body: cfg.body || "",
        allowClientCodeEdits: false,
        spec: {
          id: cfg.id || "from-disk",
          locale: "mixed",
          route: (cfg.route as UiRoute) || "architecture",
          intent: "unknown",
          confidence: 1,
          title: cfg.title,
          goal: cfg.body || "",
          rawPrompt: cfg.body || "",
          entities: { sources: [], destinations: [], names: [], constraints: [] },
          planSteps: [],
          workspaceMode: "code",
          roots: [],
          risk: "low",
          successCriteria: [],
          forbidden: [],
          assumptions: [],
          needsClarification: [],
          targetRepo: cfg.targetRepo || "",
          packDir: "",
          allowClientCodeEdits: false,
        },
        needsClarification: [],
        confidence: 1,
        ready: true,
      };
    }
  }

  // Idle cleared task should not run
  if (
    mode !== "smoke" &&
    (/لا توجد مهمة نشطة|CLEARED_AFTER_SUCCESS|pending-idle/i.test(
      currentDraft?.body || meta.raw || ""
    ) ||
      currentDraft?.id === "pending-idle")
  ) {
    sendJson(res, 400, {
      ok: false,
      error: "لا توجد مهمة نشطة — اكتب مهمة جديدة من الواجهة أولاً",
    });
    return;
  }

  if (mode !== "smoke") {
    const gate = assertNotRepeatSuccess(ROOT, currentDraft?.body || meta.raw || "");
    if (!gate.ok) {
      sendJson(res, 409, { ok: false, error: gate.error, blockedRepeat: true });
      return;
    }
  }

  // Cost-cap gate: cloud-only profile cannot start when daily budget is exhausted
  const profile = loadHybridProfile(ROOT);
  const budget = getCostBudget(ROOT);
  if (profile.mode === "cloud" && budget.blocked) {
    sendJson(res, 402, {
      ok: false,
      error:
        budget.blockReason ||
        `Cost cap exceeded ($${budget.spentUsd} / $${budget.capUsd}). Cloud runs are blocked.`,
      code: "COST_CAP_EXCEEDED",
      cost: budget,
    });
    return;
  }

  const runId = beginCostRun();
  const { cmd, args, env } = runArgsForMode(mode);
  runLogBuffer = "";
  smokePending = mode === "smoke" ? 2 : 0;
  lastRun = {
    mode,
    startedAt: new Date().toISOString(),
    running: true,
    phase: "running",
  };
  broadcast("run", { type: "start", ...lastRun, cmd, args, phase: "running", runId, cost: budget });

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...(env || process.env), SAM_HARNESS_RUN_ID: runId },
    shell: true,
  });
  activeChild = child;

  child.stdout.on("data", (buf) => appendLog(buf.toString("utf-8")));
  child.stderr.on("data", (buf) => appendLog(buf.toString("utf-8")));
  child.on("close", (code) => {
    activeChild = null;
    if (mode === "smoke" && code === 0 && smokePending > 0) {
      void runSmokeChain(code);
      return;
    }
    void finalizeRun(mode, code);
  });

  sendJson(res, 200, { ok: true, mode, startedAt: lastRun.startedAt });
}

async function runSmokeChain(firstCode: number | null) {
  for (const script of ["smoke:delivery", "smoke:capabilities"]) {
    await new Promise<void>((resolve) => {
      const child = spawn(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["run", script],
        { cwd: ROOT, shell: true, env: process.env }
      );
      activeChild = child;
      broadcast("run", { type: "start", mode: "smoke", script, phase: "running" });
      child.stdout.on("data", (buf) => appendLog(buf.toString("utf-8")));
      child.stderr.on("data", (buf) => appendLog(buf.toString("utf-8")));
      child.on("close", (code) => {
        activeChild = null;
        smokePending -= 1;
        appendLog(`\n[smoke] ${script} exit=${code}\n`);
        if (code !== 0) firstCode = code;
        resolve();
      });
    });
  }
  await finalizeRun("smoke", firstCode);
}

function handleStop(_req: http.IncomingMessage, res: http.ServerResponse) {
  if (!activeChild) {
    sendJson(res, 200, { ok: true, stopped: false });
    return;
  }
  // Kill only — child's "close" handler finalizes session + unlocks UI
  broadcast("run", { type: "stopped", phase: "running" });
  activeChild.kill();
  sendJson(res, 200, { ok: true, stopped: true });
}

function handleReady(_req: http.IncomingMessage, res: http.ServerResponse) {
  if (activeChild) {
    sendJson(res, 409, { ok: false, error: "Cannot reset while a run is active" });
    return;
  }
  if (lastRun) lastRun.phase = "idle";
  currentDraft = null;
  runLogBuffer = "";
  broadcast("ready", {
    message: "واجهة جاهزة لمهمة جديدة",
    at: new Date().toISOString(),
    clearedDraft: true,
  });
  sendJson(res, 200, { ok: true, phase: "idle", session });
}

function handleSessionReset(_req: http.IncomingMessage, res: http.ServerResponse) {
  if (activeChild) {
    sendJson(res, 409, { ok: false, error: "Cannot clear session while running" });
    return;
  }
  session = resetSession(ROOT);
  broadcast("session", session);
  broadcast("ready", { message: "تم تفريغ سجل الجلسة", at: new Date().toISOString() });
  sendJson(res, 200, { ok: true, session });
}

function handleSse(_req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(
    `event: hello\ndata: ${JSON.stringify({
      ok: true,
      phase: lastRun?.phase || "idle",
      running: Boolean(activeChild),
    })}\n\n`
  );
  res.write(`event: session\ndata: ${JSON.stringify(session)}\n\n`);
  const id = ++sseId;
  sseClients.set(id, { id, res });
  _req.on("close", () => sseClients.delete(id));
}

const PUBLIC_API = new Set(["/api/login", "/api/auth/status", "/api/logout"]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const p = url.pathname;
    const method = req.method || "GET";

    // —— Auth: login / status / logout (unauthenticated) ——
    if (method === "POST" && p === "/api/login") {
      if (!isAllowedHost(req.headers.host as string | undefined, PORT)) {
        sendJson(res, 403, { ok: false, error: "Forbidden: invalid Host" });
        return;
      }
      const origin = req.headers.origin as string | undefined;
      if (origin && !isAllowedOrigin(origin, undefined, PORT)) {
        sendJson(res, 403, { ok: false, error: "Forbidden: foreign Origin" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}") as { token?: string };
      const token = String(body.token || "").trim();
      if (!token || !timingSafeEqualString(token, OWNER_TOKEN)) {
        sendJson(res, 401, { ok: false, error: "Invalid owner token" });
        return;
      }
      const sess = createSession();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookieHeader(sess.id),
      });
      res.end(
        JSON.stringify({
          ok: true,
          csrfToken: sess.csrfToken,
          expiresAt: new Date(sess.expiresAt).toISOString(),
        })
      );
      return;
    }
    if (method === "GET" && p === "/api/auth/status") {
      const auth = authenticateRequest(req, OWNER_TOKEN, {
        port: PORT,
        requireCsrf: false,
        allowMissingOriginWithBearer: true,
      });
      sendJson(res, 200, {
        ok: true,
        authenticated: auth.ok,
        via: auth.ok ? auth.via : null,
        csrfToken: auth.ok && auth.via === "session" ? auth.session?.csrfToken : null,
      });
      return;
    }
    if (method === "POST" && p === "/api/logout") {
      const cookies = parseCookies(req.headers.cookie);
      destroySession(cookies[SESSION_COOKIE]);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": clearSessionCookieHeader(),
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // —— Require auth for every other /api/* route ——
    if (p.startsWith("/api/") && !PUBLIC_API.has(p)) {
      const auth = authenticateRequest(req, OWNER_TOKEN, {
        port: PORT,
        requireCsrf: true,
        allowMissingOriginWithBearer: true,
      });
      if (!auth.ok) {
        sendJson(res, auth.status, { ok: false, error: auth.error, authRequired: true });
        return;
      }
    }

    if (method === "GET" && p === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        root: ROOT,
        running: Boolean(activeChild),
        phase: lastRun?.phase || (activeChild ? "running" : "idle"),
        lastRun,
        tasksInSession: session.entries.length,
        port: PORT,
        auth: true,
      });
      return;
    }
    if (method === "GET" && p === "/api/session") {
      sendJson(res, 200, { ok: true, session });
      return;
    }
    if (method === "POST" && p === "/api/session/reset") {
      handleSessionReset(req, res);
      return;
    }
    if (method === "POST" && p === "/api/ready") {
      handleReady(req, res);
      return;
    }
    if (method === "GET" && p === "/api/task") {
      const meta = readCurrentTaskMeta(ROOT);
      const cfg = await readTaskConfig();
      sendJson(res, 200, { ...meta, ...cfg });
      return;
    }
    if (method === "GET" && p === "/api/operator-context") {
      const spec = readTaskSpec(ROOT);
      sendJson(res, 200, {
        ok: true,
        allowlistRoots: listAllowlistRoots(),
        workspaceMode: spec?.workspaceMode || (spec?.route === "operational" ? "operator" : "code"),
        taskRoots: spec?.roots || [],
        planSteps: spec?.planSteps || [],
      });
      return;
    }
    if (method === "GET" && p === "/api/active-task") {
      const draft = readComposeDraft(ROOT);
      const spec = readTaskSpec(ROOT);
      const cfg = await readTaskConfig();
      const idle =
        /لا توجد مهمة نشطة|CLEARED_AFTER_SUCCESS|pending-idle/i.test(cfg.body || "") ||
        cfg.id === "pending-idle";
      sendJson(res, 200, {
        ok: true,
        draft,
        spec: draft?.spec || spec,
        savedTask: idle
          ? null
          : {
              id: cfg.id,
              title: cfg.title,
              route: cfg.route,
              targetRepo: cfg.targetRepo,
              body: cfg.body,
              goal: cfg.body?.match(/## Goal\s*\n([\s\S]*?)(?=\n## )/i)?.[1]?.trim(),
            },
        idle,
      });
      return;
    }
    if (method === "POST" && p === "/api/compose") {
      await handleCompose(req, res);
      return;
    }
    if (method === "POST" && p === "/api/run") {
      await handleRun(req, res);
      return;
    }
    if (method === "POST" && p === "/api/stop") {
      handleStop(req, res);
      return;
    }
    if (method === "GET" && p === "/api/events") {
      handleSse(req, res);
      return;
    }

    // —— P6 Daily Ops ——
    if (method === "GET" && p === "/api/daily-ops") {
      sendJson(res, 200, { ok: true, ...loadDailyOps(ROOT) });
      return;
    }
    if (method === "POST" && p === "/api/daily-ops") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        title?: string;
        schedule?: string;
        prompt?: string;
      };
      if (!body.title?.trim()) {
        sendJson(res, 400, { ok: false, error: "title required" });
        return;
      }
      const job = addDailyJob(ROOT, {
        title: body.title,
        schedule: body.schedule || "09:00",
        prompt: body.prompt,
      });
      sendJson(res, 200, { ok: true, job, store: loadDailyOps(ROOT) });
      return;
    }
    if (method === "POST" && p === "/api/daily-ops/toggle") {
      const body = JSON.parse((await readBody(req)) || "{}") as { id?: string };
      const job = body.id ? toggleDailyJob(ROOT, body.id) : null;
      if (!job) {
        sendJson(res, 404, { ok: false, error: "job not found" });
        return;
      }
      sendJson(res, 200, { ok: true, job, store: loadDailyOps(ROOT) });
      return;
    }
    if (method === "POST" && p === "/api/daily-ops/remove") {
      const body = JSON.parse((await readBody(req)) || "{}") as { id?: string };
      const ok = body.id ? removeDailyJob(ROOT, body.id) : false;
      sendJson(res, ok ? 200 : 404, { ok, store: loadDailyOps(ROOT) });
      return;
    }

    // —— P8 Hybrid profile + cost ledger ——
    if (method === "GET" && p === "/api/hybrid-profile") {
      sendJson(res, 200, {
        ok: true,
        profile: loadHybridProfile(ROOT),
        cost: getCostBudget(ROOT),
      });
      return;
    }
    if (method === "GET" && p === "/api/cost-usage") {
      sendJson(res, 200, { ok: true, cost: getCostBudget(ROOT) });
      return;
    }
    if (method === "POST" && p === "/api/hybrid-profile") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        mode?: "local" | "cloud" | "auto";
        costCapUsd?: number;
        notes?: string;
      };
      const profile = saveHybridProfile(ROOT, body);
      sendJson(res, 200, {
        ok: true,
        profile,
        cost: getCostBudget(ROOT),
      });
      return;
    }

    // —— P9 Memory ——
    if (method === "GET" && p === "/api/memory") {
      sendJson(res, 200, { ok: true, ...loadMemory(ROOT) });
      return;
    }
    if (method === "POST" && p === "/api/memory") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        key?: string;
        value?: string;
      };
      try {
        const entry = upsertMemory(ROOT, body.key || "", body.value || "");
        sendJson(res, 200, { ok: true, entry, ...loadMemory(ROOT) });
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: e?.message || String(e) });
      }
      return;
    }
    if (method === "POST" && p === "/api/memory/remove") {
      const body = JSON.parse((await readBody(req)) || "{}") as { key?: string };
      const ok = body.key ? removeMemory(ROOT, body.key) : false;
      sendJson(res, ok ? 200 : 404, { ok, ...loadMemory(ROOT) });
      return;
    }

    // —— P7 Comms stubs ——
    if (method === "GET" && p === "/api/comms") {
      sendJson(res, 200, { ok: true, ...loadComms(ROOT) });
      return;
    }
    if (method === "POST" && p === "/api/comms/draft") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        subject?: string;
        body?: string;
        to?: string;
      };
      if (!body.subject || !body.body) {
        sendJson(res, 400, { ok: false, error: "subject and body required" });
        return;
      }
      const draft = createCommDraft(ROOT, {
        subject: body.subject,
        body: body.body,
        to: body.to,
      });
      sendJson(res, 200, { ok: true, draft });
      return;
    }
    if (method === "POST" && p === "/api/comms/send") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string;
        approved?: boolean;
      };
      const draft = body.id ? requestCommSend(ROOT, body.id, Boolean(body.approved)) : null;
      if (!draft) {
        sendJson(res, 404, { ok: false, error: "draft not found" });
        return;
      }
      sendJson(res, 200, { ok: true, draft });
      return;
    }

    // —— Artifacts (completion report open/view) ——
    if (method === "GET" && p === "/api/artifacts") {
      const { items, packDir } = listRunArtifacts(ROOT);
      sendJson(res, 200, {
        ok: true,
        packDir,
        items: items.map(({ absPath: _a, ...rest }) => rest),
      });
      return;
    }
    if (method === "GET" && p.startsWith("/api/artifacts/content")) {
      const u = new URL(req.url || "/", `http://127.0.0.1`);
      const rel = u.searchParams.get("path") || "";
      try {
        const data = readArtifactText(ROOT, rel);
        sendJson(res, 200, { ok: true, ...data });
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: e?.message || String(e) });
      }
      return;
    }
    if (method === "POST" && p === "/api/artifacts/open") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        path?: string;
        mode?: "file" | "folder" | "dir";
      };
      try {
        const r = openArtifactInOs(ROOT, body.path || "", body.mode || "file");
        sendJson(res, 200, r);
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: e?.message || String(e) });
      }
      return;
    }

    // —— P10 Rollback journal ——
    if (method === "GET" && p === "/api/rollback") {
      sendJson(res, 200, { ok: true, ...loadRollbackJournal(ROOT) });
      return;
    }
    if (method === "POST" && p === "/api/rollback/restore") {
      const body = JSON.parse((await readBody(req)) || "{}") as { id?: string };
      try {
        const { restoreRollback } = await import("../agency/delivery/rollbackJournal.js");
        const entry = restoreRollback(ROOT, body.id || "");
        sendJson(res, 200, { ok: true, entry, ...loadRollbackJournal(ROOT) });
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: e?.message || String(e) });
      }
      return;
    }

    if (method === "GET") {
      serveStatic(p, res);
      return;
    }
    res.writeHead(405).end("Method not allowed");
  } catch (e: any) {
    sendJson(res, 500, { ok: false, error: e?.message || String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  try {
    seedHarnessLessons(ROOT);
  } catch {
    /* ignore */
  }
  const tokenHint =
    process.env.CONTROL_PLANE_TOKEN?.trim()
      ? "CONTROL_PLANE_TOKEN (env)"
      : `.controlplane-token (${OWNER_TOKEN.slice(0, 8)}…)`;
  console.log(`[Control Plane] Sam-Harness UI → ${url}`);
  console.log(`[Control Plane] Project root → ${ROOT}`);
  console.log(`[Control Plane] Auth required — owner token: ${tokenHint}`);
  console.log(`[Control Plane] Workspace roots: ${listAllowlistRoots(ROOT).join(" | ")}`);
  console.log(`[Control Plane] Session ${session.id} · ${session.entries.length} prior entries`);
  if (process.platform === "win32" && process.env.CONTROL_PLANE_NO_BROWSER !== "1") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  }
});

