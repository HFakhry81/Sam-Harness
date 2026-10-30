import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import {
  getMetrics,
  recordRunStart,
  recordRunEnd,
  recordLlmCall,
  recordError,
  __resetMetricsForTests,
} from "../src/lib/observability/metrics.js";
import { withRetry, defaultShouldRetry } from "../src/lib/retry.js";
import { otelEnabled } from "../src/lib/observability/tracing.js";
import { detectEmailProvider } from "../src/controlplane/emailProvider.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("metrics + retry", () => {
  beforeEach(() => {
    __resetMetricsForTests();
  });

  it("tracks cost latency and errors", () => {
    recordRunStart();
    recordLlmCall({ durationMs: 40, costUsd: 0.01 });
    recordError();
    recordRunEnd({ ok: false, durationMs: 100 });
    const m = getMetrics();
    expect(m.runsTotal).toBe(1);
    expect(m.runsFailed).toBe(1);
    expect(m.llmCalls).toBe(1);
    expect(m.errors).toBe(1);
    expect(m.costUsdTotal).toBeGreaterThan(0);
    expect(m.latencyMs.count).toBeGreaterThan(0);
  });

  it("retries with backoff then succeeds", async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        n += 1;
        if (n < 3) {
          const err = new Error("timeout");
          (err as { code?: string }).code = "ETIMEDOUT";
          throw err;
        }
        return "ok";
      },
      { attempts: 5, minDelayMs: 1, maxDelayMs: 5 }
    );
    expect(out).toBe("ok");
    expect(n).toBe(3);
  });

  it("does not retry cost cap errors", () => {
    const err = new Error("cap");
    (err as { code?: string }).code = "COST_CAP_EXCEEDED";
    expect(defaultShouldRetry(err)).toBe(false);
  });

  it("otel is off unless endpoint/flag set", () => {
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(otelEnabled()).toBe(false);
  });
});

describe("email provider default (owner: SMTP)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["EMAIL_PROVIDER", "SMTP_HOST", "RESEND_API_KEY"]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("defaults EMAIL_PROVIDER to smtp and dry-runs when SMTP_* unset", () => {
    const status = detectEmailProvider();
    expect(status.provider).toBe("smtp");
    expect(status.dryRun).toBe(true);
    expect(status.configured).toBe(false);
  });

  it("honors explicit dry-run and resend overrides", () => {
    process.env.EMAIL_PROVIDER = "dry-run";
    expect(detectEmailProvider().provider).toBe("dry-run");
    process.env.EMAIL_PROVIDER = "resend";
    expect(detectEmailProvider().provider).toBe("resend");
    expect(detectEmailProvider().dryRun).toBe(true);
  });
});

describe("healthz endpoint", () => {
  it("serves /healthz without auth", async () => {
    const port = 8791 + Math.floor(Math.random() * 200);
    const token = "test-healthz-token";
    const outHome = fs.mkdtempSync(path.join(os.tmpdir(), "sam-healthz-"));
    let child: ChildProcess | null = null;
    try {
      child = spawn(
        process.execPath,
        ["--import", "tsx", path.join(root, "src/controlplane/server.ts")],
        {
          cwd: root,
          env: {
            ...process.env,
            CONTROL_PLANE_PORT: String(port),
            CONTROL_PLANE_TOKEN: token,
            CONTROL_PLANE_NO_BROWSER: "1",
            SAM_DATABASE_PATH: ":memory:",
            SAM_OUTPUT_HOME: outHome,
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      await waitForHealth(port, 20_000);
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean; status?: string };
      expect(body.ok).toBe(true);
      expect(body.status).toBe("ok");
    } finally {
      child?.kill();
      try {
        fs.rmSync(outHome, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }, 35_000);
});

function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - start > timeoutMs) reject(new Error("timeout"));
        else setTimeout(tick, 200);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("timeout"));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}
