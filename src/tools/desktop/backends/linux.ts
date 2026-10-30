/**
 * Linux desktop backend — xdotool / wmctrl / ydotool + screenshots + optional AT-SPI.
 * Detects tools at runtime; throws clear install hints when unavailable.
 */
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { assertAllowedPath, resolveUserPath } from "../../../lib/paths.js";
import type {
  ClipboardContent,
  DesktopBackend,
  FileDialogRequest,
  ScreenshotResult,
  UiaElement,
  WindowInfo,
} from "../types.js";
import {
  buildLinuxClickCommand,
  buildLinuxKeyCommand,
  buildLinuxListWindowsCommand,
  buildLinuxScreenshotCommand,
  buildLinuxTypeCommand,
  detectLinuxCapabilities,
  hasUnixTool,
  missingToolError,
  type LinuxDesktopCapabilities,
} from "./unixDetect.js";

const execFileAsync = promisify(execFile);

/** Injectable exec for unit tests (command building still real). */
export type LinuxExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number; maxBuffer?: number; input?: string }
) => Promise<{ stdout: string; stderr: string }>;

let injectedExec: LinuxExecFn | null = null;

export function __setLinuxExecForTests(fn: LinuxExecFn | null): void {
  injectedExec = fn;
}

async function run(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number; input?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  if (injectedExec) return injectedExec(cmd, args, opts);
  if (opts.input != null) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Timeout running ${cmd}`));
      }, opts.timeout ?? 20_000);
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code && code !== 0) reject(new Error(stderr || `exit ${code}`));
        else resolve({ stdout, stderr });
      });
      child.stdin.write(opts.input);
      child.stdin.end();
    });
  }
  const r = await execFileAsync(cmd, args, {
    timeout: opts.timeout ?? 20_000,
    maxBuffer: opts.maxBuffer ?? 1024 * 512,
  });
  return { stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}

function ensureParent(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function parseWmctrl(stdout: string): WindowInfo[] {
  const out: WindowInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    // 0x04400007  0 1234  10  20  800 600 hostname Title here
    const m = line.match(
      /^(0x[0-9a-fA-F]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(.*)$/
    );
    if (!m) continue;
    out.push({
      handle: m[1],
      pid: Number(m[3]) || undefined,
      bounds: {
        x: Number(m[4]),
        y: Number(m[5]),
        width: Number(m[6]),
        height: Number(m[7]),
      },
      title: m[8] || "",
    });
  }
  return out;
}

async function atspiTree(maxDepth = 3): Promise<UiaElement> {
  const script = `
import json, sys
try:
    import pyatspi
except ImportError:
    print(json.dumps({"error": "pyatspi not installed"}))
    sys.exit(2)
def walk(acc, depth, max_depth):
    try:
        name = acc.name or ""
        role = acc.getRoleName() if hasattr(acc, "getRoleName") else ""
    except Exception:
        name, role = "", ""
    node = {"name": name, "controlType": role, "children": []}
    if depth >= max_depth:
        return node
    try:
        n = acc.childCount
    except Exception:
        n = 0
    for i in range(min(n, 40)):
        try:
            child = acc.getChildAtIndex(i)
            if child:
                node["children"].append(walk(child, depth + 1, max_depth))
        except Exception:
            pass
    return node
desktop = pyatspi.Registry.getDesktop(0)
print(json.dumps(walk(desktop, 0, ${Math.max(1, Math.min(6, maxDepth))})))
`.trim();
  const { stdout } = await run("python3", ["-c", script], { timeout: 15_000 });
  const parsed = JSON.parse(stdout || "{}");
  if (parsed.error) {
    throw missingToolError(
      "linux",
      "AT-SPI",
      "install python3-pyatspi (Debian/Ubuntu: sudo apt install python3-pyatspi)"
    );
  }
  return parsed as UiaElement;
}

export function createLinuxBackend(
  capsOverride?: Partial<LinuxDesktopCapabilities>
): DesktopBackend {
  const caps: LinuxDesktopCapabilities = {
    ...detectLinuxCapabilities(),
    ...capsOverride,
  };

  return {
    platform: "linux",
    name: "linux-x11-wayland",

    async listWindows(): Promise<WindowInfo[]> {
      const built = buildLinuxListWindowsCommand(caps.windows);
      if (!built) {
        throw missingToolError(
          "linux",
          "listWindows",
          "install wmctrl and/or xdotool (sudo apt install wmctrl xdotool)"
        );
      }
      if (caps.windows === "wmctrl") {
        const { stdout } = await run(built.cmd, built.args);
        return parseWmctrl(stdout);
      }
      // xdotool search returns window ids; fetch names best-effort
      const { stdout } = await run("xdotool", ["search", "--name", "."]);
      const ids = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 80);
      const out: WindowInfo[] = [];
      for (const id of ids) {
        try {
          const name = (await run("xdotool", ["getwindowname", id])).stdout.trim();
          const pidRaw = (await run("xdotool", ["getwindowpid", id])).stdout.trim();
          out.push({
            handle: id,
            title: name,
            pid: Number(pidRaw) || undefined,
          });
        } catch {
          out.push({ handle: id, title: "" });
        }
      }
      return out;
    },

    async focusWindow(opts) {
      const windows = await this.listWindows();
      const hit =
        windows.find((w) => opts.handle && w.handle === opts.handle) ||
        windows.find(
          (w) =>
            opts.titleIncludes &&
            (w.title || "").toLowerCase().includes(String(opts.titleIncludes).toLowerCase())
        ) ||
        windows.find(
          (w) =>
            opts.processName &&
            (w.processName || "").toLowerCase().includes(String(opts.processName).toLowerCase())
        );
      if (!hit) throw new Error("Window not found");
      if (caps.windows === "wmctrl" && hit.handle.startsWith("0x")) {
        await run("wmctrl", ["-i", "-a", hit.handle]);
      } else if (hasUnixTool("xdotool")) {
        await run("xdotool", ["windowactivate", "--sync", hit.handle]);
      } else {
        throw missingToolError(
          "linux",
          "focusWindow",
          "install wmctrl or xdotool"
        );
      }
      return hit;
    },

    async launchApp(opts) {
      if (!opts.app) throw new Error("app required");
      const child = spawn(opts.app, opts.args || [], {
        cwd: opts.cwd,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      const wait = opts.waitForWindowMs ?? 1500;
      if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 8000)));
      let window: WindowInfo | undefined;
      try {
        const wins = await this.listWindows();
        window = wins.find((w) =>
          (w.title || "").toLowerCase().includes(path.basename(opts.app).toLowerCase())
        );
      } catch {
        /* optional */
      }
      return { pid: child.pid, window };
    },

    async closeWindow(opts) {
      const win = await this.focusWindow(opts);
      if (caps.windows === "wmctrl" && win.handle.startsWith("0x")) {
        await run("wmctrl", ["-i", "-c", win.handle]);
        return;
      }
      if (hasUnixTool("xdotool")) {
        await run("xdotool", ["windowclose", win.handle]);
        return;
      }
      throw missingToolError("linux", "closeWindow", "install wmctrl or xdotool");
    },

    async getUiaTree(opts) {
      if (!caps.atspi) {
        throw missingToolError(
          "linux",
          "AT-SPI tree",
          "install python3-pyatspi (sudo apt install python3-pyatspi)"
        );
      }
      return atspiTree(opts?.maxDepth ?? 3);
    },

    async findUia(opts) {
      const tree = await this.getUiaTree({ maxDepth: opts.maxDepth ?? 5 });
      const wantName = String(opts.name || "").toLowerCase();
      const wantType = String(opts.controlType || "").toLowerCase();
      const wantId = String(opts.automationId || "");
      const stack: UiaElement[] = [tree];
      while (stack.length) {
        const n = stack.pop()!;
        const okName = !wantName || String(n.name || "").toLowerCase().includes(wantName);
        const okType =
          !wantType || String(n.controlType || "").toLowerCase().includes(wantType);
        const okId = !wantId || n.automationId === wantId || n.id === wantId;
        if (okName && okType && okId && (wantName || wantType || wantId)) return n;
        for (const c of n.children || []) stack.push(c);
      }
      return null;
    },

    async invokeUia(opts) {
      const el = await this.findUia(opts);
      if (!el) throw new Error("UIA element not found");
      // Best-effort: click center if bounds known, else type/activate via xdotool search
      if (el.boundingRectangle && caps.input !== "none") {
        const b = el.boundingRectangle;
        await this.click({
          x: Math.floor(b.x + b.width / 2),
          y: Math.floor(b.y + b.height / 2),
        });
      } else if (el.name && caps.input === "xdotool") {
        await run("xdotool", ["search", "--name", el.name, "windowactivate", "click", "1"]);
      } else {
        throw new Error(
          "AT-SPI invoke: element found but no click backend/bounds — install xdotool"
        );
      }
      return el;
    },

    async setUiaValue(opts) {
      const el = await this.findUia(opts);
      if (!el) throw new Error("UIA element not found");
      await this.invokeUia(opts);
      await this.typeText({ text: opts.value });
      return { ...el, value: opts.value };
    },

    async typeText(opts) {
      const built = buildLinuxTypeCommand(caps.input, opts.text);
      if (!built) {
        throw missingToolError(
          "linux",
          "typeText",
          caps.session === "wayland"
            ? "install ydotool (Wayland) or use X11 with xdotool"
            : "install xdotool (sudo apt install xdotool)"
        );
      }
      await run(built.cmd, built.args);
    },

    async sendKeys(opts) {
      const built = buildLinuxKeyCommand(caps.input, opts.keys);
      if (!built) {
        throw missingToolError(
          "linux",
          "sendKeys",
          "install xdotool or ydotool"
        );
      }
      await run(built.cmd, built.args);
    },

    async click(opts) {
      if (opts.name || opts.automationId) {
        await this.invokeUia(opts);
        return;
      }
      const built = buildLinuxClickCommand(caps.input, opts);
      if (!built) {
        throw missingToolError("linux", "click", "install xdotool or ydotool");
      }
      await run(built.cmd, built.args);
    },

    async moveMouse(opts) {
      if (caps.input === "xdotool") {
        await run("xdotool", ["mousemove", String(opts.x), String(opts.y)]);
        return;
      }
      if (caps.input === "ydotool") {
        await run("ydotool", ["mousemove", "--absolute", String(opts.x), String(opts.y)]);
        return;
      }
      throw missingToolError("linux", "moveMouse", "install xdotool or ydotool");
    },

    async getClipboard(): Promise<ClipboardContent> {
      if (caps.clipboard === "xclip") {
        const { stdout } = await run("xclip", ["-selection", "clipboard", "-o"]);
        return { text: stdout, format: "text" };
      }
      if (caps.clipboard === "wl-clipboard") {
        const { stdout } = await run("wl-paste", ["-n"]);
        return { text: stdout, format: "text" };
      }
      throw missingToolError(
        "linux",
        "clipboard",
        "install xclip or wl-clipboard"
      );
    },

    async setClipboard(opts) {
      if (caps.clipboard === "xclip") {
        await run("xclip", ["-selection", "clipboard"], { input: opts.text });
        return;
      }
      if (caps.clipboard === "wl-clipboard") {
        await run("wl-copy", [], { input: opts.text });
        return;
      }
      throw missingToolError(
        "linux",
        "clipboard",
        "install xclip or wl-clipboard"
      );
    },

    async handleFileDialog(_opts: FileDialogRequest) {
      throw missingToolError(
        "linux",
        "file_dialog",
        "file dialog automation is best-effort on Linux — use write_file / open_path instead"
      );
    },

    async screenshot(opts = {}): Promise<ScreenshotResult> {
      const dest =
        opts.path ||
        path.join(
          process.env.TMPDIR || "/tmp",
          `sam-desktop-${Date.now().toString(36)}.png`
        );
      ensureParent(dest);
      const built = buildLinuxScreenshotCommand(caps.screenshot, dest, opts.region);
      if (!built) {
        throw missingToolError(
          "linux",
          "screenshot",
          "install gnome-screenshot, scrot, or grim (Wayland)"
        );
      }
      await run(built.cmd, built.args);
      if (!fs.existsSync(dest)) {
        throw new Error(`Screenshot tool ran but file missing: ${dest}`);
      }
      return {
        path: dest,
        bytes: fs.statSync(dest).size,
        width: opts.region?.width,
        height: opts.region?.height,
      };
    },

    async openMedia(opts) {
      const abs = resolveUserPath(opts.path);
      assertAllowedPath(abs);
      if (!fs.existsSync(abs)) throw new Error(`Media path not found: ${abs}`);
      if (hasUnixTool("xdg-open")) {
        await run("xdg-open", [abs]);
      } else {
        throw missingToolError("linux", "openMedia", "install xdg-utils");
      }
      return { opened: true, path: abs };
    },

    async ffmpeg(opts) {
      if (!hasUnixTool("ffmpeg")) {
        throw missingToolError("linux", "ffmpeg", "install ffmpeg");
      }
      const { stdout, stderr } = await run("ffmpeg", opts.args, {
        timeout: opts.timeoutMs ?? 120_000,
      });
      return { stdout, stderr, code: 0 };
    },

    async isProcessRunning(name: string): Promise<boolean> {
      const n = String(name || "").replace(/\.exe$/i, "");
      if (!n) return false;
      try {
        await run("pgrep", ["-f", n]);
        return true;
      } catch {
        return false;
      }
    },

    async installKillHotkey() {
      return {
        installed: false,
        note: "Linux hotkey watcher not installed — use SAM_DESKTOP_KILL_FILE / pause APIs",
      };
    },
  };
}

/** Exported for tests — command builders only. */
export {
  buildLinuxScreenshotCommand,
  buildLinuxTypeCommand,
  buildLinuxKeyCommand,
  buildLinuxClickCommand,
  buildLinuxListWindowsCommand,
};
