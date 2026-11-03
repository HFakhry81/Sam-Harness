/**
 * Isolated Node code execution for agents (REPL-style).
 *
 * Default isolation is a hardened subprocess: fresh temp workdir under the
 * output home, scrubbed environment, hard timeout and heap cap. Docker is
 * available as a stronger boundary via `SAM_SANDBOX_MODE`:
 *
 *   SAM_SANDBOX_MODE=subprocess  (default) hardened child process
 *   SAM_SANDBOX_MODE=auto        Docker when the daemon answers, else subprocess
 *   SAM_SANDBOX_MODE=docker      require Docker; refuse to run if unavailable
 *
 * `SAM_SANDBOX_DOCKER=1` is kept as a backward-compatible alias for `auto`.
 */
import { spawn, execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { ensureOutputHome, getOutputLayout } from "../lib/outputHome.js";
import type { ToolResult } from "./registry.js";

const SECRET_ENV_RE =
  /^(?:.*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|CREDENTIAL).*|AWS_.*|GEMINI_.*|GOOGLE_API_KEY|OPENAI_.*|ANTHROPIC_.*|RESEND_.*|SMTP_.*|CONTROL_PLANE_TOKEN|OLLAMA_API_KEY)$/i;

export type SandboxOptions = {
  code: string;
  timeoutMs?: number;
  memoryMb?: number;
  /** Extra argv after node (e.g. ["--input-type=module"]) */
  nodeArgs?: string[];
  /** Per-call opt-in to Docker (still honored only when the daemon answers). */
  preferDocker?: boolean;
  /** Keep workdir after run (default: delete) */
  keepWorkdir?: boolean;
};

export type SandboxResult = {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  workdir: string;
  mode: "subprocess" | "docker";
  durationMs: number;
};

function sanitizeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    PATH: base.PATH,
    HOME: base.HOME || base.USERPROFILE,
    USERPROFILE: base.USERPROFILE,
    TMPDIR: base.TMPDIR || base.TEMP || os.tmpdir(),
    TEMP: base.TEMP || base.TMPDIR || os.tmpdir(),
    TMP: base.TMP || base.TEMP || os.tmpdir(),
    LANG: base.LANG || "C.UTF-8",
    NODE_ENV: "sandbox",
    SAM_SANDBOX: "1",
  };
  // Drop anything that looks like a secret; keep a tiny allowlist of safe vars.
  for (const [k, v] of Object.entries(base)) {
    if (v == null) continue;
    if (SECRET_ENV_RE.test(k)) continue;
    if (
      /^(PATH|HOME|USERPROFILE|TMPDIR|TEMP|TMP|LANG|LC_|SystemRoot|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_|USERNAME|USER|SHELL|TERM)$/i.test(
        k
      )
    ) {
      out[k] = v;
    }
  }
  return out;
}

export function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_RE.test(key);
}

export type SandboxMode = "auto" | "docker" | "subprocess";

/** Configured isolation mode (never throws; unknown values fall back safely). */
export function sandboxMode(): SandboxMode {
  const raw = String(process.env.SAM_SANDBOX_MODE || "").trim().toLowerCase();
  if (raw === "auto" || raw === "docker" || raw === "subprocess") return raw;
  // Back-compat alias: the old opt-in flag meant "Docker when available".
  if (String(process.env.SAM_SANDBOX_DOCKER || "").trim() === "1") return "auto";
  return "subprocess";
}

let dockerCache: { at: number; available: boolean } | null = null;
const DOCKER_CACHE_MS = 60_000;

/** Cached Docker daemon probe (spawning `docker version` costs ~1s on Windows). */
export function dockerAvailable(opts: { force?: boolean } = {}): boolean {
  const now = Date.now();
  if (!opts.force && dockerCache && now - dockerCache.at < DOCKER_CACHE_MS) {
    return dockerCache.available;
  }
  let available = false;
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true,
    });
    available = true;
  } catch {
    available = false;
  }
  dockerCache = { at: now, available };
  return available;
}

export type SandboxStatus = {
  /** Value from SAM_SANDBOX_MODE (or its legacy alias). */
  mode: SandboxMode;
  dockerAvailable: boolean;
  /** What a run without an explicit per-call override would use. */
  effectiveMode: "docker" | "subprocess";
  /** True when mode=docker but the daemon is unreachable (runs will refuse). */
  misconfigured: boolean;
};

/** Observable isolation status for the Control Plane / health checks. */
export function sandboxStatus(opts: { probe?: boolean } = {}): SandboxStatus {
  const mode = sandboxMode();
  // Probing spawns `docker version`; only do it on demand (never in health pings).
  const docker = opts.probe ? dockerAvailable() : Boolean(dockerCache?.available);
  return {
    mode,
    dockerAvailable: docker,
    effectiveMode: mode === "docker" ? "docker" : mode === "auto" && docker ? "docker" : "subprocess",
    misconfigured: mode === "docker" && !docker,
  };
}

/** Test hook: forget the cached Docker probe. */
export function __resetSandboxCacheForTests(): void {
  dockerCache = null;
}

/** Decide whether this run should use Docker. */
function shouldUseDocker(opts: SandboxOptions): {
  use: boolean;
  /** Set when the run must be refused instead of silently degrading. */
  refuse?: string;
} {
  const mode = sandboxMode();
  const docker = dockerAvailable();

  if (mode === "docker") {
    if (!docker) {
      return {
        use: false,
        refuse:
          "SAM_SANDBOX_MODE=docker but the Docker daemon is not reachable. " +
          "Start Docker (or use SAM_SANDBOX_MODE=auto|subprocess).",
      };
    }
    return { use: true };
  }

  if (mode === "auto") return { use: docker };

  // subprocess mode: only an explicit per-call opt-in may use Docker.
  return { use: opts.preferDocker === true && docker };
}

