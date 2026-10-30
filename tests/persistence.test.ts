import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  __resetPersistenceForTests,
  getPersistence,
  initPersistenceSync,
  loadDoc,
  saveDoc,
} from "../src/lib/db/index.js";
import { importJsonState } from "../src/lib/db/importJson.js";
import { backupSqlite } from "../src/lib/db/backup.js";
import { addDailyJob, loadDailyOps } from "../src/controlplane/dailyOps.js";
import { upsertMemory, loadMemory } from "../src/controlplane/projectMemory.js";
import { saveHybridProfile, loadHybridProfile } from "../src/controlplane/hybridProfile.js";
import {
  setActiveTenantId,
  tenantOutputHome,
  DEFAULT_TENANT_ID,
} from "../src/lib/tenant/context.js";
import {
  startDurableRun,
  checkpointRun,
  resumeDurableRun,
  cancelDurableRun,
  getRunTimeline,
  runStepWithRetry,
} from "../src/lib/durableRuns.js";
import { SamSqliteSaver } from "../src/lib/db/checkpointer.js";
import { getDriver } from "../src/lib/db/index.js";

describe("Phase 3 persistence", () => {
  beforeEach(() => {
    process.env.SAM_DATABASE_PATH = ":memory:";
    __resetPersistenceForTests();
    setActiveTenantId(DEFAULT_TENANT_ID);
    initPersistenceSync({ skipImport: true, skipBackup: true });
  });

  it("stores documents in SQLite behind the repository layer", () => {
    saveDoc("project-memory", { entries: [{ key: "a", value: "1", updatedAt: "t" }] });
    const doc = loadDoc<{ entries: Array<{ key: string }> }>("project-memory");
    expect(doc?.entries?.[0]?.key).toBe("a");
  });

  it("imports legacy JSON once into the DB", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-import-"));
    fs.writeFileSync(
      path.join(dir, "daily-ops.json"),
      JSON.stringify({
        jobs: [
          {
            id: "j1",
            title: "t",
            prompt: "p",
            schedule: "manual",
            enabled: true,
            createdAt: new Date().toISOString(),
          },
        ],
        ledger: [],
      }),
      "utf-8"
    );
    const result = importJsonState(getDriver(), DEFAULT_TENANT_ID, dir);
    expect(result.imported).toContain("daily-ops.json");
    const again = importJsonState(getDriver(), DEFAULT_TENANT_ID, dir);
    expect(again.imported).not.toContain("daily-ops.json");
    const store = loadDailyOps(dir);
    expect(store.jobs.some((j) => j.id === "j1")).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("backs up a file-backed sqlite database", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-bak-"));
    const dbPath = path.join(dir, "app.sqlite");
    __resetPersistenceForTests();
    process.env.SAM_DATABASE_PATH = dbPath;
    const pers = initPersistenceSync({ skipImport: true, skipBackup: true });
    saveDoc("hybrid-profile", { mode: "local", costCapUsd: 0.5 });
    const backupDir = path.join(dir, "backups");
    const result = backupSqlite(pers.driver, { backupDir, label: "test", keep: 3 });
    expect(result.ok).toBe(true);
    expect(result.path && fs.existsSync(result.path)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    process.env.SAM_DATABASE_PATH = ":memory:";
  });
});

describe("multi-tenancy groundwork", () => {
  beforeEach(() => {
    process.env.SAM_DATABASE_PATH = ":memory:";
    __resetPersistenceForTests();
    initPersistenceSync({ skipImport: true, skipBackup: true });
  });

  it("isolates memory and cost caps per tenant", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sam-tenant-"));
    setActiveTenantId("client-a");
    upsertMemory(cwd, "secret", "alpha-only");
    saveHybridProfile(cwd, { costCapUsd: 1.25 });

    setActiveTenantId("client-b");
    upsertMemory(cwd, "secret", "beta-only");
    saveHybridProfile(cwd, { costCapUsd: 0 });

    setActiveTenantId("client-a");
    expect(loadMemory(cwd).entries.find((e) => e.key === "secret")?.value).toBe("alpha-only");
    expect(loadHybridProfile(cwd).costCapUsd).toBe(1.25);

    setActiveTenantId("client-b");
    expect(loadMemory(cwd).entries.find((e) => e.key === "secret")?.value).toBe("beta-only");
    expect(loadHybridProfile(cwd).costCapUsd).toBe(0);

    expect(tenantOutputHome("client-a")).toMatch(/workspaces[/\\]client-a/);
    expect(tenantOutputHome(DEFAULT_TENANT_ID)).not.toMatch(/workspaces/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("durable runs + checkpointer", () => {
  beforeEach(() => {
    process.env.SAM_DATABASE_PATH = ":memory:";
    __resetPersistenceForTests();
    initPersistenceSync({ skipImport: true, skipBackup: true });
  });

  it("checkpoints, resumes, and cancels runs with timeline events", async () => {
    const run = startDurableRun({ mode: "agency", idempotencyKey: "idem-1" });
    const again = startDurableRun({ mode: "agency", idempotencyKey: "idem-1" });
    expect(again.id).toBe(run.id);

    checkpointRun(run.id, "strategize");
    const resumed = resumeDurableRun(run.id);
    expect(resumed?.attempt).toBe(1);
    expect(resumed?.status).toBe("running");

    await runStepWithRetry(run.id, "audit", async () => "ok", { attempts: 2 });
    cancelDurableRun(run.id);
    const events = getRunTimeline(run.id);
    expect(events.some((e) => e.kind === "checkpoint")).toBe(true);
    expect(events.some((e) => e.name === "cancel")).toBe(true);
  });

  it("persists LangGraph checkpoints and resumes thread state", async () => {
    const saver = SamSqliteSaver.fromDriver(getDriver());
    const thread_id = "thread-test-1";
    const checkpoint = {
      v: 1,
      id: "cp-1",
      ts: new Date().toISOString(),
      channel_values: { loop: 2, strategy: "draft" },
      channel_versions: { loop: 1 },
      versions_seen: {},
    };
    await saver.put(
      { configurable: { thread_id, checkpoint_ns: "" } },
      checkpoint as never,
      { source: "update", step: 1, parents: {} } as never
    );
    const tuple = await saver.getTuple({ configurable: { thread_id } });
    expect(tuple?.checkpoint?.id).toBe("cp-1");
    expect((tuple?.checkpoint?.channel_values as { loop?: number })?.loop).toBe(2);

    // Simulate crash: new saver instance on same DB
    const saver2 = SamSqliteSaver.fromDriver(getDriver());
    const resumed = await saver2.getTuple({ configurable: { thread_id } });
    expect(resumed?.checkpoint?.id).toBe("cp-1");
  });
});

describe("persistence hub", () => {
  it("exposes getPersistence after sync init", () => {
    process.env.SAM_DATABASE_PATH = ":memory:";
    __resetPersistenceForTests();
    const p = initPersistenceSync({ skipImport: true, skipBackup: true });
    expect(getPersistence().dbPath).toBe(p.dbPath);
    expect(p.driver.kind).toBe("sqlite");
  });
});
