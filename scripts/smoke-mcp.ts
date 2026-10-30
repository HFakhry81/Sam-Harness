/**
 * Smoke: MCP client against fixtures/mock-mcp-server.mjs
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  callMcpTool,
  disconnectAllMcp,
  listAllMcpTools,
} from "../src/tools/mcp.js";
import { executeToolAsRole } from "../src/agency/safeExecute.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "scripts/fixtures/mock-mcp-server.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-smoke-mcp-"));

fs.writeFileSync(
  path.join(tmp, "mcp.json"),
  JSON.stringify({
    mcpServers: {
      mock: { command: process.execPath, args: [fixture] },
    },
  }),
  "utf-8"
);

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`OK  ${name}${detail ? " — " + detail : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

try {
  const tools = await listAllMcpTools(tmp);
  check(
    "list tools",
    tools.some((t) => t.name === "echo"),
    tools.map((t) => t.qualifiedName).join(", ")
  );
  const result = await callMcpTool("mock", "add", { a: 10, b: 32 }, tmp);
  check("call add", JSON.stringify(result).includes("42"), JSON.stringify(result));

  const denied = await executeToolAsRole("auditor", "mcp_call", {
    server: "mock",
    tool: "echo",
    arguments: { x: 1 },
  });
  check("permission deny auditor", denied.ok === false);
} catch (e: any) {
  check("smoke-mcp", false, e?.message || String(e));
} finally {
  await disconnectAllMcp();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.error(`smoke:mcp FAILED (${failed})`);
  process.exitCode = 1;
} else {
  console.log("smoke:mcp PASS");
}
