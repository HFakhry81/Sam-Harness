/**
 * HTTP-level auth checks against a real Control Plane server process.
 */
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeIsolatedCpEnv } from "./helpers/isolatedCpEnv.js";

const PORT = 18787;
const TOKEN = "phase1-test-owner-token-0123456789abcdef";
const ROOT = process.cwd();

let child: ChildProcess | null = null;
let cpIso: ReturnType<typeof makeIsolatedCpEnv> | null = null;

async function waitForHealth(ms = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/status`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Control Plane did not become ready");
}

beforeAll(async () => {
  cpIso = makeIsolatedCpEnv({
    CONTROL_PLANE_PORT: String(PORT),
    CONTROL_PLANE_TOKEN: TOKEN,
  });
  const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  child = spawn(process.execPath, [tsxBin, path.join(ROOT, "src/controlplane/server.ts")], {
    cwd: ROOT,
    env: cpIso.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
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
});

describe("Control Plane HTTP auth", () => {
  it("POST /api/run without token → 401", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${PORT}`,
      },
      body: JSON.stringify({ mode: "smoke" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.authRequired).toBe(true);
  });

  it("POST /api/run with foreign Origin → 403", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ mode: "smoke" }),
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/health with bearer succeeds", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.auth).toBe(true);
  });

  it("login sets session and CSRF", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.csrfToken).toBeTruthy();
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toMatch(/sh_session=/);
  });

  it("GET /api/locale is public and Arabic-first", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/locale`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.locale).toBe("ar");
    expect(body.dir).toBe("rtl");
    expect(body.messages?.["nav.compose"]).toBeTruthy();
  });

  it("POST /api/locale switches to English without auth", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/locale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.locale).toBe("en");
    expect(body.dir).toBe("ltr");
    expect(body.messages?.["nav.compose"]).toBe("Task");
    // restore Arabic for other tests / process default
    await fetch(`http://127.0.0.1:${PORT}/api/locale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "ar" }),
    });
  });
});
