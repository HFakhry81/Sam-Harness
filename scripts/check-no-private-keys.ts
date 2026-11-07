#!/usr/bin/env tsx
/**
 * Fail CI/local checks when a git-tracked file contains PEM private-key armor.
 * English-only ASCII console output. Never prints key material — paths only.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanGitTrackedForPemPrivateKeys } from "../src/lib/security/trackedSecrets.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = scanGitTrackedForPemPrivateKeys(root);

if (!result.ok) {
  console.error(
    `[secrets] FAIL: ${result.hits.length} tracked file(s) contain PEM private key armor.`
  );
  for (const hit of result.hits) {
    console.error(`[secrets]   ${hit.path} (${hit.kind})`);
  }
  console.error(
    "[secrets] Remove the file from the index, add it to .gitignore, and generate local certs with:"
  );
  console.error("[secrets]   pnpm run certs:generate");
  process.exit(1);
}

console.log(
  `[secrets] OK: scanned ${result.scanned} tracked text file(s); no PEM private keys.`
);
process.exit(0);
