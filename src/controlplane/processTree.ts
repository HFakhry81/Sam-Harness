import { execFile } from "child_process";
import type { ChildProcess } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const CLOSE_TIMEOUT_MS = 1_500;

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", onClose);
  });
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processGroupExists(pid);
}

export async function terminateChildProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const childExited = child.exitCode !== null || child.signalCode !== null;
  if (!child.pid) {
    if (childExited) return;
    throw new Error("Cannot stop run: child process has no PID");
  }

  if (platform === "win32") {
    try {
      await execFileAsync(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, timeout: 10_000 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not terminate the run process tree: ${message}`);
    }
    if (!(await waitForClose(child, CLOSE_TIMEOUT_MS))) {
      throw new Error("Run process tree termination was requested but the process is still active");
    }
    return;
  }

  if (childExited && !processGroupExists(child.pid)) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      await waitForClose(child, CLOSE_TIMEOUT_MS);
      return;
    }
    throw error;
  }
  const gracefulClose = await Promise.all([
    waitForClose(child, CLOSE_TIMEOUT_MS),
    waitForProcessGroupExit(child.pid, CLOSE_TIMEOUT_MS),
  ]);
  if (gracefulClose.every(Boolean)) return;

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  const forcedClose = await Promise.all([
    waitForClose(child, CLOSE_TIMEOUT_MS),
    waitForProcessGroupExit(child.pid, CLOSE_TIMEOUT_MS),
  ]);
  if (!forcedClose.every(Boolean)) {
    throw new Error("Run process tree did not exit after SIGKILL");
  }
}
