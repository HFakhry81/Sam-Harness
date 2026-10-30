#!/usr/bin/env tsx
/**
 * `pnpm run migrate` — open persistence and apply pending DB migrations.
 * Safe to re-run (idempotent). Uses SAM_OUTPUT_HOME / DATABASE_URL like the app.
 */
import { initPersistence } from "../src/lib/db/index.js";

const json = process.argv.includes("--json");

async function main(): Promise<void> {
  const p = await initPersistence({ skipBackup: true });
  const payload = {
    ok: true,
    tenantId: p.tenantId,
    dbPath: p.dbPath,
    backend: p.postgres ? "postgres+sqlite-cache" : p.driver.kind,
  };
  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(
      `[OK] migrations applied · tenant=${payload.tenantId} · ${payload.backend} · ${payload.dbPath}\n`
    );
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[FAIL] migrate: ${msg}`);
  process.exit(1);
});
