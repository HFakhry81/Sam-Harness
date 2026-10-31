/**
 * Ephemeral 127.0.0.1 port helpers for Control Plane integration tests.
 * Prefer CONTROL_PLANE_PORT=0 + parse LISTEN_PORT= from child stdout.
 */
import type { ChildProcess } from "child_process";
import * as net from "net";

/** Reserve an ephemeral port on 127.0.0.1 (small race if used then rebound). */
export function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

/**
 * Wait for `[Control Plane] LISTEN_PORT=<n>` on a spawned server's stdout/stderr.
 * Use with CONTROL_PLANE_PORT=0 so the OS assigns a free port.
 */
export function waitForListenPort(
  child: ChildProcess,
  timeoutMs = 20000
): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    const start = Date.now();

    const finish = (err: Error | null, port?: number) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      if (err) reject(err);
      else resolve(port as number);
    };

    const tryParse = () => {
      const m = buf.match(/LISTEN_PORT=(\d+)/);
      if (m) {
        const port = Number(m[1]);
        if (port > 0) finish(null, port);
      }
    };

    const onData = (chunk: Buffer | string) => {
      buf += String(chunk);
      tryParse();
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const timer = setInterval(() => {
      tryParse();
      if (Date.now() - start > timeoutMs) {
        finish(
          new Error(
            `timeout waiting for LISTEN_PORT; tail=${buf.slice(-400).replace(/\s+/g, " ")}`
          )
        );
      }
    }, 100);
  });
}

/** Poll until /api/auth/status (or given path) responds on 127.0.0.1:port. */
export async function waitForLocalHealth(
  port: number,
  path = "/api/auth/status",
  timeoutMs = 15000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Control Plane did not become ready on 127.0.0.1:${port}`);
}
