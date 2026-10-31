/**
 * Rebuild task.ts / task.spec.json / draft from the prompt already on disk
 * under SAM_OUTPUT_HOME/tasks/ (falls back to legacy repo-root copies).
 * Does not execute tools.
 */
import * as fs from "fs";
import {
  buildTaskDraft,
  persistComposeDraft,
  writeTaskFiles,
} from "../src/controlplane/taskWriter.js";
import { getTaskDir, resolveTaskReadPath } from "../src/lib/taskPaths.js";

const root = process.cwd();
const specPath = resolveTaskReadPath("task.spec.json", root);
const draftPath = resolveTaskReadPath("task.draft.json", root);

let prompt = "";
let answers: Record<string, string> = {};

if (draftPath && fs.existsSync(draftPath)) {
  const d = JSON.parse(fs.readFileSync(draftPath, "utf-8"));
  prompt = d.prompt || d.spec?.rawPrompt || "";
}
if (!prompt && specPath && fs.existsSync(specPath)) {
  const s = JSON.parse(fs.readFileSync(specPath, "utf-8"));
  prompt = s.rawPrompt || s.goal || "";
}
if (!prompt.trim()) {
  console.error(
    `No prompt found in task.draft.json / task.spec.json (checked ${getTaskDir()} and repo root)`
  );
  process.exit(1);
}

// Auto-confirm multi-step + delete when restoring a known compound ops task
if (/امسح|احذف|حذف/i.test(prompt) && /مجلد/i.test(prompt)) {
  answers = {
    "طلبك فيه خطوتان (حذف ملف + إنشاء مجلد). اكتب نعم للتنفيذ بالترتيب": "نعم",
    "تأكيد الحذف النهائي؟ اكتب نعم للحذف (destructive — لا سلة محذوفات مضمونة)":
      "نعم",
  };
}

const draft = buildTaskDraft({ prompt, answers, route: "auto" });
persistComposeDraft(root, draft, prompt);
console.log(
  JSON.stringify(
    {
      ready: draft.ready,
      confidence: draft.confidence,
      intent: draft.spec.intent,
      planSteps: draft.spec.planSteps,
      destinations: draft.spec.entities.destinations,
      clarify: draft.needsClarification,
      taskDir: getTaskDir(),
    },
    null,
    2
  )
);
if (draft.ready) {
  writeTaskFiles(root, draft);
  console.log("restored ready task files under SAM_OUTPUT_HOME/tasks");
} else {
  console.log("draft persisted — needs clarification in UI");
}
