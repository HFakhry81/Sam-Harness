import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  isSecretEnvKey,
  runNodeSandbox,
  runNodeSandboxTool,
} from "../src/tools/sandbox.js";
import { assertToolAllowed } from "../src/agency/capabilities.js";
import { executeTool } from "../src/tools/registry.js";

describe("run_node_sandbox", () => {
  let home: string;
  const prevHome = process.env.SAM_OUTPUT_HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "sam-sbx-home-"));
    process.env.SAM_OUTPUT_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prevHome;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("runs code successfully in subprocess", async () => {
    const r = await runNodeSandbox({
      code: "console.log('sum=' + (2+3));",
      keepWorkdir: false,
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("subprocess");
    expect(r.stdout).toMatch(/sum=5/);
  });

  it("times out runaway code", async () => {
    const r = await runNodeSandbox({
      code: "while(true){}",
      timeoutMs: 800,
      memoryMb: 64,
    });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  });

  it("does not leak secret env into child", async () => {
    process.env.GEMINI_API_KEY = "super-secret-key-xyz";
    process.env.RESEND_API_KEY = "re_test_secret";
    const r = await runNodeSandbox({
      code: `
        const keys = Object.keys(process.env).filter(k =>
          /API_KEY|SECRET|TOKEN|PASSWORD/i.test(k)
        );
        console.log('SECRET_KEYS=' + keys.join(','));
        console.log('GEMINI=' + (process.env.GEMINI_API_KEY || ''));
      `,
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).not.toMatch(/super-secret-key-xyz/);
    expect(r.stdout).not.toMatch(/re_test_secret/);
    expect(r.stdout).toMatch(/GEMINI=\s*$/m);
    delete process.env.GEMINI_API_KEY;
    delete process.env.RESEND_API_KEY;
  });

  it("tool adapter + permission allow for operator", async () => {
    expect(() => assertToolAllowed("operator", "run_node_sandbox")).not.toThrow();
    expect(() => assertToolAllowed("evidence", "run_node_sandbox")).toThrow();
    const tool = await runNodeSandboxTool({ code: "console.log('ok')" });
    expect(tool.ok).toBe(true);
    const viaRegistry = await executeTool("run_node_sandbox", {
      code: "console.log(40+2)",
    });
    expect(viaRegistry.ok).toBe(true);
    expect(String((viaRegistry.data as any)?.stdout || "")).toMatch(/42/);
  });

  it("isSecretEnvKey covers common patterns", () => {
    expect(isSecretEnvKey("OPENAI_API_KEY")).toBe(true);
    expect(isSecretEnvKey("CONTROL_PLANE_TOKEN")).toBe(true);
    expect(isSecretEnvKey("HOME")).toBe(false);
  });
});
