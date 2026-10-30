/**
 * Phase 4 desktop operator — unit tests with mocked backend (all OS).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetDesktopBackendForTests,
  __resetKillSwitchForTests,
  classifyDesktopRisk,
  createMockBackend,
  createMockDesktopState,
  killDesktop,
  pauseDesktop,
  planDesktopAction,
  readKillSwitchState,
  requiresApproval,
  resumeDesktop,
  runDesktopAction,
  setDesktopBackend,
  useMockDesktopBackend,
} from "../src/tools/desktop/index.js";
import { assertToolAllowed, OPERATOR_CAPABILITIES } from "../src/agency/capabilities.js";
import { executeTool } from "../src/tools/registry.js";
import { executeToolAsRole } from "../src/agency/safeExecute.js";
import { startDurableRun, getRunTimeline } from "../src/lib/durableRuns.js";
import { beginOutputRun, __resetActiveRunDirForTests } from "../src/lib/outputHome.js";

describe("desktop permissions matrix", () => {
  it("classifies read vs destructive vs financial/sending", () => {
    expect(classifyDesktopRisk("list_windows")).toBe("read");
    expect(classifyDesktopRisk("uia_tree")).toBe("read");
    expect(classifyDesktopRisk("launch_app", { app: "notepad" })).toBe("ops_safe");
    expect(classifyDesktopRisk("close_window", { titleIncludes: "Notepad" })).toBe(
      "destructive"
    );
    expect(classifyDesktopRisk("launch_app", { app: "paypal-desktop" })).toBe("financial");
    expect(classifyDesktopRisk("type_text", { text: "send email now" })).toBe("sending");
    expect(requiresApproval("destructive")).toBe(true);
    expect(requiresApproval("ops_safe")).toBe(false);
  });

  it("exposes desktop tools on operator capability matrix", () => {
    expect(OPERATOR_CAPABILITIES.tools).toContain("desktop_launch_app");
    expect(OPERATOR_CAPABILITIES.tools).toContain("desktop_uia_invoke");
    expect(OPERATOR_CAPABILITIES.tools).toContain("open_media");
    expect(OPERATOR_CAPABILITIES.tools).toContain("ffmpeg");
    expect(() => assertToolAllowed("operator", "desktop_click")).not.toThrow();
    expect(() => assertToolAllowed("auditor", "desktop_launch_app")).toThrow();
  });
});

describe("desktop operator with mock backend", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-desk-"));
    process.env.SAM_OUTPUT_HOME = tmp;
    process.env.SAM_DESKTOP_KILL_FILE = path.join(tmp, "kill.json");
    delete process.env.SAM_DESKTOP_DRY_RUN;
    delete process.env.APPROVE_DESKTOP;
    delete process.env.SAM_DESKTOP_PAUSED;
    __resetKillSwitchForTests();
    __resetActiveRunDirForTests();
    useMockDesktopBackend();
  });

  afterEach(() => {
    __resetDesktopBackendForTests();
    __resetKillSwitchForTests();
    __resetActiveRunDirForTests();
    delete process.env.SAM_DESKTOP_DRY_RUN;
    delete process.env.APPROVE_DESKTOP;
    delete process.env.SAM_DURABLE_RUN_ID;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("dry-run returns a plan without side effects", async () => {
    const mock = createMockBackend();
    setDesktopBackend(mock);
    process.env.SAM_DESKTOP_DRY_RUN = "1";
    const result = await runDesktopAction({
      action: "launch_app",
      params: { app: "notepad" },
    });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.plan?.action).toBe("launch_app");
    expect(mock.state.launched).toHaveLength(0);
  });

  it("launches app, types text, verifies via UIA value", async () => {
    const mock = createMockBackend(createMockDesktopState());
    setDesktopBackend(mock);
    const launch = await runDesktopAction({
      action: "launch_app",
      params: { app: "notepad.exe", expectTitle: "Notepad" },
      skipVerify: false,
    });
    expect(launch.ok).toBe(true);
    expect(mock.state.launched).toContain("notepad.exe");

    const typed = await runDesktopAction({
      action: "type_text",
      params: { text: "hello-sam" },
      skipVerify: true,
    });
    expect(typed.ok).toBe(true);
    expect(mock.state.typed).toContain("hello-sam");

    const setVal = await runDesktopAction({
      action: "uia_set_value",
      params: { automationId: "15", value: "hello-sam" },
    });
    expect(setVal.ok).toBe(true);
  });

  it("blocks destructive close_window until approved", async () => {
    const mock = createMockBackend();
    setDesktopBackend(mock);
    const blocked = await runDesktopAction({
      action: "close_window",
      params: { titleIncludes: "Notepad" },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.approvalId).toBeTruthy();
    expect(mock.state.windows.length).toBeGreaterThan(0);

    const allowed = await runDesktopAction({
      action: "close_window",
      params: { titleIncludes: "Notepad" },
      approved: true,
      skipVerify: true,
    });
    expect(allowed.ok).toBe(true);
  });

  it("honors kill switch / pause", async () => {
    pauseDesktop("test pause");
    expect(readKillSwitchState().paused).toBe(true);
    const paused = await runDesktopAction({
      action: "list_windows",
    });
    expect(paused.ok).toBe(false);
    expect(paused.message).toMatch(/paused/i);

    resumeDesktop();
    killDesktop("test kill");
    const killed = await runDesktopAction({ action: "list_windows" });
    expect(killed.ok).toBe(false);
    expect(killed.message).toMatch(/kill/i);
    resumeDesktop();
  });

  it("records actions on the durable run timeline", async () => {
    const run = startDurableRun({ mode: "desktop-test" });
    process.env.SAM_DURABLE_RUN_ID = run.id;
    beginOutputRun(run.id);
    const mock = createMockBackend();
    setDesktopBackend(mock);

    await runDesktopAction({
      action: "clipboard_set",
      params: { text: "abc" },
      skipVerify: true,
      runId: run.id,
    });
    await runDesktopAction({
      action: "clipboard_get",
      runId: run.id,
    });

    const events = getRunTimeline(run.id);
    const desktopEvents = events.filter((e) => e.kind === "desktop");
    expect(desktopEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("planDesktopAction includes verify expectations for launch_app", () => {
    const plan = planDesktopAction({
      action: "launch_app",
      params: { app: "notepad" },
    });
    expect(plan.verify.some((v) => v.kind === "process_running")).toBe(true);
  });

  it("registry routes desktop_* tools through the operator", async () => {
    const mock = createMockBackend();
    setDesktopBackend(mock);
    const r = await executeTool("desktop_list_windows", {});
    expect(r.ok).toBe(true);
    expect(r.tool).toBe("desktop_list_windows");
  });

  it("safeExecute denies desktop tools for read-only roles", async () => {
    const denied = await executeToolAsRole("evidence", "desktop_launch_app", {
      app: "notepad",
    });
    expect(denied.ok).toBe(false);
    expect((denied.data as { denied?: boolean })?.denied).toBe(true);
  });

  it("open_media and ffmpeg are reachable via registry (mock)", async () => {
    const mock = createMockBackend();
    setDesktopBackend(mock);
    const mediaPath = path.join(tmp, "clip.mp4");
    fs.writeFileSync(mediaPath, "fake");
    const media = await executeTool("open_media", { path: mediaPath, skipVerify: true });
    expect(media.ok).toBe(true);
    expect(mock.state.mediaOpened).toContain(mediaPath);

    // ffmpeg is classified destructive → needs approval
    const blocked = await executeTool("ffmpeg", {
      args: ["-i", mediaPath, path.join(tmp, "out.mp4")],
    });
    expect(blocked.ok).toBe(false);

    const ok = await executeTool("ffmpeg", {
      args: ["-i", mediaPath, path.join(tmp, "out.mp4")],
      approved: true,
      skipVerify: true,
    });
    expect(ok.ok).toBe(true);
    expect(mock.state.ffmpegCalls.length).toBe(1);
  });

  it("file dialog + clipboard round-trip on mock", async () => {
    const mock = createMockBackend();
    setDesktopBackend(mock);
    const clip = await runDesktopAction({
      action: "clipboard_set",
      params: { text: "desk-clip" },
      skipVerify: true,
    });
    expect(clip.ok).toBe(true);
    const got = await runDesktopAction({ action: "clipboard_get" });
    expect(got.ok).toBe(true);
    expect((got.data as { text?: string })?.text).toBe("desk-clip");

    const dlg = await runDesktopAction({
      action: "file_dialog",
      params: { mode: "open", path: path.join(tmp, "a.txt") },
      skipVerify: true,
    });
    expect(dlg.ok).toBe(true);
    expect(mock.state.fileDialogs).toHaveLength(1);
  });
});
