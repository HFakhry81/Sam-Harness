/**
 * Smoke: isolated Node sandbox runs code, times out, strips secrets.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runNodeSandbox } from "../src/tools/sandbox.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "sam-smoke-sbx-"));
process.env.SAM_OUTPUT_HOME = home;
process.env.GEMINI_API_KEY = "should-not-leak";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`OK  ${name}${detail ? " — " + detail : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

try {
  const okRun = await runNodeSandbox({
    code: "console.log('fixed=' + (1+1));",
    timeoutMs: 10_000,
  });
  check("runs code", okRun.ok && /fixed=2/.test(okRun.stdout), okRun.stdout);

  const leak = await runNodeSandbox({
    code: "console.log('KEY=' + (process.env.GEMINI_API_KEY || ''));",
    timeoutMs: 10_000,
  });
  check("no secret leak", leak.ok && !/should-not-leak/.test(leak.stdout), leak.stdout);

  const boom = await runNodeSandbox({
    code: "throw new Error('boom');",
    timeoutMs: 10_000,
  });
  check("captures failure", !boom.ok);

  // Self-heal style: failed script → corrected script
  const bad = await runNodeSandbox({
    code: "console.log(sum);",
    timeoutMs: 5_000,
  });
  check("detects bad script", !bad.ok);
  const fixed = await runNodeSandbox({
    code: "const sum = 1+1; console.log('sum='+sum);",
    timeoutMs: 5_000,
  });
  check("self-heal rewrite passes", fixed.ok && /sum=2/.test(fixed.stdout));
} finally {
  delete process.env.GEMINI_API_KEY;
  fs.rmSync(home, { recursive: true, force: true });
}

if (failed) {
  console.error(`smoke:sandbox FAILED (${failed})`);
  process.exitCode = 1;
} else {
  console.log("smoke:sandbox PASS");
}
