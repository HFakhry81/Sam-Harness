/**
 * Detect availability of Linux/macOS desktop tooling (no network).
 * Used by backends to degrade gracefully with clear errors.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";

export type UnixToolKind =
  | "xdotool"
  | "wmctrl"
  | "ydotool"
  | "gnome-screenshot"
  | "scrot"
  | "grim"
  | "import"
  | "xclip"
  | "wl-copy"
  | "wl-paste"
  | "pbcopy"
  | "pbpaste"
  | "screencapture"
  | "osascript"
  | "open"
  | "xdg-open"
  | "ffmpeg"
  | "python3"
  | "pgrep"
  | "pkill";

const cache = new Map<string, boolean>();

/** Which() with cache — sync, for planning/doctor. */
export function hasUnixTool(name: UnixToolKind | string): boolean {
  const key = String(name);
  if (cache.has(key)) return cache.get(key)!;
  let ok = false;
  try {
    if (process.platform === "win32") {
      ok = false;
    } else {
      execFileSync("which", [key], { stdio: "ignore", timeout: 3000 });
      ok = true;
    }
  } catch {
    // Fallback: common absolute paths
    const candidates = [
      `/usr/bin/${key}`,
      `/usr/local/bin/${key}`,
      `/bin/${key}`,
      `/opt/homebrew/bin/${key}`,
    ];
    ok = candidates.some((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
  }
  cache.set(key, ok);
  return ok;
}

export function __resetUnixToolCacheForTests(): void {
  cache.clear();
}

export type LinuxDesktopCapabilities = {
  input: "xdotool" | "ydotool" | "none";
  windows: "wmctrl" | "xdotool" | "none";
  screenshot: "gnome-screenshot" | "scrot" | "grim" | "import" | "none";
  clipboard: "xclip" | "wl-clipboard" | "none";
  atspi: boolean;
  session: "wayland" | "x11" | "unknown";
};

export function detectLinuxCapabilities(): LinuxDesktopCapabilities {
  const sessionRaw = String(process.env.XDG_SESSION_TYPE || "").toLowerCase();
  const wayland = Boolean(process.env.WAYLAND_DISPLAY) || sessionRaw === "wayland";
  const session = wayland ? "wayland" : process.env.DISPLAY ? "x11" : "unknown";

  let input: LinuxDesktopCapabilities["input"] = "none";
  if (hasUnixTool("xdotool") && !wayland) input = "xdotool";
  else if (hasUnixTool("ydotool")) input = "ydotool";
  else if (hasUnixTool("xdotool")) input = "xdotool"; // may still work under XWayland

  let windows: LinuxDesktopCapabilities["windows"] = "none";
  if (hasUnixTool("wmctrl")) windows = "wmctrl";
  else if (hasUnixTool("xdotool")) windows = "xdotool";

  let screenshot: LinuxDesktopCapabilities["screenshot"] = "none";
  if (wayland && hasUnixTool("grim")) screenshot = "grim";
  else if (hasUnixTool("gnome-screenshot")) screenshot = "gnome-screenshot";
  else if (hasUnixTool("scrot")) screenshot = "scrot";
  else if (hasUnixTool("import")) screenshot = "import";
  else if (hasUnixTool("grim")) screenshot = "grim";

  let clipboard: LinuxDesktopCapabilities["clipboard"] = "none";
  if (wayland && hasUnixTool("wl-copy") && hasUnixTool("wl-paste")) {
    clipboard = "wl-clipboard";
  } else if (hasUnixTool("xclip")) {
    clipboard = "xclip";
  }

  const atspi =
    hasUnixTool("python3") &&
    (() => {
      try {
        execFileSync(
          "python3",
          ["-c", "import pyatspi"],
          { stdio: "ignore", timeout: 4000 }
        );
        return true;
      } catch {
        return false;
      }
    })();

  return { input, windows, screenshot, clipboard, atspi, session };
}

export type MacDesktopCapabilities = {
  osascript: boolean;
  screencapture: boolean;
  open: boolean;
  clipboard: boolean;
  ffmpeg: boolean;
};

export function detectMacCapabilities(): MacDesktopCapabilities {
  return {
    osascript: hasUnixTool("osascript"),
    screencapture: hasUnixTool("screencapture"),
    open: hasUnixTool("open"),
    clipboard: hasUnixTool("pbcopy") && hasUnixTool("pbpaste"),
    ffmpeg: hasUnixTool("ffmpeg"),
  };
}

export function missingToolError(
  platform: "linux" | "darwin",
  capability: string,
  installHint: string
): Error {
  return new Error(
    `Desktop ${capability} unavailable on ${platform}: ${installHint}`
  );
}

/**
 * Pure command builders for tests (mock exec). No side effects.
 */
export function buildLinuxScreenshotCommand(
  tool: LinuxDesktopCapabilities["screenshot"],
  dest: string,
  region?: { x: number; y: number; width: number; height: number }
): { cmd: string; args: string[] } | null {
  if (tool === "none") return null;
  if (tool === "gnome-screenshot") {
    return { cmd: "gnome-screenshot", args: ["-f", dest] };
  }
  if (tool === "scrot") {
    if (region) {
      return {
        cmd: "scrot",
        args: ["-a", `${region.x},${region.y},${region.width},${region.height}`, dest],
      };
    }
    return { cmd: "scrot", args: [dest] };
  }
  if (tool === "grim") {
    if (region) {
      return {
        cmd: "grim",
        args: ["-g", `${region.x},${region.y} ${region.width}x${region.height}`, dest],
      };
    }
    return { cmd: "grim", args: [dest] };
  }
  if (tool === "import") {
    if (region) {
      return {
        cmd: "import",
        args: [
          "-window",
          "root",
          "-crop",
          `${region.width}x${region.height}+${region.x}+${region.y}`,
          dest,
        ],
      };
    }
    return { cmd: "import", args: ["-window", "root", dest] };
  }
  return null;
}

export function buildLinuxTypeCommand(
  tool: LinuxDesktopCapabilities["input"],
  text: string
): { cmd: string; args: string[] } | null {
  if (tool === "xdotool") {
    return { cmd: "xdotool", args: ["type", "--clearmodifiers", "--", text] };
  }
  if (tool === "ydotool") {
    return { cmd: "ydotool", args: ["type", "--", text] };
  }
  return null;
}

export function buildLinuxKeyCommand(
  tool: LinuxDesktopCapabilities["input"],
  keys: string
): { cmd: string; args: string[] } | null {
  // Normalize common SendKeys-ish names to xdotool key names
  const mapped = keys
    .replace(/\{ENTER\}/gi, "Return")
    .replace(/\{TAB\}/gi, "Tab")
    .replace(/\{ESC\}/gi, "Escape")
    .replace(/\^([a-z])/gi, "ctrl+$1")
    .replace(/\+/g, "+");
  if (tool === "xdotool") {
    return { cmd: "xdotool", args: ["key", "--clearmodifiers", mapped] };
  }
  if (tool === "ydotool") {
    return { cmd: "ydotool", args: ["key", mapped] };
  }
  return null;
}

export function buildLinuxClickCommand(
  tool: LinuxDesktopCapabilities["input"],
  opts: { x?: number; y?: number; button?: "left" | "right" | "middle"; clickCount?: number }
): { cmd: string; args: string[] } | null {
  const button = opts.button === "right" ? 3 : opts.button === "middle" ? 2 : 1;
  const count = Math.max(1, opts.clickCount || 1);
  if (tool === "xdotool") {
    const args = ["mousemove", String(opts.x ?? 0), String(opts.y ?? 0), "click", "--repeat", String(count), String(button)];
    return { cmd: "xdotool", args };
  }
  if (tool === "ydotool") {
    const args = [
      "mousemove",
      "--absolute",
      String(opts.x ?? 0),
      String(opts.y ?? 0),
      "click",
      String(button),
    ];
    return { cmd: "ydotool", args };
  }
  return null;
}

export function buildLinuxListWindowsCommand(
  tool: LinuxDesktopCapabilities["windows"]
): { cmd: string; args: string[] } | null {
  if (tool === "wmctrl") {
    return { cmd: "wmctrl", args: ["-lpG"] };
  }
  if (tool === "xdotool") {
    return { cmd: "xdotool", args: ["search", "--name", ""] };
  }
  return null;
}

export function buildMacScreenshotCommand(
  dest: string,
  region?: { x: number; y: number; width: number; height: number }
): { cmd: string; args: string[] } {
  if (region) {
    return {
      cmd: "screencapture",
      args: [
        "-x",
        "-R",
        `${region.x},${region.y},${region.width},${region.height}`,
        dest,
      ],
    };
  }
  return { cmd: "screencapture", args: ["-x", dest] };
}

export function buildMacOsascript(script: string): { cmd: string; args: string[] } {
  return { cmd: "osascript", args: ["-e", script] };
}
