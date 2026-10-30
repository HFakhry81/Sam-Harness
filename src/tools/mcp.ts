/**
 * MCP client — load servers from mcp.json, expose tools via permission matrix.
 * Supports stdio and HTTP (JSON-RPC initialize + tools/list + tools/call).
 * Secret env keys are stripped from stdio child processes.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { isSecretEnvKey } from "./sandbox.js";
import type { ToolResult } from "./registry.js";

export type McpStdioServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpHttpServerConfig = {
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
  /** Alias used by some editors */
  servers?: Record<string, McpServerConfig>;
};

export type McpToolDescriptor = {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  /** Fully-qualified tool id used in the harness: mcp:<server>:<name> */
  qualifiedName: string;
};

type JsonRpcId = number;
type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

function isHttpConfig(c: McpServerConfig): c is McpHttpServerConfig {
  return typeof (c as McpHttpServerConfig).url === "string";
}

function isStdioConfig(c: McpServerConfig): c is McpStdioServerConfig {
  return typeof (c as McpStdioServerConfig).command === "string";
}

export function resolveMcpConfigPath(cwd: string = process.cwd()): string | null {
  const candidates = [
    process.env.MCP_CONFIG?.trim(),
    path.join(cwd, "mcp.json"),
    path.join(cwd, ".mcp.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) return path.normalize(p);
  }
  return null;
}

export function loadMcpConfig(cwd: string = process.cwd()): McpConfigFile {
  const p = resolveMcpConfigPath(cwd);
  if (!p) return { mcpServers: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as McpConfigFile;
    return {
      mcpServers: raw.mcpServers || raw.servers || {},
    };
  } catch (e: any) {
    throw new Error(`Invalid MCP config at ${p}: ${e?.message || e}`);
  }
}

function filterChildEnv(
  extra?: Record<string, string>
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (isSecretEnvKey(k)) continue;
    out[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (isSecretEnvKey(k)) continue;
      out[k] = v;
    }
  }
  out.SAM_MCP_CLIENT = "1";
  return out;
}

class StdioMcpSession {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<JsonRpcId, Pending>();
  private nextId = 1;
  private buffer = "";
  private closed = false;
  private contentLengthMode = false;

