import { describe, expect, it } from "vitest";
import { isSamHarnessWorkspace } from "../src/lib/reviewPackDir.js";

describe("isSamHarnessWorkspace", () => {
  it("detects this checkout as Sam-Harness even when folder is not named that", () => {
    expect(isSamHarnessWorkspace(process.cwd())).toBe(true);
  });
});
