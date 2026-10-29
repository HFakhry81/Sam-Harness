/**
 * Offline smoke: evidence scout + LangGraph module load (no LLM calls).
 */
import "../src/lib/loadEnv.js";
import * as fs from "fs";
import { scanRepoEvidence } from "../src/agency/evidence.js";
import { AGENCY_ROLES } from "../src/agency/roles.js";
import { taskConfig } from "../task.js";

console.log("smoke-agency");
console.log("roles:", AGENCY_ROLES.length);
const pack = scanRepoEvidence(taskConfig.targetRepo);
fs.writeFileSync("evidence-pack.smoke.md", pack.summaryMarkdown, "utf-8");
console.log("evidence hits:", pack.hits.length);
console.log("target:", taskConfig.targetRepo);
if (pack.hits.length < 1 && fs.existsSync(taskConfig.targetRepo)) {
  console.warn("WARN: repo exists but 0 evidence hits — tune scanners");
}
// Dynamic import graph builder without invoke
await import("../src/agency/reviewGraph.js");
console.log("reviewGraph module OK");
console.log("PASS");
