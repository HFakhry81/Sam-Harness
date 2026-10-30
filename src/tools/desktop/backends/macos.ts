/**
 * macOS desktop backend — osascript / AppleScript + screencapture (best-effort).
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
  buildMacOsascript,
  buildMacScreenshotCommand,
  detectMacCapabilities,
  hasUnixTool,
  missingToolError,
  type MacDesktopCapabilities,
} from "./unixDetect.js";

const execFileAsync = promisify(execFile);

export type MacExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number; maxBuffer?: number; input?: string }
) => Promise<{ stdout: string; stderr: string }>;

let injectedExec: MacExecFn | null = null;

export function __setMacExecForTests(fn: MacExecFn | null): void {
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
        if (code && code !== 0) {
          reject(new Error(stderr || `exit ${code}`));
        } else {
          resolve({ stdout, stderr });
        }
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

function appleScriptQuote(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function createMacosBackend(
  capsOverride?: Partial<MacDesktopCapabilities>
): DesktopBackend {
  const caps: MacDesktopCapabilities = {
    ...detectMacCapabilities(),
    ...capsOverride,
  };

  return {
    platform: "darwin",
    name: "macos-accessibility",

    async listWindows(): Promise<WindowInfo[]> {
      if (!caps.osascript) {
        throw missingToolError("darwin", "listWindows", "osascript required");
      }
      const script = `
set out to {}
tell application "System Events"
  repeat with p in (every process whose background only is false)
    try
      set pname to name of p
      set pidv to unix id of p
      repeat with w in (every window of p)
        try
          set t to name of w
          set end of out to (pname & tab & pidv & tab & t)
        end try
      end repeat
    end try
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
`;
      const built = buildMacOsascript(script);
      const { stdout } = await run(built.cmd, built.args, { timeout: 25_000 });
      const out: WindowInfo[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        out.push({
          processName: parts[0],
          pid: Number(parts[1]) || undefined,
          handle: `${parts[1]}:${parts[2]}`,
          title: parts.slice(2).join("\t"),
        });
      }
      return out;
    },

    async focusWindow(opts) {
      if (!caps.osascript) {
        throw missingToolError("darwin", "focusWindow", "osascript required");
      }
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
            (w.processName || "")
              .toLowerCase()
              .includes(String(opts.processName).toLowerCase())
        );
      if (!hit) throw new Error("Window not found");
      const app = hit.processName || "Finder";
      const script = `tell application "${appleScriptQuote(app)}" to activate`;
      const built = buildMacOsascript(script);
      await run(built.cmd, built.args);
      return hit;
    },

    async launchApp(opts) {
      if (!opts.app) throw new Error("app required");
      if (caps.open && (opts.app.endsWith(".app") || !opts.args?.length)) {
        await run("open", opts.args?.length ? ["-a", opts.app, "--args", ...opts.args] : ["-a", opts.app]);
      } else {
        spawn(opts.app, opts.args || [], {
          cwd: opts.cwd,
          detached: true,
          stdio: "ignore",
        }).unref();
      }
      const wait = opts.waitForWindowMs ?? 1500;
      if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 8000)));
      let window: WindowInfo | undefined;
      try {
        const wins = await this.listWindows();
        const base = path.basename(opts.app).replace(/\.app$/i, "");
        window = wins.find((w) =>
          (w.processName || w.title || "").toLowerCase().includes(base.toLowerCase())
        );
      } catch {
        /* optional */
      }
      return { pid: undefined, window };
    },

    async closeWindow(opts) {
      const win = await this.focusWindow(opts);
      if (!caps.osascript) {
        throw missingToolError("darwin", "closeWindow", "osascript required");
      }
      const app = win.processName || "Finder";
      const script = `
tell application "System Events"
  tell process "${appleScriptQuote(app)}"
    if (count of windows) > 0 then
      click button 1 of window 1
    end if
  end tell
end tell`;
      const built = buildMacOsascript(script);
      await run(built.cmd, built.args);
    },

    async getUiaTree(opts): Promise<UiaElement> {
      if (!caps.osascript) {
        throw missingToolError("darwin", "uia_tree", "osascript + Accessibility permission required");
      }
      const maxDepth = opts?.maxDepth ?? 2;
      const title = opts?.titleIncludes || "";
      const script = `
tell application "System Events"
  set rootProc to first process whose background only is false
  if "${appleScriptQuote(title)}" is not "" then
    try
      set rootProc to first process whose name contains "${appleScriptQuote(title)}"
    end try
  end if
  set pname to name of rootProc
  set kids to {}
  try
    repeat with w in (every window of rootProc)
      set end of kids to name of w
    end repeat
  end try
end tell
set AppleScript's text item delimiters to "|"
return pname & "||" & (kids as text)
`;
      const built = buildMacOsascript(script);
      const { stdout } = await run(built.cmd, built.args, { timeout: 20_000 });
      const [pname, rest] = stdout.split("||");
      const children = (rest || "")
        .split("|")
        .filter(Boolean)
        .slice(0, 40)
        .map((name) => ({ name, controlType: "window", children: [] as UiaElement[] }));
      return {
        name: (pname || "desktop").trim(),
        controlType: "application",
        children: maxDepth <= 0 ? [] : children,
      };
    },

    async findUia(opts) {
      const tree = await this.getUiaTree({
        titleIncludes: opts.titleIncludes,
        maxDepth: opts.maxDepth ?? 3,
      });
      const want = String(opts.name || "").toLowerCase();
      const stack: UiaElement[] = [tree];
      while (stack.length) {
        const n = stack.pop()!;
        if (want && String(n.name || "").toLowerCase().includes(want)) return n;
        for (const c of n.children || []) stack.push(c);
      }
      return null;
    },

    async invokeUia(opts) {
      const el = await this.findUia(opts);
      if (!el) throw new Error("UI element not found");
      if (!caps.osascript) {
        throw missingToolError("darwin", "uia_invoke", "osascript required");
      }
      const name = el.name || opts.name || "";
      const script = `
tell application "System Events"
  tell (first process whose background only is false)
    try
      click (first UI element whose name contains "${appleScriptQuote(name)}")
    end try
  end tell
end tell`;
      const built = buildMacOsascript(script);
      await run(built.cmd, built.args);
      return el;
    },

    async setUiaValue(opts) {
      const el = await this.findUia(opts);
      if (!el) throw new Error("UI element not found");
      await this.invokeUia(opts);
      await this.typeText({ text: opts.value });
      return { ...el, value: opts.value };
    },

    async typeText(opts) {
      if (!caps.osascript) {
        throw missingToolError("darwin", "typeText", "osascript required");
      }
      const script = `
tell application "System Events"
  keystroke "${appleScriptQuote(opts.text)}"
end tell`;
      const built = buildMacOsascript(script);
      await run(built.cmd, built.args);
    },

    async sendKeys(opts) {
      if (!caps.osascript) {
        throw missingToolError("darwin", "sendKeys", "osascript required");
      }
      let keys = opts.keys;
      // Map a few common forms
      if (/\{ENTER\}/i.test(keys)) {
        const script = `tell application "System Events" to key code 36`;
        const built = buildMacOsascript(script);
        await run(built.cmd, built.args);
        return;
      }
      if (/\{TAB\}/i.test(keys)) {
        const script = `tell application "System Events" to key code 48`;
        const built = buildMacOsascript(script);
        await run(built.cmd, built.args);
        return;
      }
      const script = `
tell application "System Events"
  keystroke "${appleScriptQuote(keys)}"
end tell`;
      const built = buildMacOsascript(script);
      await run(built.cmd, built.args);
    },

    async click(opts) {
      if (opts.name || opts.automationId) {
        await this.invokeUia(opts);
        return;
      }
      if (!caps.osascript) {
        throw missingToolError("darwin", "click", "osascript required");
      }
      const x = Number(opts.x ?? 0);
      const y = Number(opts.y ?? 0);
      const script = `
tell application "System Events"
  click at {${x}, ${y}}
end tell`;
      const built = buildMacOsascript(script);
      await run(built.cmd, built.args);
    },

    async moveMouse(opts) {
      // AppleScript has no reliable mouse move without cliclick; document limitation
      throw missingToolError(
        "darwin",
        "moveMouse",
        "install cliclick or use click with absolute coords via System Events (limited)"
      );
    },

    async getClipboard(): Promise<ClipboardContent> {
      if (!caps.clipboard) {
        throw missingToolError("darwin", "clipboard", "pbcopy/pbpaste required");
      }
      const { stdout } = await run("pbpaste", []);
      return { text: stdout, format: "text" };
    },

    async setClipboard(opts) {
      if (!caps.clipboard) {
        throw missingToolError("darwin", "clipboard", "pbcopy/pbpaste required");
      }
      await run("pbcopy", [], { input: opts.text });
    },

    async handleFileDialog(opts: FileDialogRequest) {
      if (!opts.path) return { handled: false };
      // Best-effort: type path + Return into focused dialog
      await this.typeText({ text: opts.path });
      await this.sendKeys({ keys: "{ENTER}" });
      return { handled: true, path: opts.path };
    },

    async screenshot(opts = {}): Promise<ScreenshotResult> {
      if (!caps.screencapture) {
        throw missingToolError("darwin", "screenshot", "screencapture required");
      }
      const dest =
        opts.path ||
        path.join(
          process.env.TMPDIR || "/tmp",
          `sam-desktop-${Date.now().toString(36)}.png`
        );
      ensureParent(dest);
      const built = buildMacScreenshotCommand(dest, opts.region);
      await run(built.cmd, built.args);
      if (!fs.existsSync(dest)) {
        throw new Error(`Screenshot file missing: ${dest}`);
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
      if (!caps.open) throw missingToolError("darwin", "openMedia", "open required");
      await run("open", [abs]);
      return { opened: true, path: abs };
    },

    async ffmpeg(opts) {
      if (!hasUnixTool("ffmpeg")) {
        throw missingToolError("darwin", "ffmpeg", "install ffmpeg (brew install ffmpeg)");
      }
      const { stdout, stderr } = await run("ffmpeg", opts.args, {
        timeout: opts.timeoutMs ?? 120_000,
      });
      return { stdout, stderr, code: 0 };
    },

    async isProcessRunning(name: string): Promise<boolean> {
      const n = String(name || "").replace(/\.app$/i, "");
      if (!n) return false;
      try {
        await run("pgrep", ["-if", n]);
        return true;
      } catch {
        return false;
      }
    },

    async installKillHotkey() {
      return {
        installed: false,
        note: "macOS hotkey watcher not installed — use SAM_DESKTOP_KILL_FILE / pause APIs",
      };
    },
  };
}

export { buildMacScreenshotCommand, buildMacOsascript };
