/**
 * Windows-only integration tests — gated by platform (and CI windows-latest).
 * Drives Notepad via the real UIA PowerShell backend.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  __resetDesktopBackendForTests,
  __resetKillSwitchForTests,
  createWindowsBackend,
  runDesktopAction,
  setDesktopBackend,
} from "../src/tools/desktop/index.js";
import { __resetActiveRunDirForTests } from "../src/lib/outputHome.js";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";
const runWin = isWindows ? describe : describe.skip;

async function killNotepadBestEffort(): Promise<void> {
  try {
    await execFileAsync(
      "taskkill",
      ["/IM", "notepad.exe", "/F"],
      { windowsHide: true, timeout: 10_000 }
    );
  } catch {
    /* process may already be gone */
  }
}

runWin("desktop Windows integration (Notepad)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-desk-win-"));
    process.env.SAM_OUTPUT_HOME = tmp;
    process.env.SAM_DESKTOP_KILL_FILE = path.join(tmp, "kill.json");
    process.env.APPROVE_DESKTOP = "1";
    // Skip GDI screenshots on CI session desktops (faster + fewer flaky failures)
    process.env.SAM_DESKTOP_RECORD_SHOTS = "0";
    delete process.env.SAM_DESKTOP_DRY_RUN;
    __resetKillSwitchForTests();
    __resetActiveRunDirForTests();
    __resetDesktopBackendForTests();
    setDesktopBackend(createWindowsBackend());
    await killNotepadBestEffort();
  });

  afterEach(async () => {
    try {
      await runDesktopAction({
        action: "close_window",
        params: { titleIncludes: "Notepad", processName: "notepad" },
        approved: true,
        skipVerify: true,
      });
    } catch {
      /* best-effort */
    }
    await killNotepadBestEffort();
    __resetDesktopBackendForTests();
    __resetKillSwitchForTests();
    __resetActiveRunDirForTests();
    delete process.env.APPROVE_DESKTOP;
    delete process.env.SAM_DESKTOP_RECORD_SHOTS;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it(
    "launches Notepad, focuses, types via UIA/SendKeys, verifies window",
    async () => {
      const launch = await runDesktopAction({
        action: "launch_app",
        params: { app: "notepad.exe", waitForWindowMs: 10000 },
        verifyRetries: 5,
      });
      expect(launch.ok, `launch_app failed: ${launch.message}`).toBe(true);

      // Prefer processName focus — titles vary (Untitled - Notepad / Notepad)
      const focus = await runDesktopAction({
        action: "focus_window",
        params: { processName: "notepad" },
        skipVerify: true,
      });
      expect(focus.ok, `focus_window failed: ${focus.message}`).toBe(true);

      const tree = await runDesktopAction({
        action: "uia_tree",
        params: { titleIncludes: "Notepad", maxDepth: 2 },
        skipVerify: true,
      });
      // UIA tree may fail on locked session desktops — allow process-name focus path
      if (!tree.ok) {
        const tree2 = await runDesktopAction({
          action: "uia_tree",
          params: { maxDepth: 1 },
          skipVerify: true,
        });
        expect(tree2.ok || tree.ok, `uia_tree failed: ${tree.message}`).toBeTruthy();
      }

      const typed = await runDesktopAction({
        action: "type_text",
        params: { text: "Sam-Harness Phase4" },
        skipVerify: true,
      });
      expect(typed.ok, `type_text failed: ${typed.message}`).toBe(true);

      const clipSet = await runDesktopAction({
        action: "clipboard_set",
        params: { text: "phase4-clip" },
        skipVerify: true,
      });
      expect(clipSet.ok, `clipboard_set failed: ${clipSet.message}`).toBe(true);
      const clipGet = await runDesktopAction({
        action: "clipboard_get",
        skipVerify: true,
      });
      expect(clipGet.ok, `clipboard_get failed: ${clipGet.message}`).toBe(true);
      expect(String((clipGet.data as { text?: string })?.text || "")).toContain(
        "phase4-clip"
      );

      const listed = await runDesktopAction({
        action: "list_windows",
        skipVerify: true,
      });
      expect(listed.ok, `list_windows failed: ${listed.message}`).toBe(true);
      const wins = (listed.data as Array<{ title?: string; processName?: string }>) || [];
      const hit = wins.some(
        (w) =>
          /notepad/i.test(String(w.title || "")) ||
          /notepad/i.test(String(w.processName || ""))
      );
      expect(hit, `Notepad not in window list: ${JSON.stringify(wins).slice(0, 500)}`).toBe(
        true
      );

      const verify = await runDesktopAction({
        action: "verify",
        verify: [{ kind: "process_running", name: "notepad" }],
        verifyRetries: 3,
      });
      expect(verify.ok, `verify process_running failed: ${verify.message}`).toBe(true);
    },
    120_000
  );
});
