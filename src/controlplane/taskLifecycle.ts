/**
 * Task lifecycle after runs:
 * - SUCCESS → archive copy, clear active task (no accidental re-run)
 * - FAILURE → keep active task for retry with a better plan
 * - Re-running the last SUCCESS fingerprint is rejected
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { extractGoalFocus } from "../agent/heuristic.js";
import { buildTaskDraft, renderTaskTs, type TaskDraft } from "./taskWriter.js";
import { writeTaskSpecFiles } from "./taskSpec.js";

export type TaskFingerprintState = {
  lastSuccessHash: string | null;
  lastSuccessAt: string | null;
  lastSuccessTitle: string | null;
  lastFailureHash: string | null;
  lastFailureAt: string | null;
};

const STATE_FILE = "task-lifecycle.json";

export function goalFingerprint(goalOrTask: string): string {
  const goal = extractGoalFocus(goalOrTask).trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(goal).digest("hex").slice(0, 24);
}

export function loadLifecycle(cwd: string): TaskFingerprintState {
  const p = path.join(cwd, STATE_FILE);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    /* ignore */
  }
  return {
    lastSuccessHash: null,
    lastSuccessAt: null,
    lastSuccessTitle: null,
    lastFailureHash: null,
    lastFailureAt: null,
  };
}

