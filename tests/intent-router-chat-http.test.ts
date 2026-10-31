/**
 * Control Plane /api/chat — hermetic (never calls real Ollama).
 * Windows: generous timeouts (PS 5.1 / cold spawn).
 */
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeIsolatedCpEnv } from "./helpers/isolatedCpEnv.js";
import {
  waitForListenPort,
  waitForLocalHealth,
} from "./helpers/ephemeralPort.js";

const TOKEN = "intent-router-chat-token-0123456789abcdef";
const ROOT = process.cwd();
const IS_WIN = process.platform === "win32";
/** Cold spawn + login can be slow on Windows runners / owner laptops. */
const SUITE_TIMEOUT_MS = IS_WIN ? 120_000 : 60_000;
const TEST_TIMEOUT_MS = IS_WIN ? 60_000 : 30_000;

let child: ChildProcess | null = null;
let cpIso: ReturnType<typeof makeIsolatedCpEnv> | null = null;
let PORT = 0;
let csrf = "";
let sessionCookie = "";

async function login(): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `http://127.0.0.1:${PORT}`,
    },
    body: JSON.stringify({ token: TOKEN }),
  });
  const body = await res.json();
  expect(res.status).toBe(200);
  csrf = body.csrfToken;
  expect(csrf).toBeTruthy();
  const setCookie = res.headers.get("set-cookie") || "";
  const m = /sh_session=([^;]+)/.exec(setCookie);
  sessionCookie = m ? `sh_session=${m[1]}` : "";
  expect(sessionCookie).toBeTruthy();
}

function chatHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
    "X-CSRF-Token": csrf,
    Origin: `http://127.0.0.1:${PORT}`,
    Cookie: sessionCookie,
  };
}

beforeAll(async () => {
  cpIso = makeIsolatedCpEnv({
    CONTROL_PLANE_PORT: "0",
    CONTROL_PLANE_TOKEN: TOKEN,
    // Force hermetic intent path — never hit a real local model even if Ollama is up.
    SAM_INTENT_HERMETIC: "1",
    SAM_QUICK_NO_MODEL: "1",
    SAM_TEST_ISOLATION: "1",
  });
  const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  child = spawn(process.execPath, [tsxBin, path.join(ROOT, "src/controlplane/server.ts")], {
    cwd: ROOT,
    env: cpIso.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  PORT = await waitForListenPort(child!, IS_WIN ? 60_000 : 30_000);
  await waitForLocalHealth(PORT, "/api/auth/status", IS_WIN ? 45_000 : 20_000);
  await login();
}, SUITE_TIMEOUT_MS);

afterAll(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, IS_WIN ? 800 : 300));
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  cpIso?.cleanup();
}, SUITE_TIMEOUT_MS);

describe("POST /api/chat chat route (hermetic)", () => {
  it(
    "greeting → chat, no report folder, no FAILED, fast (no Ollama)",
    async () => {
      const reportsBefore = path.join(cpIso!.outputHome, "reports");
      const before = fs.existsSync(reportsBefore)
        ? fs.readdirSync(reportsBefore).filter((d) => /^Sam-Harness no\./i.test(d))
        : [];

      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
        method: "POST",
        headers: chatHeaders(),
        body: JSON.stringify({ message: "مرحبا اسمي مز هيثم" }),
      });
      const wallMs = Date.now() - t0;
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.pipeline).toBe(false);
      expect(body.route).toBe("chat");
      expect(body.noArtifacts).toBe(true);
      expect(String(body.reply || "")).toMatch(/./);
      expect(String(body.reply || "")).not.toMatch(/FAILED|task saved for retry/i);
      // Deterministic path must not wait on a local model (16s+ on Windows).
      expect(wallMs).toBeLessThan(IS_WIN ? 15_000 : 8_000);
      if (body.entry) {
        expect(body.entry.success).toBe(true);
        expect(body.entry.report?.tone).not.toBe("fail");
        if (typeof body.entry.durationMs === "number") {
          expect(body.entry.durationMs).toBeLessThan(5_000);
        }
      }
      // Hermetic: no real model id from Ollama
      expect(String(body.entry?.model || body.model || "")).not.toMatch(/qwen|ollama/i);

      const after = fs.existsSync(reportsBefore)
        ? fs.readdirSync(reportsBefore).filter((d) => /^Sam-Harness no\./i.test(d))
        : [];
      expect(after).toEqual(before);

      const convDir = path.join(cpIso!.outputHome, "conversations");
      expect(fs.existsSync(convDir)).toBe(true);
      const files = fs.readdirSync(convDir).filter((f) => f.endsWith(".json"));
      expect(files.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "path audit → pipeline complex (does not auto-chat)",
    async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
        method: "POST",
        headers: chatHeaders(),
        body: JSON.stringify({
          message: "حلل الكود في المسار E:\\UpNexa.com\\spendy",
        }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.pipeline).toBe(true);
      expect(body.route).toBe("complex");
    },
    TEST_TIMEOUT_MS
  );
});
