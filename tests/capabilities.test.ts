import { describe, expect, it } from "vitest";
import {
  assertToolAllowed,
  capabilitiesFor,
  OPERATOR_CAPABILITIES,
} from "../src/agency/capabilities.js";
import { executeToolAsRole } from "../src/agency/safeExecute.js";

describe("permission matrix", () => {
  it("keeps evidence read-only (no write_file / shell)", () => {
    const caps = capabilitiesFor("evidence");
    expect(caps.tier).toBe("read");
    expect(caps.tools).not.toContain("write_file");
    expect(caps.tools).not.toContain("run_shell");
    expect(caps.tools).not.toContain("delete_path");
  });

  it("denies auditor run_shell via assertToolAllowed", () => {
    expect(() => assertToolAllowed("auditor", "run_shell")).toThrow(
      /cannot use tool/
    );
  });

  it("allows implementer write tools and operator desktop ops", () => {
    expect(() => assertToolAllowed("implementer", "write_file")).not.toThrow();
    expect(() => assertToolAllowed("operator", "screenshot")).not.toThrow();
    expect(OPERATOR_CAPABILITIES.tools).toContain("delete_path");
  });

  it("safeExecute returns denied result without throwing", async () => {
    const denied = await executeToolAsRole("strategist", "run_shell", {
      command: "dir",
    });
    expect(denied.ok).toBe(false);
    expect((denied.data as { denied?: boolean })?.denied).toBe(true);
  });

  it("ceo_router cannot mutate files", () => {
    expect(() => assertToolAllowed("ceo_router", "write_file")).toThrow();
    expect(() => assertToolAllowed("ceo_router", "finish")).not.toThrow();
  });
});
