/**
 * Minimal stdio MCP server for smoke/unit tests (JSON-RPC + Content-Length).
 */
const tools = [
  { name: "echo", description: "Echo arguments back", inputSchema: { type: "object" } },
  { name: "add", description: "Add a + b", inputSchema: { type: "object" } },
];

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buf.slice(0, headerEnd).toString("utf8");
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) {
      buf = buf.slice(headerEnd + 4);
      continue;
    }
    const len = Number(m[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const body = buf.slice(start, start + len).toString("utf8");
    buf = buf.slice(start + len);
    try {
      handle(JSON.parse(body));
    } catch {
      /* ignore */
    }
  }
});

function reply(id, result) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
  const frame = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  process.stdout.write(frame);
}

function handle(msg) {
  if (!msg || msg.method === "notifications/initialized") return;
  if (msg.method === "initialize") {
    reply(msg.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "mock-mcp", version: "0.0.1" },
    });
    return;
  }
  if (msg.method === "tools/list") {
    reply(msg.id, { tools });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    if (name === "echo") {
      reply(msg.id, {
        content: [{ type: "text", text: JSON.stringify(args) }],
      });
    } else if (name === "add") {
      reply(msg.id, {
        content: [
          {
            type: "text",
            text: String(Number(args.a || 0) + Number(args.b || 0)),
          },
        ],
      });
    } else {
      reply(msg.id, {
        isError: true,
        content: [{ type: "text", text: "unknown tool" }],
      });
    }
  }
}
