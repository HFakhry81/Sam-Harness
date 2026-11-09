import { spawn, type ChildProcess } from "child_process";
import * as http from "http";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeIsolatedCpEnv } from "./helpers/isolatedCpEnv.js";
import {
  waitForListenPort,
  waitForLocalHealth,
} from "./helpers/ephemeralPort.js";

const TOKEN = "team-model-test-owner-token-0123456789abcdef";
const ROOT = process.cwd();

let child: ChildProcess | null = null;
let cpIso: ReturnType<typeof makeIsolatedCpEnv> | null = null;
let ollama: http.Server | null = null;
let PORT = 0;
let OLLAMA_PORT = 0;

beforeAll(async () => {
  ollama = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags" && req.method === "GET") {
      res.end(
        JSON.stringify({
          models: [
            { name: "qwen2.5:latest", size: 1024, details: { family: "qwen" } },
            { name: "qwen2.5-coder:1.5b", size: 1024 },
          ],
        })
      );
      return;
    }
    if (req.url === "/api/show" && req.method === "POST") {
      if (body.model === "qwen2.5:latest" || body.model === "qwen2.5") {
        res.end(JSON.stringify({ details: { family: "qwen" } }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "model not found" }));
      }
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve, reject) => {
    ollama!.once("error", reject);
    ollama!.listen(0, "127.0.0.1", resolve);
  });
  OLLAMA_PORT = (ollama.address() as { port: number }).port;

  cpIso = makeIsolatedCpEnv({
    CONTROL_PLANE_PORT: "0",
    CONTROL_PLANE_TOKEN: TOKEN,
    SAM_LOCAL_BASE_URL: `http://127.0.0.1:${OLLAMA_PORT}`,
    SAM_LOCAL_PROVIDER: "ollama",
  });
  const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  child = spawn(
    process.execPath,
    [tsxBin, path.join(ROOT, "src/controlplane/server.ts")],
    {
      cwd: ROOT,
      env: cpIso.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  PORT = await waitForListenPort(child, 20000);
  await waitForLocalHealth(PORT, "/api/auth/status", 15000);
}, 30000);

afterAll(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  cpIso?.cleanup();
  if (ollama) {
    await new Promise<void>((resolve, reject) =>
      ollama!.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

async function teamRequest(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers || {}),
    },
  });
}

describe("team model management API", () => {
  it("reports installed models and marks assigned missing models", async () => {
    const response = await teamRequest("/api/team/models");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models.map((model: { name: string }) => model.name)).toContain(
      "qwen2.5:latest"
    );
    expect(
      body.roles.find((role: { id: string }) => role.id === "auditor")
    ).toMatchObject({ model: "qwen-claude:27b-fast-64k", installed: false });
  });

  it("checks an installed model using metadata without inference", async () => {
    const response = await teamRequest("/api/team/models/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen2.5" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, model: { name: "qwen2.5:latest" } });
  });

  it("refuses to assign a model that failed Ollama import", async () => {
    const response = await teamRequest("/api/team/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "auditor",
        models: { local: "qwen-claude:27b-fast" },
      }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("LOCAL_MODEL_UNAVAILABLE");
    expect(body.error).toMatch(/auditor.*qwen-claude:27b-fast/);
  });

  it("returns not-found for a missing model test", async () => {
    const response = await teamRequest("/api/team/models/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen-claude:27b-fast" }),
    });
    expect(response.status).toBe(404);
    expect((await response.json()).installed).toBe(false);
  });
});
