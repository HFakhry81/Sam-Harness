/**
 * Desktop operator orchestrator: dry-run, permissions, kill switch, act, verify, record.
 */
import { resolveUserPath, assertAllowedPath } from "../../lib/paths.js";
import { getDesktopBackend } from "./backendFactory.js";
import { assertDesktopNotStopped, getKillFlagPath, markHotkeyInstalled } from "./killSwitch.js";
import {
  classifyDesktopRisk,
  resolveApproval,
  requiresApproval,
} from "./permissions.js";
import {
  desktopScreenshotPath,
  persistScreenshotMeta,
  recordDesktopTimeline,
} from "./recording.js";
import { defaultVerifyFor, verifyAfterAct } from "./verify.js";
import type {
  DesktopActionName,
  DesktopActionPlan,
  DesktopActionRequest,
  DesktopActionResult,
  DesktopBackend,
  VerifyExpectation,
} from "./types.js";

export function isDesktopDryRun(request?: DesktopActionRequest): boolean {
  if (request?.dryRun === true) return true;
  return String(process.env.SAM_DESKTOP_DRY_RUN || "").trim() === "1";
}

export function planDesktopAction(request: DesktopActionRequest): DesktopActionPlan {
  const params = { ...(request.params || {}) };
  const risk = classifyDesktopRisk(request.action, params);
  const verify =
    request.verify ||
    defaultVerifyFor(request.action, params);
  return {
    action: request.action,
    risk,
    requiresApproval: requiresApproval(risk),
    summary: summarize(request.action, params, risk),
    params,
    verify,
  };
}

function summarize(
  action: DesktopActionName,
  params: Record<string, unknown>,
  risk: string
): string {
  const bits = Object.entries(params)
    .slice(0, 6)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  return `[${risk}] ${action}${bits ? ` (${bits})` : ""}`;
}

