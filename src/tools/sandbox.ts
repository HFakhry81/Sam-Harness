/**
 * Isolated Node code execution for agents (REPL-style).
 * Subprocess with timeout, resource limits, working dir under output home temp/runs.
 * Optional Docker when SAM_SANDBOX_DOCKER=1 and docker is available.
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
  /** Prefer Docker when available and SAM_SANDBOX_DOCKER=1 */
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

export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
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
  const preferDocker =
    opts.preferDocker === true ||
    String(process.env.SAM_SANDBOX_DOCKER || "").trim() === "1";

  const workdir = makeWorkdir();
  const scriptPath = writeScript(workdir, code);
  const started = Date.now();
  let mode: "subprocess" | "docker" = "subprocess";
  let result: Omit<SandboxResult, "workdir" | "mode" | "durationMs">;

  if (preferDocker && dockerAvailable()) {
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
