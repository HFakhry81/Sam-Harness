/**
 * Isolate each test on an in-memory SQLite DB + fresh tenant singleton.
 */
import { beforeEach, afterEach } from "vitest";
import {
  __resetPersistenceForTests,
} from "../src/lib/db/index.js";
import { __resetCheckpointerForTests } from "../src/lib/db/checkpointer.js";
import { __resetMetricsForTests } from "../src/lib/observability/metrics.js";
import {
  DEFAULT_TENANT_ID,
  setActiveTenantId,
} from "../src/lib/tenant/context.js";

const PREV_DB = process.env.SAM_DATABASE_PATH;
const PREV_TENANT = process.env.SAM_TENANT_ID;

beforeEach(() => {
  __resetPersistenceForTests();
  __resetCheckpointerForTests();
  __resetMetricsForTests();
  process.env.SAM_DATABASE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
  setActiveTenantId(DEFAULT_TENANT_ID);
});

afterEach(() => {
  __resetPersistenceForTests();
  __resetCheckpointerForTests();
  if (PREV_DB === undefined) delete process.env.SAM_DATABASE_PATH;
  else process.env.SAM_DATABASE_PATH = PREV_DB;
  if (PREV_TENANT === undefined) delete process.env.SAM_TENANT_ID;
  else process.env.SAM_TENANT_ID = PREV_TENANT;
  setActiveTenantId(DEFAULT_TENANT_ID);
});
