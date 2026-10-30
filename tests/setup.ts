/**
 * Isolate every Vitest worker from the owner's real SAM_OUTPUT_HOME / SQLite DB.
 *
 * Runs at module load (before test file imports / dotenv side-effects with
 * override:false), then re-asserts isolation in beforeEach so individual tests
 * that delete env vars cannot fall back to Documents/Sam-Harness.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, beforeEach } from "vitest";
import {
  __resetPersistenceForTests,
} from "../src/lib/db/index.js";
import { __resetCheckpointerForTests } from "../src/lib/db/checkpointer.js";
import { __resetMetricsForTests } from "../src/lib/observability/metrics.js";
import {
  DEFAULT_TENANT_ID,
  setActiveTenantId,
} from "../src/lib/tenant/context.js";

const workerId =
  process.env.VITEST_WORKER_ID ||
  process.env.VITEST_POOL_ID ||
  String(process.pid);

/** Stable per-worker tree — never the owner's Documents/Sam-Harness. */
export const VITEST_ISOLATION_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), `sam-harness-vitest-w${workerId}-`)
);
export const VITEST_OUTPUT_HOME = path.join(VITEST_ISOLATION_ROOT, "output");
export const VITEST_DATABASE_PATH = path.join(
  VITEST_ISOLATION_ROOT,
  "state",
  "sam-harness.sqlite"
);

fs.mkdirSync(VITEST_OUTPUT_HOME, { recursive: true });
fs.mkdirSync(path.dirname(VITEST_DATABASE_PATH), { recursive: true });

/** Marker consumed by resolveSqlitePath / child-process helpers. */
process.env.SAM_TEST_ISOLATION = "1";
process.env.SAM_OUTPUT_HOME = VITEST_OUTPUT_HOME;
process.env.SAM_DATABASE_PATH = ":memory:";
delete process.env.DATABASE_URL;

function pinTestIsolation(opts?: { databasePath?: string }): void {
  process.env.SAM_TEST_ISOLATION = "1";
  process.env.SAM_OUTPUT_HOME = VITEST_OUTPUT_HOME;
  process.env.SAM_DATABASE_PATH = opts?.databasePath || ":memory:";
  delete process.env.DATABASE_URL;
}

beforeEach(() => {
  pinTestIsolation();
  __resetPersistenceForTests();
  __resetCheckpointerForTests();
  __resetMetricsForTests();
  setActiveTenantId(DEFAULT_TENANT_ID);
});

afterEach(() => {
  __resetPersistenceForTests();
  __resetCheckpointerForTests();
  // Never restore the owner's real DB / output home — re-pin isolation.
  pinTestIsolation();
  setActiveTenantId(DEFAULT_TENANT_ID);
});

afterAll(() => {
  __resetPersistenceForTests();
  try {
    fs.rmSync(VITEST_ISOLATION_ROOT, { recursive: true, force: true });
  } catch {
    /* Windows may briefly hold handles */
  }
});
