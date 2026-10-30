/**
 * Regression: Vitest must never open the owner's real Sam-Harness SQLite DB.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  __resetPersistenceForTests,
  getPersistence,
  initPersistenceSync,
} from "../src/lib/db/index.js";
import { openSqlite } from "../src/lib/db/sqliteDriver.js";
import { VITEST_OUTPUT_HOME } from "./setup.js";

describe("test DB isolation", () => {
  it("pins SAM_OUTPUT_HOME under the OS temp tree (not Documents/Sam-Harness)", () => {
    const home = path.normalize(String(process.env.SAM_OUTPUT_HOME || "")).toLowerCase();
    const tmp = path.normalize(os.tmpdir()).toLowerCase();
    expect(home.startsWith(tmp)).toBe(true);
    expect(home).not.toMatch(/[/\\]documents[/\\]sam-harness$/i);
    expect(path.normalize(VITEST_OUTPUT_HOME).toLowerCase()).toBe(home);
  });

  it("getPersistence uses :memory: by default under Vitest setup", () => {
    __resetPersistenceForTests();
    process.env.SAM_DATABASE_PATH = ":memory:";
    const p = getPersistence();
    expect(p.dbPath).toBe(":memory:");
  });

  it("refuses owner data-dir SQLite paths under Vitest", () => {
    __resetPersistenceForTests();
    const fakeOwner = path.join(
      os.homedir(),
      "Documents",
      "Sam-Harness",
      "state",
      "sam-harness.sqlite"
    );
    process.env.SAM_DATABASE_PATH = fakeOwner;
    expect(() => initPersistenceSync({ skipImport: true, skipBackup: true })).toThrow(
      /Refusing to open owner data-dir|SAM_DATABASE_PATH must be set/i
    );
    process.env.SAM_DATABASE_PATH = ":memory:";
    __resetPersistenceForTests();
  });

  it("refuses missing SAM_DATABASE_PATH under Vitest (no silent user-dir fallback)", () => {
    __resetPersistenceForTests();
    delete process.env.SAM_DATABASE_PATH;
    process.env.SAM_TEST_ISOLATION = "1";
    expect(() => initPersistenceSync({ skipImport: true, skipBackup: true })).toThrow(
      /SAM_DATABASE_PATH must be set/i
    );
    process.env.SAM_DATABASE_PATH = ":memory:";
    __resetPersistenceForTests();
  });

  it("sqlite driver sets busy_timeout (survives parallel open)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-busy-"));
    const dbPath = path.join(dir, "t.sqlite");
    const a = openSqlite(dbPath);
    const b = openSqlite(dbPath);
    a.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY);");
    b.prepare("INSERT INTO t (id) VALUES (?)").run(1);
    const rows = a.prepare("SELECT id FROM t").all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    a.close();
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
