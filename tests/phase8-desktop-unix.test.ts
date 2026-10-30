/**
 * Phase 8 — Linux/macOS operator command building (mock exec, no real GUI).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLinuxClickCommand,
  buildLinuxKeyCommand,
  buildLinuxListWindowsCommand,
  buildLinuxScreenshotCommand,
  buildLinuxTypeCommand,
  buildMacOsascript,
  buildMacScreenshotCommand,
  __resetUnixToolCacheForTests,
} from "../src/tools/desktop/backends/unixDetect.js";
import {
  createLinuxBackend,
  __setLinuxExecForTests,
} from "../src/tools/desktop/backends/linux.js";
import {
  createMacosBackend,
  __setMacExecForTests,
} from "../src/tools/desktop/backends/macos.js";
import {
  isShellCommandAllowed,
  shellAllowlistPrefixes,
} from "../src/tools/registry.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

afterEach(() => {
  __setLinuxExecForTests(null);
  __setMacExecForTests(null);
  __resetUnixToolCacheForTests();
});

describe("Linux command builders", () => {
  it("builds screenshot commands for grim/scrot/gnome-screenshot", () => {
    expect(buildLinuxScreenshotCommand("grim", "/tmp/a.png")).toEqual({
      cmd: "grim",
      args: ["/tmp/a.png"],
    });
    expect(
      buildLinuxScreenshotCommand("scrot", "/tmp/a.png", {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      })
    ).toEqual({
      cmd: "scrot",
      args: ["-a", "1,2,3,4", "/tmp/a.png"],
    });
    expect(buildLinuxScreenshotCommand("gnome-screenshot", "/tmp/a.png")?.cmd).toBe(
      "gnome-screenshot"
    );
    expect(buildLinuxScreenshotCommand("none", "/tmp/a.png")).toBeNull();
  });

  it("builds type/key/click/list commands", () => {
    expect(buildLinuxTypeCommand("xdotool", "hello")?.args).toContain("hello");
    expect(buildLinuxKeyCommand("xdotool", "{ENTER}")?.args).toContain("Return");
    expect(buildLinuxClickCommand("xdotool", { x: 10, y: 20, button: "left" })?.cmd).toBe(
      "xdotool"
    );
    expect(buildLinuxListWindowsCommand("wmctrl")).toEqual({
      cmd: "wmctrl",
      args: ["-lpG"],
    });
  });
});

describe("macOS command builders", () => {
  it("builds screencapture and osascript", () => {
    expect(buildMacScreenshotCommand("/tmp/a.png")).toEqual({
      cmd: "screencapture",
      args: ["-x", "/tmp/a.png"],
    });
    const region = buildMacScreenshotCommand("/tmp/a.png", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(region.args).toContain("-R");
    expect(buildMacOsascript('return "ok"')).toEqual({
      cmd: "osascript",
      args: ["-e", 'return "ok"'],
    });
  });
});

describe("Linux backend with mock exec", () => {
  it("listWindows parses wmctrl output", async () => {
    __setLinuxExecForTests(async (cmd, args) => {
      if (cmd === "wmctrl") {
        return {
          stdout:
            "0x04400007  0 1234   10  20 800 600 host Notepad\n0x04400008  0 5678   0   0  400 300 host Terminal\n",
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });
    const backend = createLinuxBackend({
      windows: "wmctrl",
      input: "xdotool",
      screenshot: "scrot",
      clipboard: "xclip",
      atspi: false,
      session: "x11",
    });
    const wins = await backend.listWindows();
    expect(wins.length).toBe(2);
    expect(wins[0].title).toBe("Notepad");
    expect(wins[0].handle).toBe("0x04400007");
  });

  it("typeText uses xdotool builder via mock exec", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    __setLinuxExecForTests(async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: "", stderr: "" };
    });
    const backend = createLinuxBackend({
      windows: "wmctrl",
      input: "xdotool",
      screenshot: "scrot",
      clipboard: "xclip",
      atspi: false,
      session: "x11",
    });
    await backend.typeText({ text: "hi" });
    expect(calls[0].cmd).toBe("xdotool");
    expect(calls[0].args).toContain("hi");
  });

  it("screenshot writes via grim mock and reports bytes", async () => {
    const dest = path.join(os.tmpdir(), `sam-p8-shot-${Date.now()}.png`);
    __setLinuxExecForTests(async (cmd, args) => {
      const out = args[args.length - 1];
      fs.writeFileSync(out, Buffer.from([137, 80, 78, 71, 0, 0, 0, 0]));
      return { stdout: "", stderr: "" };
    });
    const backend = createLinuxBackend({
      windows: "wmctrl",
      input: "xdotool",
      screenshot: "grim",
      clipboard: "xclip",
      atspi: false,
      session: "wayland",
    });
    const shot = await backend.screenshot({ path: dest });
    expect(shot.path).toBe(dest);
    expect(shot.bytes).toBeGreaterThan(0);
    fs.unlinkSync(dest);
  });

  it("throws clear error when screenshot tool missing", async () => {
    const backend = createLinuxBackend({
      windows: "none",
      input: "none",
      screenshot: "none",
      clipboard: "none",
      atspi: false,
      session: "unknown",
    });
    await expect(backend.screenshot({})).rejects.toThrow(/screenshot/i);
  });
});

describe("macOS backend with mock exec", () => {
  it("listWindows parses osascript TSV", async () => {
    __setMacExecForTests(async () => ({
      stdout: "TextEdit\t111\tUntitled\nTerminal\t222\tbash\n",
      stderr: "",
    }));
    const backend = createMacosBackend({
      osascript: true,
      screencapture: true,
      open: true,
      clipboard: true,
      ffmpeg: false,
    });
    const wins = await backend.listWindows();
    expect(wins[0].processName).toBe("TextEdit");
    expect(wins[0].title).toBe("Untitled");
  });

  it("builds screencapture path on screenshot", async () => {
    const dest = path.join(os.tmpdir(), `sam-p8-mac-${Date.now()}.png`);
    const calls: string[] = [];
    __setMacExecForTests(async (cmd, args) => {
      calls.push(cmd);
      if (cmd === "screencapture") {
        fs.writeFileSync(args[args.length - 1], Buffer.from("png"));
      }
      return { stdout: "", stderr: "" };
    });
    const backend = createMacosBackend({
      osascript: true,
      screencapture: true,
      open: true,
      clipboard: true,
      ffmpeg: false,
    });
    const shot = await backend.screenshot({ path: dest });
    expect(calls).toContain("screencapture");
    expect(shot.bytes).toBeGreaterThan(0);
    fs.unlinkSync(dest);
  });
});

describe("cross-platform run_shell allowlist", () => {
  it("allows Windows Get-* and Unix ls/cat; blocks pipes on Unix", () => {
    expect(
      isShellCommandAllowed(
        "powershell -NoProfile -Command Get-ChildItem",
        "win32"
      )
    ).toBe(true);
    expect(isShellCommandAllowed("dir C:\\", "win32")).toBe(true);
    expect(isShellCommandAllowed("ls Documents", "linux")).toBe(true);
    expect(isShellCommandAllowed("cat README.md", "darwin")).toBe(true);
    expect(isShellCommandAllowed("pwd", "linux")).toBe(true);
    expect(isShellCommandAllowed("ls | rm -rf /", "linux")).toBe(false);
    expect(isShellCommandAllowed("echo hi; reboot", "linux")).toBe(false);
    expect(shellAllowlistPrefixes("linux").some((p) => p.startsWith("ls"))).toBe(
      true
    );
  });
});
