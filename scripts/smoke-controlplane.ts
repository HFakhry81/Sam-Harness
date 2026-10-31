/**
 * Offline smoke for Control Plane task writer (no server / no LLM).
 * Runtime task files land under SAM_OUTPUT_HOME/tasks/ (never repo cwd).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildTaskDraft,
  detectRoute,
  renderTaskTs,
  writeTaskFiles,
} from "../src/controlplane/taskWriter.js";
import { getTaskDir } from "../src/lib/taskPaths.js";
import { __resetActiveRunDirForTests } from "../src/lib/outputHome.js";

console.log("smoke-controlplane");

if (detectRoute("افتح مجلد سطح المكتب") !== "operational") {
  throw new Error("expected operational");
}
if (
  detectRoute(
    "عاوز اعمل ملف Excel علي سطح المكتب بأسم Sam-Harness team test"
  ) !== "operational"
) {
  throw new Error("expected excel -> operational");
}
const ops = buildTaskDraft({
  prompt: "اعمل ملف Excel على سطح المكتب",
  route: "auto",
});
if (ops.route !== "operational") {
  throw new Error("expected operational route");
}
if (/LangGraph review|Required outputs|CODE_VS_PLAN_GAP_MATRIX|marketing-campaign/i.test(ops.body)) {
  throw new Error("operational body must not include architecture pack mission");
}
if (!/Desktop Operator/i.test(ops.body)) {
  throw new Error("operational body should name Desktop Operator");
}
if (detectRoute("حلّل Maw3ed وأخرج تقرير") !== "architecture") {
  throw new Error("expected architecture");
}
if (detectRoute("نفّذ التذاكر على الكود", "auto") !== "implement") {
  throw new Error("expected implement");
}

const draft = buildTaskDraft({
  prompt: "حلّل مشروع تجريبي وأخرج حزمة تقارير بدون تعديل كود",
  targetRepo: "E:\\UpNexa.com\\maw3ed",
  route: "architecture",
});
const ts = renderTaskTs(draft);
if (!ts.includes("export const taskConfig") || !ts.includes("architecture")) {
  throw new Error("renderTaskTs missing pieces");
}

const prevHome = process.env.SAM_OUTPUT_HOME;
const outHome = fs.mkdtempSync(path.join(os.tmpdir(), "sh-smoke-cp-"));
process.env.SAM_OUTPUT_HOME = outHome;
__resetActiveRunDirForTests();
try {
  // cwd arg is ignored for writes — files go to SAM_OUTPUT_HOME/tasks/
  writeTaskFiles(process.cwd(), draft);
  const taskDir = getTaskDir();
  if (
    !fs.existsSync(path.join(taskDir, "task.ts")) ||
    !fs.existsSync(path.join(taskDir, "task.md")) ||
    !fs.existsSync(path.join(taskDir, "task.spec.json"))
  ) {
    throw new Error("writeTaskFiles failed (need task.ts/md/spec.json under SAM_OUTPUT_HOME/tasks)");
  }
  // Must not pollute the Sam-Harness repo root
  for (const name of ["task.md", "task.spec.json", "task.draft.json", "task.pending.md"]) {
    if (fs.existsSync(path.join(process.cwd(), name))) {
      throw new Error(`writeTaskFiles leaked ${name} into repo cwd`);
    }
  }
  if (!taskDir.toLowerCase().startsWith(path.normalize(outHome).toLowerCase())) {
    throw new Error(`task dir not under output home: ${taskDir}`);
  }
} finally {
  if (prevHome === undefined) delete process.env.SAM_OUTPUT_HOME;
  else process.env.SAM_OUTPUT_HOME = prevHome;
  __resetActiveRunDirForTests();
  fs.rmSync(outHome, { recursive: true, force: true });
}

console.log("PASS");
