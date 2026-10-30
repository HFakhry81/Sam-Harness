import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  addDailyJob,
  computeNextRunAt,
  cronMatches,
  isJobDue,
  loadDailyOps,
  normalizeSchedule,
  recordDailyResult,
  startDailyOpsScheduler,
  toggleDailyJob,
} from "../src/controlplane/dailyOps.js";

describe("Daily Ops scheduler", () => {
  let dir: string;
  let home: string;
  const prevHome = process.env.SAM_OUTPUT_HOME;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-ops-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "sam-ops-home-"));
    process.env.SAM_OUTPUT_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prevHome;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("normalizes UI aliases to cron", () => {
    expect(normalizeSchedule("daily-09")).toBe("0 9 * * *");
    expect(normalizeSchedule("weekdays-09")).toBe("0 9 * * 1-5");
    expect(normalizeSchedule("14:30")).toBe("30 14 * * *");
    expect(normalizeSchedule("manual")).toBe("manual");
  });

  it("cronMatches hour/minute and weekdays", () => {
    const mon9 = new Date(2026, 9, 5, 9, 0, 0); // Monday Oct 5 2026
    expect(cronMatches("0 9 * * *", mon9)).toBe(true);
    expect(cronMatches("0 9 * * 1-5", mon9)).toBe(true);
    const sun9 = new Date(2026, 9, 4, 9, 0, 0); // Sunday
    expect(cronMatches("0 9 * * 1-5", sun9)).toBe(false);
    expect(cronMatches("0 10 * * *", mon9)).toBe(false);
  });

  it("persists jobs across reload and computes nextRunAt", () => {
    const job = addDailyJob(dir, {
      title: "Archive desk",
      schedule: "daily-09",
      prompt: "archive",
    });
    expect(job.enabled).toBe(true);
    expect(job.schedule).toBe("0 9 * * *");
    expect(job.nextRunAt).toBeTruthy();
    const reloaded = loadDailyOps(dir);
    expect(reloaded.jobs[0]?.id).toBe(job.id);
    const next = computeNextRunAt("0 9 * * *", new Date("2026-10-30T08:00:00Z"));
    expect(next).toBeTruthy();
  });

  it("isJobDue respects enabled + nextRunAt + same-minute guard", () => {
    const job = addDailyJob(dir, { title: "t", schedule: "manual" });
    expect(isJobDue(job)).toBe(false);

    const dueJob = {
      ...job,
      schedule: "0 9 * * *",
      enabled: true,
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    };
    expect(isJobDue(dueJob)).toBe(true);

    const sameMin = {
      ...dueJob,
      lastRunAt: new Date().toISOString(),
    };
    expect(isJobDue(sameMin)).toBe(false);
  });

  it("scheduler tick fires due jobs and writes run history under output home", async () => {
    const job = addDailyJob(dir, { title: "tick-me", schedule: "manual" });
    // Force due via nextRunAt (DB-backed store — no cwd JSON file)
    const { saveStoreDoc } = await import("../src/lib/db/storeBridge.js");
    const store = loadDailyOps(dir);
    store.jobs[0].schedule = "0 0 * * *";
    store.jobs[0].nextRunAt = new Date(Date.now() - 1000).toISOString();
    saveStoreDoc(dir, "daily-ops", store);

    let ran = 0;
    const handle = startDailyOpsScheduler({
      cwd: dir,
      intervalMs: 60_000,
      onRun: async () => {
        ran += 1;
        return { success: true, summary: "ok-from-test" };
      },
    });
    const fired = await handle.tickNow();
    handle.stop();
    expect(fired).toContain(job.id);
    expect(ran).toBe(1);
    const after = loadDailyOps(dir);
    expect(after.ledger[0]?.summary).toMatch(/ok-from-test/);
    expect(after.ledger[0]?.runDir).toBeTruthy();
    expect(fs.existsSync(after.ledger[0]!.runDir!)).toBe(true);
  });

  it("toggle disable prevents due runs", () => {
    const job = addDailyJob(dir, { title: "x", schedule: "0 9 * * *" });
    toggleDailyJob(dir, job.id);
    const disabled = loadDailyOps(dir).jobs[0]!;
    expect(disabled.enabled).toBe(false);
    expect(
      isJobDue({
        ...disabled,
        nextRunAt: new Date(Date.now() - 1000).toISOString(),
      })
    ).toBe(false);
  });

  it("recordDailyResult mirrors under runs/daily-ops", () => {
    const job = addDailyJob(dir, { title: "r", schedule: "manual" });
    const entry = recordDailyResult(dir, {
      taskId: job.id,
      prompt: "p",
      success: true,
      summary: "done",
    });
    expect(entry.runDir).toBeTruthy();
    expect(
      fs.existsSync(path.join(entry.runDir!, "result.json"))
    ).toBe(true);
  });
});
