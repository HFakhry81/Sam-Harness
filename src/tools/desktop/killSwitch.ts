/**
 * Kill switch / pause for desktop operator.
 * Checks: env flags, kill-file, and in-memory pause (hotkey sets the file).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type KillSwitchState = {
  paused: boolean;
  killed: boolean;
  reason?: string;
  flagPath: string;
};

let memoryPaused = false;
let memoryKilled = false;
let hotkeyInstalled = false;

export function defaultKillFlagPath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, ".sam-harness-desktop-kill");
}

export function getKillFlagPath(): string {
  const raw = String(process.env.SAM_DESKTOP_KILL_FILE || "").trim();
  return raw || defaultKillFlagPath();
}

export function pauseDesktop(reason = "manual pause"): void {
  memoryPaused = true;
  writeFlag({ paused: true, killed: false, reason });
}

export function resumeDesktop(): void {
  memoryPaused = false;
  memoryKilled = false;
  const p = getKillFlagPath();
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function killDesktop(reason = "kill switch"): void {
  memoryKilled = true;
  memoryPaused = true;
  writeFlag({ paused: true, killed: true, reason });
}

function writeFlag(state: { paused: boolean; killed: boolean; reason?: string }): void {
  const p = getKillFlagPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          ...state,
          at: new Date().toISOString(),
          hotkey: "Ctrl+Shift+Alt+K (Windows when listener installed)",
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    /* best-effort */
  }
}

export function readKillSwitchState(): KillSwitchState {
  const flagPath = getKillFlagPath();
  let filePaused = false;
  let fileKilled = false;
  let reason: string | undefined;

  if (String(process.env.SAM_DESKTOP_KILLED || "").trim() === "1") {
    fileKilled = true;
    filePaused = true;
    reason = "SAM_DESKTOP_KILLED=1";
  }
  if (String(process.env.SAM_DESKTOP_PAUSED || "").trim() === "1") {
    filePaused = true;
    reason = reason || "SAM_DESKTOP_PAUSED=1";
  }

  try {
    if (fs.existsSync(flagPath)) {
      const raw = fs.readFileSync(flagPath, "utf-8");
      try {
        const j = JSON.parse(raw) as { paused?: boolean; killed?: boolean; reason?: string };
        filePaused = filePaused || Boolean(j.paused) || Boolean(j.killed);
        fileKilled = fileKilled || Boolean(j.killed);
        reason = j.reason || reason || "kill flag file present";
      } catch {
        filePaused = true;
        reason = reason || "kill flag file present";
      }
    }
  } catch {
    /* ignore */
  }

  return {
    paused: memoryPaused || filePaused,
    killed: memoryKilled || fileKilled,
    reason,
    flagPath,
  };
}

export function assertDesktopNotStopped(): void {
  const s = readKillSwitchState();
  if (s.killed) {
    throw new Error(`Desktop kill switch active: ${s.reason || "killed"} (${s.flagPath})`);
  }
  if (s.paused) {
    throw new Error(`Desktop operator paused: ${s.reason || "paused"} (${s.flagPath})`);
  }
}

export function markHotkeyInstalled(ok: boolean): void {
  hotkeyInstalled = ok;
}

export function isHotkeyInstalled(): boolean {
  return hotkeyInstalled;
}

export function __resetKillSwitchForTests(): void {
  memoryPaused = false;
  memoryKilled = false;
  hotkeyInstalled = false;
  delete process.env.SAM_DESKTOP_PAUSED;
  delete process.env.SAM_DESKTOP_KILLED;
  try {
    const p = getKillFlagPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}
