/**
 * Windows-only integration tests — gated by platform (and CI windows-latest).
 * Drives Notepad via the real UIA PowerShell backend.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  __resetDesktopBackendForTests,
  __resetKillSwitchForTests,
  createWindowsBackend,
  runDesktopAction,
  setDesktopBackend,
} from "../src/tools/desktop/index.js";
import { __resetActiveRunDirForTests } from "../src/lib/outputHome.js";

const isWindows = process.platform === "win32";
const runWin = isWindows ? describe : describe.skip;

runWin("desktop Windows integration (Notepad)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-desk-win-"));
    process.env.SAM_OUTPUT_HOME = tmp;
    process.env.SAM_DESKTOP_KILL_FILE = path.join(tmp, "kill.json");
    process.env.APPROVE_DESKTOP = "1";
    delete process.env.SAM_DESKTOP_DRY_RUN;
    __resetKillSwitchForTests();
    __resetActiveRunDirForTests();
    __resetDesktopBackendForTests();
    setDesktopBackend(createWindowsBackend());
  });

  afterEach(async () => {
    try {
      await runDesktopAction({
        action: "close_window",
        params: { titleIncludes: "Notepad" },
        approved: true,
        skipVerify: true,
      });
    } catch {
      /* best-effort */
    }
    __resetDesktopBackendForTests();
    __resetKillSwitchForTests();
    __resetActiveRunDirForTests();
    delete process.env.APPROVE_DESKTOP;
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
        params: { app: "notepad.exe", expectTitle: "Notepad", waitForWindowMs: 4000 },
        verifyRetries: 4,
      });
      expect(launch.ok).toBe(true);

      const focus = await runDesktopAction({
        action: "focus_window",
        params: { titleIncludes: "Notepad" },
      });
      expect(focus.ok).toBe(true);

      const tree = await runDesktopAction({
        action: "uia_tree",
        params: { titleIncludes: "Notepad", maxDepth: 3 },
        skipVerify: true,
      });
      expect(tree.ok).toBe(true);

      const typed = await runDesktopAction({
        action: "type_text",
        params: { text: "Sam-Harness Phase4" },
        skipVerify: true,
      });
      expect(typed.ok).toBe(true);

      const clipSet = await runDesktopAction({
        action: "clipboard_set",
        params: { text: "phase4-clip" },
        skipVerify: true,
      });
      expect(clipSet.ok).toBe(true);
      const clipGet = await runDesktopAction({ action: "clipboard_get" });
      expect(clipGet.ok).toBe(true);
      expect(String((clipGet.data as { text?: string })?.text || "")).toContain("phase4-clip");

      const listed = await runDesktopAction({ action: "list_windows" });
      expect(listed.ok).toBe(true);
      const wins = (listed.data as Array<{ title?: string }>) || [];
      expect(wins.some((w) => /notepad/i.test(String(w.title || "")))).toBe(true);
    },
    90_000
  );
});
