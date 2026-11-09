import { describe, expect, it } from "vitest";
import { summarizeRunOutcome } from "../src/controlplane/runOutcome.js";

describe("task run outcome", () => {
  it("explains completed work and an authorization blocker", () => {
    const outcome = summarizeRunOutcome({
      success: false,
      exitCode: 1,
      log: "[OK] [Evidence Scout] collected 3 sources\n[Error] Fatal: ResponseError: 401 Unauthorized",
      artifacts: ["evidence-pack.md"],
    });

    expect(outcome.headline).toContain("توقفت المهمة");
    expect(outcome.bullets).toContain("ما تم: Evidence Scout: collected 3 sources");
    expect(outcome.bullets).toContain("المخرجات: evidence-pack.md");
    expect(outcome.bullets.join(" ")).toContain("المزوّد رفض المصادقة");
    expect(outcome.bullets.join(" ")).toContain("لم يصدر التقرير النهائي");
    expect(outcome.nextSteps[0]).toContain("عالج العائق");
  });

  it("marks cancellation separately and preserves partial work in the report", () => {
    const outcome = summarizeRunOutcome({
      success: false,
      cancelled: true,
      exitCode: null,
      log: "[OK] [Planner] prepared a plan",
      artifacts: [],
    });

    expect(outcome.headline).toContain("أُوقف التشغيل");
    expect(outcome.bullets.join(" ")).toContain("أُوقف التشغيل بطلب المالك");
    expect(outcome.bullets.join(" ")).toContain("Planner: prepared a plan");
    expect(outcome.bullets.join(" ")).toContain("لم تكتمل الخطوات اللاحقة");
  });
});
