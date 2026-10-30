#!/usr/bin/env tsx
/**
 * Export Help packs: HTML + PDF-ready HTML + Markdown bundle per language.
 * Targets: SAM_OUTPUT_HOME/documents/help/{locale} and dist/help/{locale}
 */
import "../src/lib/loadEnv.js";
import { exportAllHelp, verifyHelpIntegrity } from "../src/lib/help/index.js";
import { ensureOutputHome, getOutputHome } from "../src/lib/outputHome.js";

function main(): void {
  const cwd = process.cwd();
  const integrity = verifyHelpIntegrity(cwd);
  if (!integrity.ok) {
    console.error("Refusing export — help integrity failed:");
    for (const issue of integrity.issues) {
      console.error(`  [${issue.locale}] ${issue.id || "—"}: ${issue.problem}`);
    }
    process.exitCode = 1;
    return;
  }

  ensureOutputHome(getOutputHome());
  const results = exportAllHelp({ cwd });
  for (const r of results) {
    console.log(
      `Help export [${r.locale}] → documents: ${r.documentsDir}\n` +
        `                 dist: ${r.distDir}\n` +
        `                 files: ${r.files.join(", ")}`
    );
  }
  console.log("Done.");
}

main();
