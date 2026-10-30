import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  callMcpTool,
  disconnectAllMcp,
  listAllMcpTools,
  loadMcpConfig,
  mcpCallTool,
  parseMcpToolName,
} from "../src/tools/mcp.js";
import { assertToolAllowed } from "../src/agency/capabilities.js";
import { executeToolAsRole } from "../src/agency/safeExecute.js";
import { isSecretEnvKey } from "../src/tools/sandbox.js";

describe("MCP client", () => {
  let dir: string;
  const prevCwd = process.cwd();
  const fixture = path.join(prevCwd, "scripts/fixtures/mock-mcp-server.mjs");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-mcp-"));
    fs.writeFileSync(
      path.join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          mock: {
            command: process.execPath,
            args: [fixture],
          },
        },
      }),
      "utf-8"
    );
  });

  afterEach(async () => {
    await disconnectAllMcp();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("loads mcp.json and lists tools from stdio server", async () => {
    const cfg = loadMcpConfig(dir);
    expect(Object.keys(cfg.mcpServers || {})).toContain("mock");
    const tools = await listAllMcpTools(dir);
    const names = tools.map((t) => t.qualifiedName);
    expect(names).toContain("mcp:mock:echo");
    expect(names).toContain("mcp:mock:add");
  });

  it("calls echo and add via mcp_call", async () => {
    const echo = await callMcpTool("mock", "echo", { hello: "world" }, dir);
    expect(JSON.stringify(echo)).toMatch(/hello/);
    const add = await mcpCallTool(
      { server: "mock", tool: "add", arguments: { a: 2, b: 3 } },
      dir
    );
    expect(add.ok).toBe(true);
    expect(JSON.stringify(add.data)).toMatch(/5/);
  });

  it("routes mcp tools through permission matrix", async () => {
    expect(() => assertToolAllowed("operator", "mcp_call")).not.toThrow();
    expect(() => assertToolAllowed("operator", "mcp:mock:echo")).not.toThrow();
    expect(() => assertToolAllowed("auditor", "mcp_call")).toThrow(/cannot use tool/);
    const denied = await executeToolAsRole("auditor", "mcp_call", {
      server: "mock",
      tool: "echo",
      arguments: {},
    });
    expect(denied.ok).toBe(false);
    expect((denied.data as { denied?: boolean })?.denied).toBe(true);
  });

  it("parseMcpToolName and secret env filter", () => {
    expect(parseMcpToolName("mcp:fs:read_file")).toEqual({
      server: "fs",
      name: "read_file",
    });
    expect(isSecretEnvKey("GEMINI_API_KEY")).toBe(true);
    expect(isSecretEnvKey("RESEND_API_KEY")).toBe(true);
    expect(isSecretEnvKey("PATH")).toBe(false);
  });
});
