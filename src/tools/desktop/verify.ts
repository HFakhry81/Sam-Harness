/**
 * Verify-after-act loop: element state and/or screenshot diff, with retries.
 */
import * as fs from "fs";
import * as path from "path";
import type {
  DesktopBackend,
  ScreenshotResult,
  VerifyExpectation,
} from "./types.js";

export type VerifyAttemptResult = {
  ok: boolean;
  details: string[];
  attempts: number;
  screenshotAfter?: ScreenshotResult;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkOne(
  backend: DesktopBackend,
  expectation: VerifyExpectation,
  ctx: { beforeShot?: string; afterShot?: string }
): Promise<{ ok: boolean; detail: string }> {
  switch (expectation.kind) {
    case "window_title": {
      const wins = await backend.listWindows();
      const hit = wins.find((w) =>
        w.title.toLowerCase().includes(expectation.includes.toLowerCase())
      );
      return {
        ok: Boolean(hit),
        detail: hit
          ? `window_title matched: ${hit.title}`
          : `window_title missing: ${expectation.includes}`,
      };
    }
    case "process_running": {
      const wins = await backend.listWindows();
      const name = expectation.name.toLowerCase().replace(/\.exe$/i, "");
      const hit = wins.find((w) =>
        (w.processName || "").toLowerCase().replace(/\.exe$/i, "").includes(name)
      );
      return {
        ok: Boolean(hit),
        detail: hit
          ? `process_running: ${hit.processName || hit.title}`
          : `process not found: ${expectation.name}`,
      };
    }
    case "file_exists": {
      const p = path.normalize(expectation.path);
      const ok = fs.existsSync(p);
      return { ok, detail: ok ? `file exists: ${p}` : `file missing: ${p}` };
    }
    case "uia_exists": {
      const el = await backend.findUia({
        name: expectation.name,
        automationId: expectation.automationId,
        controlType: expectation.controlType,
      });
      return {
        ok: Boolean(el),
        detail: el
          ? `uia_exists: ${el.name || el.automationId || el.controlType}`
          : `uia element missing: ${JSON.stringify(expectation)}`,
      };
    }
    case "uia_value": {
      const el = await backend.findUia({
        name: expectation.name,
        automationId: expectation.automationId,
      });
      if (!el) {
        return { ok: false, detail: `uia_value: element not found` };
      }
      const val = String(el.value ?? "");
      if (expectation.equals != null) {
        const ok = val === expectation.equals;
        return { ok, detail: ok ? `uia_value equals` : `uia_value got=${JSON.stringify(val)}` };
      }
      if (expectation.includes != null) {
        const ok = val.includes(expectation.includes);
        return {
          ok,
          detail: ok ? `uia_value includes` : `uia_value missing substring`,
        };
      }
      return { ok: true, detail: `uia_value present (${val.length} chars)` };
    }
    case "screenshot_changed": {
      if (!ctx.beforeShot || !ctx.afterShot) {
        return { ok: false, detail: "screenshot_changed: missing before/after paths" };
      }
      if (!backend.screenshotDiff) {
        // Fallback: size/mtime comparison
        try {
          const a = fs.statSync(ctx.beforeShot);
          const b = fs.statSync(ctx.afterShot);
          const changed = a.size !== b.size || a.mtimeMs !== b.mtimeMs;
          return {
            ok: changed,
            detail: changed
              ? `screenshot_changed (stat fallback)`
              : `screenshot unchanged (stat fallback)`,
          };
        } catch (e: any) {
          return { ok: false, detail: `screenshot_changed error: ${e?.message || e}` };
        }
      }
      const ratio = await backend.screenshotDiff(ctx.beforeShot, ctx.afterShot);
      const min = expectation.minDiffRatio ?? 0.001;
      return {
        ok: ratio >= min,
        detail: `screenshot_changed ratio=${ratio.toFixed(4)} (min ${min})`,
      };
    }
    case "screenshot_stable": {
      if (!ctx.beforeShot || !ctx.afterShot) {
        return { ok: false, detail: "screenshot_stable: missing before/after paths" };
      }
      if (!backend.screenshotDiff) {
        return { ok: true, detail: "screenshot_stable skipped (no diff impl)" };
      }
      const ratio = await backend.screenshotDiff(ctx.beforeShot, ctx.afterShot);
      const max = expectation.maxDiffRatio ?? 0.02;
      return {
        ok: ratio <= max,
        detail: `screenshot_stable ratio=${ratio.toFixed(4)} (max ${max})`,
      };
    }
    default:
      return { ok: false, detail: `unknown expectation` };
  }
}

export async function verifyAfterAct(
  backend: DesktopBackend,
  expectations: VerifyExpectation[],
  opts: {
    retries?: number;
    delayMs?: number;
    beforeShot?: string;
    captureAfter?: () => Promise<ScreenshotResult | undefined>;
  } = {}
): Promise<VerifyAttemptResult> {
  if (!expectations.length) {
    return { ok: true, details: ["no expectations"], attempts: 0 };
  }
  const retries = Math.max(0, opts.retries ?? 2);
  const delayMs = opts.delayMs ?? 400;
  let attempts = 0;
  let lastDetails: string[] = [];
  let afterShot: ScreenshotResult | undefined;

  for (let i = 0; i <= retries; i++) {
    attempts = i + 1;
    if (opts.captureAfter) {
      try {
        afterShot = await opts.captureAfter();
      } catch {
        afterShot = undefined;
      }
    }
    const details: string[] = [];
    let allOk = true;
    for (const exp of expectations) {
      const r = await checkOne(backend, exp, {
        beforeShot: opts.beforeShot,
        afterShot: afterShot?.path,
      });
      details.push(r.detail);
      if (!r.ok) allOk = false;
    }
    lastDetails = details;
    if (allOk) {
      return { ok: true, details, attempts, screenshotAfter: afterShot };
    }
    if (i < retries) await sleep(delayMs * (i + 1));
  }

  return { ok: false, details: lastDetails, attempts, screenshotAfter: afterShot };
}

export function defaultVerifyFor(
  action: string,
  params: Record<string, unknown>
): VerifyExpectation[] {
  switch (action) {
    case "launch_app": {
      const app = String(params.app || "");
      const base = path.basename(app).replace(/\.exe$/i, "");
      if (!base) return [];
      return [
        { kind: "process_running", name: base },
        { kind: "window_title", includes: String(params.expectTitle || base) },
      ];
    }
    case "focus_window": {
      const title = String(params.titleIncludes || params.title || "");
      return title ? [{ kind: "window_title", includes: title }] : [];
    }
    case "open_media": {
      const p = String(params.path || "");
      return p ? [{ kind: "file_exists", path: p }] : [];
    }
    case "uia_set_value": {
      const value = String(params.value ?? "");
      return [
        {
          kind: "uia_value",
          automationId: params.automationId ? String(params.automationId) : undefined,
          name: params.name ? String(params.name) : undefined,
          equals: value,
        },
      ];
    }
    case "type_text":
    case "click":
    case "uia_invoke":
      return [{ kind: "screenshot_changed", minDiffRatio: 0.0005 }];
    default:
      return [];
  }
}
