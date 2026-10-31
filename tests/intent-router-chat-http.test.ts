/**
 * Control Plane /api/chat — greetings stay chat and create no report pack folder.
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
  });
  const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  child = spawn(process.execPath, [tsxBin, path.join(ROOT, "src/controlplane/server.ts")], {
    cwd: ROOT,
    env: cpIso.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  PORT = await waitForListenPort(child!, 20000);
  await waitForLocalHealth(PORT, "/api/auth/status", 15000);
  await login();
}, 45000);

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
});

describe("POST /api/chat chat route", () => {
  it("greeting → chat, no report folder, no FAILED", async () => {
    const reportsBefore = path.join(cpIso!.outputHome, "reports");
    const before = fs.existsSync(reportsBefore)
      ? fs.readdirSync(reportsBefore).filter((d) => /^Sam-Harness no\./i.test(d))
      : [];

    const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: "POST",
      headers: chatHeaders(),
      body: JSON.stringify({ message: "مرحبا اسمي مز هيثم" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pipeline).toBe(false);
    expect(body.route).toBe("chat");
    expect(body.noArtifacts).toBe(true);
    expect(String(body.reply || "")).toMatch(/./);
    expect(String(body.reply || "")).not.toMatch(/FAILED|task saved for retry/i);
    if (body.entry) {
      expect(body.entry.success).toBe(true);
      expect(body.entry.report?.tone).not.toBe("fail");
    }

    const after = fs.existsSync(reportsBefore)
      ? fs.readdirSync(reportsBefore).filter((d) => /^Sam-Harness no\./i.test(d))
      : [];
    expect(after).toEqual(before);

    // Conversation persisted under output home
    const convDir = path.join(cpIso!.outputHome, "conversations");
    expect(fs.existsSync(convDir)).toBe(true);
    const files = fs.readdirSync(convDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("path audit → pipeline complex (does not auto-chat)", async () => {
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
  });
});
