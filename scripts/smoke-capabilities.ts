/**
 * Offline smoke: role capability matrix + safeExecute deny path.
 */
import "../src/lib/loadEnv.js";
import {
  assertToolAllowed,
  capabilitiesFor,
  renderCapabilitiesMarkdown,
} from "../src/agency/capabilities.js";
import { executeToolAsRole } from "../src/agency/safeExecute.js";
import * as fs from "fs";

console.log("smoke-capabilities");

const evidence = capabilitiesFor("evidence");
if (evidence.tools.includes("write_file")) {
  throw new Error("evidence must not have write_file");
}
console.log("evidence tier:", evidence.tier);

try {
  assertToolAllowed("auditor", "run_shell");
  throw new Error("auditor should not get run_shell");
} catch (e: any) {
  if (!String(e.message).includes("cannot use tool")) throw e;
  console.log("deny auditor/run_shell: OK");
}

assertToolAllowed("operator", "screenshot");
assertToolAllowed("implementer", "write_file");
console.log("allow operator/screenshot + implementer/write_file: OK");

const denied = await executeToolAsRole("strategist", "run_shell", {
  command: "dir",
});
if (denied.ok || !(denied.data as any)?.denied) {
  throw new Error("strategist run_shell should be denied by safeExecute");
}
console.log("safeExecute deny:", denied.message);

const md = renderCapabilitiesMarkdown();
fs.writeFileSync("capabilities.smoke.md", md, "utf-8");
console.log("wrote capabilities.smoke.md");
console.log("PASS");
