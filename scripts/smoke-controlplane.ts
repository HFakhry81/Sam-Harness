/**
 * Offline smoke for Control Plane task writer (no server / no LLM).
 */
import * as fs from "fs";
import * as path from "path";
import {
  buildTaskDraft,
  detectRoute,
  renderTaskTs,
  writeTaskFiles,
} from "../src/controlplane/taskWriter.js";

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

const tmp = path.join(process.cwd(), ".smoke-cp-tmp");
fs.mkdirSync(tmp, { recursive: true });
writeTaskFiles(tmp, draft);
if (
  !fs.existsSync(path.join(tmp, "task.ts")) ||
  !fs.existsSync(path.join(tmp, "task.md")) ||
  !fs.existsSync(path.join(tmp, "task.spec.json"))
) {
  throw new Error("writeTaskFiles failed (need task.ts/md/spec.json)");
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log("PASS");