function saveLifecycle(cwd: string, state: TaskFingerprintState): void {
  fs.writeFileSync(path.join(cwd, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
}

export function assertNotRepeatSuccess(
  cwd: string,
  taskBody: string
): { ok: true } | { ok: false; error: string } {
  const state = loadLifecycle(cwd);
  const hash = goalFingerprint(taskBody);
  if (state.lastSuccessHash && state.lastSuccessHash === hash) {
    return {
      ok: false,
      error:
        "هذه المهمة نُفِّذت بنجاح مسبقاً. تكرار التنفيذ الناجح مرفوض. اكتب مهمة جديدة أو عدّل الهدف. " +
        `(success @ ${state.lastSuccessAt})`,
    };
  }
  return { ok: true };
}

function pendingDraft(): TaskDraft {
  // Synthetic idle draft via Spec engine (forced ready for clear)
  const draft = buildTaskDraft({
    prompt: "لا توجد مهمة قيد التنفيذ. اكتب مهمة جديدة من Control Plane.",
    title: "(لا توجد مهمة نشطة)",
    route: "operational",
    targetRepo: process.cwd(),
    id: "pending-idle",
  });
  draft.id = "pending-idle";
  draft.title = "(لا توجد مهمة نشطة)";
  draft.ready = true;
  draft.needsClarification = [];
  draft.body = `# Sam-Harness Task — IDLE

## Route
operational

## Title
(لا توجد مهمة نشطة)

## Goal
لا توجد مهمة قيد التنفيذ. اكتب مهمة جديدة من Control Plane.

## Status
CLEARED_AFTER_SUCCESS

## Success criteria
- [pack_created] idle
`.trim();
  draft.spec = {
    ...draft.spec,
    id: "pending-idle",
    title: draft.title,
    goal: "لا توجد مهمة قيد التنفيذ. اكتب مهمة جديدة من Control Plane.",
    intent: "unknown",
    confidence: 1,
    needsClarification: [],
    successCriteria: [],
    workspaceMode: "operator",
    roots: [],
    planSteps: [],
  };
  return draft;
}

export function archiveAndClearOnSuccess(
  cwd: string,
  opts: { title: string; body: string; summary: string }
): { archived: string; cleared: true } {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(cwd, "task-archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  const archived = path.join(archiveDir, `success-${stamp}.md`);
  fs.writeFileSync(
    archived,
    `# Archived successful task\n\n## Title\n${opts.title}\n\n## Summary\n${opts.summary}\n\n## Body\n\n${opts.body}\n`,
    "utf-8"
  );

  const draft = pendingDraft();
  writeTaskSpecFiles(cwd, draft.spec);
  fs.writeFileSync(path.join(cwd, "task.ts"), renderTaskTs(draft), "utf-8");
  fs.writeFileSync(path.join(cwd, "task.md"), draft.body + "\n", "utf-8");
  for (const f of ["task.draft.json", "task.pending.md"]) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const state = loadLifecycle(cwd);
  state.lastSuccessHash = goalFingerprint(opts.body);
  state.lastSuccessAt = new Date().toISOString();
  state.lastSuccessTitle = opts.title;
  saveLifecycle(cwd, state);

  return { archived, cleared: true };
}

export function retainOnFailure(
  cwd: string,
  opts: { title: string; body: string; reason: string }
): void {
  const state = loadLifecycle(cwd);
  state.lastFailureHash = goalFingerprint(opts.body);
  state.lastFailureAt = new Date().toISOString();
  saveLifecycle(cwd, state);
  // Keep task.ts / task.md as-is for retry
  fs.writeFileSync(
    path.join(cwd, "task-last-failure.md"),
    `# Failed task retained for retry\n\n## Title\n${opts.title}\n\n## Reason\n${opts.reason}\n\n## Body\n\n${opts.body}\n`,
    "utf-8"
  );
}

export function buildRunReport(input: {
  success: boolean;
  title: string;
  route: string;
  mode: string;
  summary: string;
  artifacts: string[];
  tools?: string[];
  taskLifecycle: "cleared" | "retained" | "unchanged";
  blockedRepeat?: boolean;
  auditPassed?: boolean | null;
  goalPassed?: boolean | null;
  goalFidelityScore?: number | null;
}): {
  headline: string;
  bullets: string[];
  nextSteps: string[];
  tone: "ok" | "fail";
} {
  const qualityBits: string[] = [];
  if (input.auditPassed != null) {
    qualityBits.push(`auditPassed=${input.auditPassed ? "true" : "false"}`);
  }
  if (input.goalPassed != null) {
    qualityBits.push(`goalPassed=${input.goalPassed ? "true" : "false"}`);
  }
  if (input.goalFidelityScore != null && !Number.isNaN(input.goalFidelityScore)) {
    qualityBits.push(`goalScore=${Number(input.goalFidelityScore).toFixed(2)}`);
  }
  const qualityLine = qualityBits.length ? `الجودة: ${qualityBits.join(" · ")}` : "";

  if (input.success) {
    return {
      tone: "ok",
      headline: "اكتملت المهمة بنجاح",
      bullets: [
        `العنوان: ${input.title}`,
        `المسار: ${input.route} · الوضع: ${input.mode}`,
        ...(qualityLine ? [qualityLine] : []),
        input.summary.slice(0, 500),
        input.artifacts.length ? `مخرجات: ${input.artifacts.join(", ")}` : "لا ملفات مخرجات إضافية",
        input.taskLifecycle === "cleared"
          ? "تم إفراغ المهمة النشطة (لن تُعاد بالخطأ)"
          : "دورة المهمة: بدون تغيير",
      ],
      nextSteps: [
        "اضغط «مهمة جديدة» لكتابة الطلب التالي",
        "تكرار نفس المهمة الناجحة مرفوض حتى يتغير الهدف",
      ],
    };
  }
  return {
    tone: "fail",
    headline:
      input.goalPassed === false
        ? "فشل مطابقة الهدف (goalPassed=false) — المهمة محفوظة"
        : "فشل التنفيذ — المهمة محفوظة لإعادة المحاولة",
    bullets: [
      `العنوان: ${input.title}`,
      `المسار: ${input.route} · الوضع: ${input.mode}`,
      ...(qualityLine ? [qualityLine] : []),
      input.summary.slice(0, 500),
      "task.ts ما زال يحتوي الهدف الفاشل",
    ],
    nextSteps: [
      "راجع السبب في التقرير/السجل",
      "عدّل الخطة أو المسارات ثم أعد التشغيل (تكرار الفشل مسموح)",
      "بعد النجاح سيتم إفراغ المهمة تلقائياً",
    ],
  };
}
