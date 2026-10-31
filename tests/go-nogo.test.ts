import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveImplementAuthorization } from "../src/agency/delivery/goNoGo.js";
import {
  __setPackWriteRootForTests,
  packArtifactPath,
} from "../src/lib/packWorkspace.js";

const originalCwd = process.cwd();
let tmp: string;
const prevImplementGo = process.env.IMPLEMENT_GO;

function wipeEnvGo() {
  delete process.env.IMPLEMENT_GO;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sam-gng-"));
  process.chdir(tmp);
  __setPackWriteRootForTests(tmp);
  wipeEnvGo();
});

afterEach(() => {
  __setPackWriteRootForTests(null);
  process.chdir(originalCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (prevImplementGo === undefined) delete process.env.IMPLEMENT_GO;
  else process.env.IMPLEMENT_GO = prevImplementGo;
});

describe("Go/No-Go gate", () => {
  it("blocks implementation when no authorization is present", () => {
    const r = resolveImplementAuthorization([]);
    expect(r.allowed).toBe(false);
    expect(r.record.decision).toBe("PENDING");
    expect(fs.existsSync(packArtifactPath("go-nogo.json"))).toBe(true);
  });

  it("authorizes via --go CLI flag", () => {
    const r = resolveImplementAuthorization(["--go"]);
    expect(r.allowed).toBe(true);
    expect(r.record.decision).toBe("GO");
    expect(r.record.by).toContain("cli");
  });

  it("authorizes via IMPLEMENT_GO=1", () => {
    process.env.IMPLEMENT_GO = "1";
    const r = resolveImplementAuthorization([]);
    expect(r.allowed).toBe(true);
    expect(r.record.decision).toBe("GO");
  });

  it("denies via --no-go even if env says GO", () => {
    process.env.IMPLEMENT_GO = "1";
    const r = resolveImplementAuthorization(["--no-go"]);
    expect(r.allowed).toBe(false);
    expect(r.record.decision).toBe("NO_GO");
  });

  it("authorizes from go-nogo.json decision=GO", () => {
    fs.writeFileSync(
      path.join(tmp, "go-nogo.json"),
      JSON.stringify({
        decision: "GO",
        by: "owner",
        at: new Date().toISOString(),
        reason: "test authorize",
      }),
      "utf-8"
    );
    const r = resolveImplementAuthorization([]);
    expect(r.allowed).toBe(true);
    expect(r.record.by).toBe("owner");
  });

  it("blocks from go-nogo.json decision=NO_GO", () => {
    fs.writeFileSync(
      path.join(tmp, "go-nogo.json"),
      JSON.stringify({
        decision: "NO_GO",
        by: "owner",
        at: new Date().toISOString(),
        reason: "not ready",
      }),
      "utf-8"
    );
    const r = resolveImplementAuthorization([]);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not ready|NO_GO/);
  });
});