async function executeOnBackend(
  backend: DesktopBackend,
  action: DesktopActionName,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (action) {
    case "list_windows":
      return backend.listWindows();
    case "focus_window":
      return backend.focusWindow({
        handle: params.handle ? String(params.handle) : undefined,
        titleIncludes: params.titleIncludes
          ? String(params.titleIncludes)
          : params.title
            ? String(params.title)
            : undefined,
        processName: params.processName ? String(params.processName) : undefined,
      });
    case "launch_app":
      return backend.launchApp({
        app: String(params.app || params.path || ""),
        args: Array.isArray(params.args) ? params.args.map(String) : undefined,
        cwd: params.cwd ? String(params.cwd) : undefined,
        waitForWindowMs: params.waitForWindowMs
          ? Number(params.waitForWindowMs)
          : undefined,
      });
    case "close_window":
      await backend.closeWindow({
        handle: params.handle ? String(params.handle) : undefined,
        titleIncludes: params.titleIncludes ? String(params.titleIncludes) : undefined,
      });
      return { closed: true };
    case "uia_tree":
      return backend.getUiaTree({
        handle: params.handle ? String(params.handle) : undefined,
        titleIncludes: params.titleIncludes ? String(params.titleIncludes) : undefined,
        maxDepth: params.maxDepth != null ? Number(params.maxDepth) : undefined,
      });
    case "uia_find":
      return backend.findUia({
        handle: params.handle ? String(params.handle) : undefined,
        titleIncludes: params.titleIncludes ? String(params.titleIncludes) : undefined,
        name: params.name ? String(params.name) : undefined,
        automationId: params.automationId ? String(params.automationId) : undefined,
        controlType: params.controlType ? String(params.controlType) : undefined,
        maxDepth: params.maxDepth != null ? Number(params.maxDepth) : undefined,
      });
    case "uia_invoke":
      return backend.invokeUia({
        handle: params.handle ? String(params.handle) : undefined,
        titleIncludes: params.titleIncludes ? String(params.titleIncludes) : undefined,
        name: params.name ? String(params.name) : undefined,
        automationId: params.automationId ? String(params.automationId) : undefined,
        controlType: params.controlType ? String(params.controlType) : undefined,
        pattern: params.pattern as "Invoke" | "Toggle" | "ExpandCollapse" | "SelectionItem" | undefined,
      });
    case "uia_set_value":
      return backend.setUiaValue({
        handle: params.handle ? String(params.handle) : undefined,
        titleIncludes: params.titleIncludes ? String(params.titleIncludes) : undefined,
        name: params.name ? String(params.name) : undefined,
        automationId: params.automationId ? String(params.automationId) : undefined,
        value: String(params.value ?? ""),
      });
    case "type_text":
      await backend.typeText({
        text: String(params.text ?? ""),
        delayMs: params.delayMs != null ? Number(params.delayMs) : undefined,
      });
      return { typed: true, length: String(params.text ?? "").length };
    case "key":
      await backend.sendKeys({ keys: String(params.keys ?? params.key ?? "") });
      return { sent: true };
    case "click":
      await backend.click({
        x: params.x != null ? Number(params.x) : undefined,
        y: params.y != null ? Number(params.y) : undefined,
        button: params.button as "left" | "right" | "middle" | undefined,
        clickCount: params.clickCount != null ? Number(params.clickCount) : undefined,
        name: params.name ? String(params.name) : undefined,
        automationId: params.automationId ? String(params.automationId) : undefined,
        handle: params.handle ? String(params.handle) : undefined,
        titleIncludes: params.titleIncludes ? String(params.titleIncludes) : undefined,
      });
      return { clicked: true };
    case "move_mouse":
      await backend.moveMouse({ x: Number(params.x), y: Number(params.y) });
      return { moved: true };
    case "clipboard_get":
      return backend.getClipboard();
    case "clipboard_set":
      await backend.setClipboard({ text: String(params.text ?? "") });
      return { set: true };
    case "file_dialog":
      return backend.handleFileDialog({
        mode: (params.mode as "open" | "save") || "open",
        path: params.path ? String(params.path) : undefined,
        filter: params.filter ? String(params.filter) : undefined,
        dialogTitle: params.dialogTitle ? String(params.dialogTitle) : undefined,
      });
    case "screenshot": {
      const dest = params.path
        ? resolveUserPath(String(params.path))
        : desktopScreenshotPath("capture", params.runId ? String(params.runId) : undefined);
      if (params.path) assertAllowedPath(dest);
      const shot = await backend.screenshot({ path: dest });
      return persistScreenshotMeta(shot, "capture");
    }
    case "open_media": {
      const p = resolveUserPath(String(params.path || ""));
      assertAllowedPath(p);
      return backend.openMedia({ path: p });
    }
    case "ffmpeg": {
      const args = Array.isArray(params.args)
        ? params.args.map(String)
        : String(params.command || "")
            .split(/\s+/)
            .filter(Boolean);
      return backend.ffmpeg({
        args,
        cwd: params.cwd ? String(params.cwd) : undefined,
        timeoutMs: params.timeoutMs != null ? Number(params.timeoutMs) : undefined,
      });
    }
    case "verify":
      return { deferred: true };
    default:
      throw new Error(`Unknown desktop action: ${action}`);
  }
}

/**
 * Run one desktop action with full policy (dry-run / approval / kill / verify / timeline).
 */
