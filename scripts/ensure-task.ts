/**
 * Ensure root task.ts exists for typecheck / smoke imports.
 * Copies templates/task.seed.ts when missing (same as Tools\\01-setup-prereqs.bat).
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const taskTs = path.join(root, "task.ts");
const seed = path.join(root, "templates", "task.seed.ts");

if (!fs.existsSync(taskTs)) {
  if (!fs.existsSync(seed)) {
    console.error("ensure-task: missing templates/task.seed.ts");
    process.exit(1);
  }
  fs.copyFileSync(seed, taskTs);
  console.log("ensure-task: seeded task.ts from templates/task.seed.ts");
}
