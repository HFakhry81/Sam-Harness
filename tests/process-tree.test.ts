import { spawn, type ChildProcess } from "child_process";
import { describe, expect, it } from "vitest";
import { terminateChildProcessTree } from "../src/controlplane/processTree.js";

function waitForLine(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      const line = output.split(/\r?\n/)[0]?.trim();
      if (line) resolve(line);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (!output.trim()) reject(new Error(`Child exited before reporting its descendant (code ${code})`));
    });
  });
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw error;
  }
}

describe("terminateChildProcessTree", () => {
  it("terminates a spawned process and its descendants", async () => {
    const script = [
      'const { spawn } = require("node:child_process");',
      'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "console.log(descendant.pid);",
      "setInterval(() => {}, 1000);",
    ].join("");
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: process.platform !== "win32",
    });
    try {
      const descendantPid = Number(await waitForLine(child));
      expect(descendantPid).toBeGreaterThan(0);
      await terminateChildProcessTree(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(await waitForProcessExit(descendantPid)).toBe(true);
      if (process.platform !== "win32") expect(() => process.kill(-child.pid!, 0)).toThrow();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        await terminateChildProcessTree(child);
      }
    }
  }, 15_000);
});
