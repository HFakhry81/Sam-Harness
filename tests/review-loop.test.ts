import { describe, expect, it } from "vitest";
import {
  MAX_LOOPS,
  parseApproved,
  routeAfterAudit,
} from "../src/agency/reviewGraph.js";

describe("LangGraph review loop quality gate", () => {
  it("caps remediations at 5 iterations", () => {
    expect(MAX_LOOPS).toBe(5);
  });

  it("routes APPROVED to approved regardless of loop count", () => {
    expect(routeAfterAudit({ auditPassed: true, loop: 1 })).toBe("approved");
    expect(routeAfterAudit({ auditPassed: true, loop: 5 })).toBe("approved");
  });

  it("remediates while under MAX_LOOPS when rejected", () => {
    for (let loop = 1; loop < MAX_LOOPS; loop++) {
      expect(routeAfterAudit({ auditPassed: false, loop })).toBe("remediate");
    }
  });

  it("fails when rejected at MAX_LOOPS (no 6th iteration)", () => {
    expect(routeAfterAudit({ auditPassed: false, loop: MAX_LOOPS })).toBe(
      "failed"
    );
    expect(routeAfterAudit({ auditPassed: false, loop: MAX_LOOPS + 1 })).toBe(
      "failed"
    );
  });

  it("parseApproved recognizes gate markers", () => {
    expect(parseApproved("[APPROVED]\nLooks good")).toBe(true);
    expect(parseApproved("[REJECTED]\nMissing evidence")).toBe(false);
    expect(parseApproved("Intro\n[APPROVED]\nbody")).toBe(true);
    expect(parseApproved("Intro\n[REJECTED]\nbody")).toBe(false);
    expect(parseApproved("no marker")).toBe(false);
  });

  it("REJECTED wins over a later APPROVED line", () => {
    expect(parseApproved("[REJECTED]\n...\n[APPROVED]")).toBe(false);
  });
});