function makeWorkdir(): string {
  const layout = ensureOutputHome();
  const id = `sandbox-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const workdir = path.join(layout.temp, "runs", id);
  fs.mkdirSync(workdir, { recursive: true });
  return workdir;
}

function writeScript(workdir: string, code: string): string {
  const scriptPath = path.join(workdir, "main.mjs");
  fs.writeFileSync(scriptPath, code, "utf-8");
  return scriptPath;
}

function clip(s: string, max = 8000): string {
  return s.length <= max ? s : s.slice(0, max) + "\n...(truncated)";
}

async function runSubprocess(
  scriptPath: string,
  workdir: string,
  opts: { timeoutMs: number; memoryMb: number; nodeArgs: string[] }
): Promise<Omit<SandboxResult, "workdir" | "mode" | "durationMs">> {
  const nodeArgs = [
    ...(opts.memoryMb > 0 ? [`--max-old-space-size=${opts.memoryMb}`] : []),
    ...opts.nodeArgs,
    scriptPath,
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: workdir,
      env: sanitizeEnv(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs);

    child.stdout?.on("data", (b) => {
      stdout += String(b);
      if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000);
    });
    child.stderr?.on("data", (b) => {
      stderr += String(b);
      if (stderr.length > 200_000) stderr = stderr.slice(0, 200_000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        timedOut,
        stdout: clip(stdout),
        stderr: clip(stderr + "\n" + (e?.message || String(e))),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: code,
        timedOut,
        stdout: clip(stdout),
        stderr: clip(stderr),
      });
    });
  });
}

async function runDocker(
  scriptPath: string,
  workdir: string,
  opts: { timeoutMs: number; memoryMb: number }
): Promise<Omit<SandboxResult, "workdir" | "mode" | "durationMs">> {
  const mem = Math.max(64, opts.memoryMb || 256);
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    `--memory=${mem}m`,
    `--cpus=1`,
    "-v",
    `${workdir}:/work:rw`,
    "-w",
    "/work",
    "node:22-alpine",
    "node",
    `--max-old-space-size=${mem}`,
    path.basename(scriptPath),
  ];
  return new Promise((resolve) => {
    const child = spawn("docker", args, {
      cwd: workdir,
      env: sanitizeEnv(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs);
    child.stdout?.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr?.on("data", (b) => {
      stderr += String(b);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: code,
        timedOut,
        stdout: clip(stdout),
        stderr: clip(stderr),
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        timedOut,
        stdout: clip(stdout),
        stderr: clip((e?.message || String(e)) + "\n" + stderr),
      });
    });
  });
}

/**
 * Run untrusted agent code in an isolated Node subprocess (or Docker).
 */
export async function runNodeSandbox(opts: SandboxOptions): Promise<SandboxResult> {
  const code = String(opts.code || "");
  if (!code.trim()) {
    return {
      ok: false,
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: "Missing code",
      workdir: "",
      mode: "subprocess",
      durationMs: 0,
    };
  }
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 15_000, 500), 120_000);
  const memoryMb = Math.min(Math.max(opts.memoryMb ?? 128, 32), 1024);
  const docker = shouldUseDocker(opts);

  if (docker.refuse) {
    return {
      ok: false,
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: docker.refuse,
      workdir: "",
      mode: "docker",
      durationMs: 0,
    };
  }

  const workdir = makeWorkdir();
  const scriptPath = writeScript(workdir, code);
  const started = Date.now();
  let mode: "subprocess" | "docker" = "subprocess";
  let result: Omit<SandboxResult, "workdir" | "mode" | "durationMs">;

  if (docker.use) {
    mode = "docker";
    result = await runDocker(scriptPath, workdir, { timeoutMs, memoryMb });
    if (!result.ok && /Cannot connect|not found|daemon/i.test(result.stderr)) {
      mode = "subprocess";
      result = await runSubprocess(scriptPath, workdir, {
        timeoutMs,
        memoryMb,
        nodeArgs: opts.nodeArgs || [],
      });
    }
  } else {
    result = await runSubprocess(scriptPath, workdir, {
      timeoutMs,
      memoryMb,
      nodeArgs: opts.nodeArgs || [],
    });
  }

  if (!opts.keepWorkdir) {
    try {
      fs.rmSync(workdir, { recursive: true, force: true });
    } catch {
      /* leave for inspection */
    }
  }

  return {
    ...result,
    workdir: opts.keepWorkdir ? workdir : getOutputLayout().temp,
    mode,
    durationMs: Date.now() - started,
  };
}

/** Tool adapter for the registry. */
export async function runNodeSandboxTool(
  params: Record<string, unknown>
): Promise<ToolResult> {
  const code = String(params.code ?? params.source ?? "");
  const r = await runNodeSandbox({
    code,
    timeoutMs: params.timeoutMs != null ? Number(params.timeoutMs) : undefined,
    memoryMb: params.memoryMb != null ? Number(params.memoryMb) : undefined,
    preferDocker: params.docker === true || params.docker === "true",
    keepWorkdir: params.keepWorkdir === true || params.keepWorkdir === "true",
  });
  return {
    ok: r.ok,
    tool: "run_node_sandbox",
    message: r.timedOut
      ? `Sandbox timed out after ${r.durationMs}ms (${r.mode})`
      : r.ok
        ? `Sandbox OK (${r.mode}, ${r.durationMs}ms)`
        : `Sandbox failed exit=${r.exitCode} (${r.mode})`,
    data: r,
  };
}
