/**
 * Offline smoke: intent-first desktop planner (move vs excel vs screenshot).
 */
import {
  detectOpsIntent,
  heuristicPlan,
} from "../src/agent/heuristic.js";

console.log("smoke-ops-planner");

const moveGoal =
  "انقل الملف Sam-Harness team test.xls من سطح المكتب الي المحرك D:";
if (detectOpsIntent(moveGoal) !== "move") {
  throw new Error(`expected move, got ${detectOpsIntent(moveGoal)}`);
}
const movePlan = heuristicPlan(`## Goal\n${moveGoal}`);
const moveTool = movePlan.find((d) => d.action === "tool");
if (!moveTool || moveTool.action !== "tool" || moveTool.tool !== "move_file") {
  throw new Error(`expected move_file plan, got ${JSON.stringify(movePlan)}`);
}
if (
  String(moveTool.params.source).toLowerCase() !==
    "desktop\\sam-harness team test.xls" ||
  String(moveTool.params.destination).toLowerCase() !==
    "d:\\sam-harness team test.xls"
) {
  throw new Error(`bad move paths: ${JSON.stringify(moveTool.params)}`);
}
console.log("  ✓ move Desktop → D:");

const excelGoal =
  "عاوز اعمل ملف Excel علي سطح المكتب بأسم Sam-Harness team test. واكتب فيه الوقت والتاريخ الحاليين في الخليه A1";
if (detectOpsIntent(excelGoal) !== "create_excel") {
  throw new Error(`expected create_excel, got ${detectOpsIntent(excelGoal)}`);
}
const excelPlan = heuristicPlan(`## Goal\n${excelGoal}`);
if (!excelPlan.some((d) => d.action === "tool" && d.tool === "write_excel")) {
  throw new Error("expected write_excel");
}
console.log("  ✓ create excel");

if (detectOpsIntent("--") !== "unknown") throw new Error("CLI noise should be unknown");
if (detectOpsIntent("التقط لقطة شاشة") !== "screenshot") {
  throw new Error("expected screenshot");
}
console.log("  ✓ screenshot + noise");

if (detectOpsIntent("اعمل مجلد باسم Reports على سطح المكتب") !== "mkdir") {
  throw new Error("expected mkdir");
}
const mkdirPlan = heuristicPlan("## Goal\nاعمل مجلد باسم Reports على سطح المكتب");
if (!mkdirPlan.some((d) => d.action === "tool" && d.tool === "mkdir")) {
  throw new Error("expected mkdir tool");
}
console.log("  ✓ mkdir");

if (detectOpsIntent("احذف الملف old.txt من سطح المكتب") !== "delete") {
  throw new Error("expected delete");
}
const delPlan = heuristicPlan("## Goal\nاحذف الملف old.txt من سطح المكتب");
const del = delPlan.find((d) => d.action === "tool");
if (!del || del.action !== "tool" || del.tool !== "delete_path" || del.params.confirm !== true) {
  throw new Error("delete must use delete_path with confirm:true");
}
console.log("  ✓ delete with confirm");

console.log("PASS");