export async function runDesktopAction(
  request: DesktopActionRequest,
  backend: DesktopBackend = getDesktopBackend()
): Promise<DesktopActionResult> {
  const started = Date.now();
  const plan = planDesktopAction(request);
  const runId = request.runId || process.env.SAM_DURABLE_RUN_ID;

  recordDesktopTimeline({
    runId,
    action: request.action,
    status: "start",
    detail: { plan },
  });

  // Dry-run: return plan only
  if (isDesktopDryRun(request)) {
    const result: DesktopActionResult = {
      ok: true,
      action: request.action,
      message: `Dry-run: ${plan.summary}`,
      dryRun: true,
      risk: plan.risk,
      requiresApproval: plan.requiresApproval,
      plan,
      data: { wouldExecute: plan },
    };
    const timelineEventId = recordDesktopTimeline({
      runId,
      action: request.action,
      status: "info",
      result,
      durationMs: Date.now() - started,
    });
    result.recording = { timelineEventId };
    return result;
  }

  // Kill / pause
  try {
    assertDesktopNotStopped();
  } catch (e: any) {
    const result: DesktopActionResult = {
      ok: false,
      action: request.action,
      message: e?.message || String(e),
      risk: plan.risk,
      data: { killSwitch: true, flagPath: getKillFlagPath() },
    };
    recordDesktopTimeline({
      runId,
      action: request.action,
      status: "error",
      result,
      durationMs: Date.now() - started,
    });
    return result;
  }

  // Best-effort hotkey install once per process
  try {
    const hk = await backend.installKillHotkey?.({ flagPath: getKillFlagPath() });
    if (hk) markHotkeyInstalled(Boolean(hk.installed));
  } catch {
    /* ignore */
  }

  // Approval gate
  const approval = resolveApproval(request, plan.risk);
  if (!approval.ok) {
    const result: DesktopActionResult = {
      ok: false,
      action: request.action,
      message: approval.message || "Approval required",
      risk: plan.risk,
      requiresApproval: true,
      approvalId: approval.approvalId,
      plan,
      data: { pendingApproval: true, approval: approval.record },
    };
    recordDesktopTimeline({
      runId,
      action: request.action,
      status: "info",
      result,
      durationMs: Date.now() - started,
    });
    return result;
  }

  let screenshotBefore: string | undefined;
  const needsShot =
    !request.skipVerify &&
    plan.verify.some(
      (v) => v.kind === "screenshot_changed" || v.kind === "screenshot_stable"
    );

  try {
    if (needsShot || String(process.env.SAM_DESKTOP_RECORD_SHOTS || "1") === "1") {
      try {
        const beforePath = desktopScreenshotPath(`${request.action}-before`, runId);
        const shot = await backend.screenshot({ path: beforePath });
        screenshotBefore = persistScreenshotMeta(shot, "before").path;
      } catch {
        screenshotBefore = undefined;
      }
    }

    assertDesktopNotStopped();
    const data = await executeOnBackend(backend, request.action, plan.params);

    let verification: DesktopActionResult["verification"];
    let screenshotAfter: string | undefined;

    if (request.action === "verify") {
      const expectations = (request.verify || []) as VerifyExpectation[];
      const v = await verifyAfterAct(backend, expectations, {
        retries: request.verifyRetries ?? 2,
        beforeShot: screenshotBefore,
        captureAfter: async () => {
          const p = desktopScreenshotPath("verify-after", runId);
          return backend.screenshot({ path: p });
        },
      });
      verification = { ok: v.ok, attempts: v.attempts, details: v.details };
      screenshotAfter = v.screenshotAfter?.path;
      const result: DesktopActionResult = {
        ok: v.ok,
        action: request.action,
        message: v.ok ? "Verification passed" : `Verification failed: ${v.details.join("; ")}`,
        risk: plan.risk,
        approvalId: approval.approvalId,
        verification,
        data: { expectations },
        recording: { screenshotBefore, screenshotAfter },
      };
      const timelineEventId = recordDesktopTimeline({
        runId,
        action: request.action,
        status: v.ok ? "ok" : "error",
        result,
        durationMs: Date.now() - started,
      });
      result.recording = { ...result.recording, timelineEventId };
      return result;
    }

    if (!request.skipVerify && plan.verify.length) {
      const v = await verifyAfterAct(backend, plan.verify, {
        retries: request.verifyRetries ?? 2,
        beforeShot: screenshotBefore,
        captureAfter: async () => {
          const p = desktopScreenshotPath(`${request.action}-after`, runId);
          return backend.screenshot({ path: p });
        },
      });
      verification = { ok: v.ok, attempts: v.attempts, details: v.details };
      screenshotAfter = v.screenshotAfter?.path;
      if (!v.ok) {
        // Vision fallback note: keep action result but mark verify failed for CEO retry
        const result: DesktopActionResult = {
          ok: false,
          action: request.action,
          message: `Action ran but verify failed after ${v.attempts} attempt(s): ${v.details.join("; ")}. Vision fallback: inspect screenshots.`,
          risk: plan.risk,
          approvalId: approval.approvalId,
          data,
          verification,
          recording: { screenshotBefore, screenshotAfter },
          plan,
        };
        const timelineEventId = recordDesktopTimeline({
          runId,
          action: request.action,
          status: "error",
          result,
          durationMs: Date.now() - started,
        });
        result.recording = { ...result.recording, timelineEventId };
        return result;
      }
    } else if (screenshotBefore) {
      try {
        const p = desktopScreenshotPath(`${request.action}-after`, runId);
        const shot = await backend.screenshot({ path: p });
        screenshotAfter = persistScreenshotMeta(shot, "after").path;
      } catch {
        /* ignore */
      }
    }

    const result: DesktopActionResult = {
      ok: true,
      action: request.action,
      message: `Desktop ${request.action} ok`,
      risk: plan.risk,
      approvalId: approval.approvalId,
      data,
      verification,
      recording: { screenshotBefore, screenshotAfter },
      plan,
    };
    const timelineEventId = recordDesktopTimeline({
      runId,
      action: request.action,
      status: "ok",
      result,
      durationMs: Date.now() - started,
    });
    result.recording = { ...result.recording, timelineEventId };
    return result;
  } catch (e: any) {
    // Screenshot + vision fallback path: capture after failure for human/LLM inspection
    let screenshotAfter: string | undefined;
    try {
      const p = desktopScreenshotPath(`${request.action}-error`, runId);
      const shot = await backend.screenshot({ path: p });
      screenshotAfter = persistScreenshotMeta(shot, "error").path;
    } catch {
      /* ignore */
    }
    const result: DesktopActionResult = {
      ok: false,
      action: request.action,
      message: e?.message || String(e),
      risk: plan.risk,
      approvalId: approval.approvalId,
      plan,
      recording: { screenshotBefore, screenshotAfter },
      data: {
        visionFallback: Boolean(screenshotAfter || screenshotBefore),
        hint: "UIA failed — inspect screenshots under the run folder for vision fallback",
      },
    };
    recordDesktopTimeline({
      runId,
      action: request.action,
      status: "error",
      result,
      durationMs: Date.now() - started,
    });
    return result;
  }
}