  constructor(
    public readonly name: string,
    cfg: McpStdioServerConfig
  ) {
    this.child = spawn(cfg.command, cfg.args || [], {
      cwd: cfg.cwd || process.cwd(),
      env: filterChildEnv(cfg.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf-8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr?.on("data", () => {
      /* keep stderr quiet in production; tests can inspect if needed */
    });
    this.child.on("exit", () => {
      this.closed = true;
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP server "${name}" exited`));
      }
      this.pending.clear();
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    // Prefer Content-Length framing when present; otherwise newline-delimited JSON.
    while (true) {
      if (this.buffer.startsWith("Content-Length:") || this.contentLengthMode) {
        this.contentLengthMode = true;
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.buffer.slice(0, headerEnd);
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (!m) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        const len = Number(m[1]);
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + len) return;
        const body = this.buffer.slice(bodyStart, bodyStart + len);
        this.buffer = this.buffer.slice(bodyStart + len);
        this.handleMessage(body);
        continue;
      }
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) return;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      this.handleMessage(line);
    }
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id == null) return; // notification
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(
        new Error(msg.error.message || JSON.stringify(msg.error))
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`MCP server "${this.name}" closed`));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    // Content-Length framing (MCP stdio)
    const frame = `Content-Length: ${Buffer.byteLength(payload, "utf-8")}\r\n\r\n${payload}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child.stdin.write(frame);
      } catch (e: any) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async initialize(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sam-harness", version: "1.0.0" },
    });
    // notifications/initialized (no response expected)
    const note = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    this.child.stdin.write(
      `Content-Length: ${Buffer.byteLength(note, "utf-8")}\r\n\r\n${note}`
    );
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = (await this.send("tools/list", {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.send("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    try {
      this.child.kill();
    } catch {
      /* ignore */
    }
  }
}

class HttpMcpSession {
  constructor(
    public readonly name: string,
    private cfg: McpHttpServerConfig
  ) {}

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    });
    const res = await fetch(this.cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.cfg.headers || {}),
      },
      body,
    });
    const text = await res.text();
    // Streamable HTTP may return SSE; extract first JSON payload if needed.
    let jsonText = text.trim();
    if (jsonText.startsWith("event:") || jsonText.includes("data:")) {
      const dataLine = jsonText
        .split(/\r?\n/)
        .find((l) => l.startsWith("data:"));
      jsonText = dataLine ? dataLine.slice(5).trim() : jsonText;
    }
    let msg: any;
    try {
      msg = JSON.parse(jsonText);
    } catch {
      throw new Error(
        `MCP HTTP ${this.name} non-JSON response (${res.status}): ${text.slice(0, 200)}`
      );
    }
    if (msg.error) {
      throw new Error(msg.error.message || JSON.stringify(msg.error));
    }
    return msg.result;
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sam-harness", version: "1.0.0" },
    });
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = (await this.rpc("tools/list", {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {
    /* HTTP is stateless per request for our minimal client */
  }
}

type Session = StdioMcpSession | HttpMcpSession;

const sessions = new Map<string, Session>();

export async function connectMcpServer(
  name: string,
  cfg: McpServerConfig
): Promise<Session> {
  const existing = sessions.get(name);
  if (existing) return existing;
  let session: Session;
  if (isHttpConfig(cfg)) {
    session = new HttpMcpSession(name, cfg);
  } else if (isStdioConfig(cfg)) {
    session = new StdioMcpSession(name, cfg);
  } else {
    throw new Error(`MCP server "${name}" needs command (stdio) or url (HTTP)`);
  }
  await session.initialize();
  sessions.set(name, session);
  return session;
}

export async function disconnectAllMcp(): Promise<void> {
  for (const [, s] of sessions) {
    await s.close();
  }
  sessions.clear();
}

export async function listAllMcpTools(
  cwd: string = process.cwd()
): Promise<McpToolDescriptor[]> {
  const cfg = loadMcpConfig(cwd);
  const servers = cfg.mcpServers || {};
  const out: McpToolDescriptor[] = [];
  for (const [name, serverCfg] of Object.entries(servers)) {
    try {
      const session = await connectMcpServer(name, serverCfg);
      const tools = await session.listTools();
      for (const t of tools) {
        out.push({
          server: name,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          qualifiedName: `mcp:${name}:${t.name}`,
        });
      }
    } catch (e: any) {
      out.push({
        server: name,
        name: "__error__",
        description: e?.message || String(e),
        qualifiedName: `mcp:${name}:__error__`,
      });
    }
  }
  return out;
}

export function parseMcpToolName(
  tool: string
): { server: string; name: string } | null {
  // mcp:server:tool  OR  mcp_call with params
  const m = /^mcp:([^:]+):(.+)$/i.exec(tool);
  if (!m) return null;
  return { server: m[1], name: m[2] };
}

export async function callMcpTool(
  server: string,
  toolName: string,
  args: Record<string, unknown>,
  cwd: string = process.cwd()
): Promise<unknown> {
  const cfg = loadMcpConfig(cwd);
  const serverCfg = (cfg.mcpServers || {})[server];
  if (!serverCfg) throw new Error(`Unknown MCP server: ${server}`);
  const session = await connectMcpServer(server, serverCfg);
  return session.callTool(toolName, args);
}

/** Registry tool: mcp_call { server, tool, arguments } */
export async function mcpCallTool(
  params: Record<string, unknown>,
  cwd: string = process.cwd()
): Promise<ToolResult> {
  const server = String(params.server || "").trim();
  const tool = String(params.tool || params.name || "").trim();
  if (!server || !tool) {
    return {
      ok: false,
      tool: "mcp_call",
      message: "mcp_call requires server and tool",
    };
  }
  const args =
    params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : params.args && typeof params.args === "object"
        ? (params.args as Record<string, unknown>)
        : {};
  try {
    const result = await callMcpTool(server, tool, args, cwd);
    return {
      ok: true,
      tool: "mcp_call",
      message: `MCP ${server}/${tool} ok`,
      data: { server, tool, result },
    };
  } catch (e: any) {
    return {
      ok: false,
      tool: "mcp_call",
      message: e?.message || String(e),
      data: { server, tool },
    };
  }
}

/** In-process mock stdio MCP server helper for tests (writes JSON-RPC replies). */
export function createMockMcpStdioResponder(): {
  script: string;
  tools: Array<{ name: string; description: string }>;
} {
  const tools = [
    { name: "echo", description: "Echo arguments back" },
    { name: "add", description: "Add a + b" },
  ];
  // Minimal Node MCP server script as a string (written to temp by tests)
  const script = `
import * as readline from "readline";
const tools = ${JSON.stringify(tools)};
let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const headerEnd = buf.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) break;
    const header = buf.slice(0, headerEnd).toString("utf8");
    const m = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!m) { buf = buf.slice(headerEnd + 4); continue; }
    const len = Number(m[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const body = buf.slice(start, start + len).toString("utf8");
    buf = buf.slice(start + len);
    handle(JSON.parse(body));
  }
});
function reply(id, result) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
  const frame = \`Content-Length: \${Buffer.byteLength(payload)}\\r\\n\\r\\n\${payload}\`;
  process.stdout.write(frame);
}
function handle(msg) {
  if (!msg || msg.method === "notifications/initialized") return;
  if (msg.method === "initialize") {
    reply(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "0.0.1" } });
    return;
  }
  if (msg.method === "tools/list") {
    reply(msg.id, { tools: tools.map(t => ({ ...t, inputSchema: { type: "object" } })) });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    if (name === "echo") reply(msg.id, { content: [{ type: "text", text: JSON.stringify(args) }] });
    else if (name === "add") reply(msg.id, { content: [{ type: "text", text: String(Number(args.a||0)+Number(args.b||0)) }] });
    else reply(msg.id, { isError: true, content: [{ type: "text", text: "unknown tool" }] });
  }
}
`;
  return { script, tools };
}

// silence unused import warning for readline in some bundlers
void readline;