/** Map registry-style tool name → desktop action */
export function desktopToolToAction(tool: string): DesktopActionName | null {
  const map: Record<string, DesktopActionName> = {
    desktop_list_windows: "list_windows",
    desktop_focus_window: "focus_window",
    desktop_launch_app: "launch_app",
    desktop_close_window: "close_window",
    desktop_uia_tree: "uia_tree",
    desktop_uia_find: "uia_find",
    desktop_uia_invoke: "uia_invoke",
    desktop_uia_set_value: "uia_set_value",
    desktop_type_text: "type_text",
    desktop_key: "key",
    desktop_click: "click",
    desktop_move_mouse: "move_mouse",
    desktop_clipboard_get: "clipboard_get",
    desktop_clipboard_set: "clipboard_set",
    desktop_file_dialog: "file_dialog",
    desktop_screenshot: "screenshot",
    desktop_verify: "verify",
    open_media: "open_media",
    ffmpeg: "ffmpeg",
    ffmpeg_run: "ffmpeg",
  };
  return map[tool] || null;
}

export function listDesktopToolNames(): string[] {
  return [
    "desktop_list_windows",
    "desktop_focus_window",
    "desktop_launch_app",
    "desktop_close_window",
    "desktop_uia_tree",
    "desktop_uia_find",
    "desktop_uia_invoke",
    "desktop_uia_set_value",
    "desktop_type_text",
    "desktop_key",
    "desktop_click",
    "desktop_move_mouse",
    "desktop_clipboard_get",
    "desktop_clipboard_set",
    "desktop_file_dialog",
    "desktop_screenshot",
    "desktop_verify",
    "open_media",
    "ffmpeg",
  ];
}
