import { describe, expect, it } from "vitest";
import {
  buildTaskSpec,
  needsClarify,
  planToolsFromSpec,
  type TaskSpec,
} from "../src/controlplane/taskSpec.js";

function toolNames(spec: TaskSpec): string[] {
  return planToolsFromSpec(spec)
    .filter(
      (p): p is { action: "tool"; tool: string; params: Record<string, unknown> } =>
        p.action === "tool"
    )
    .map((p) => p.tool);
}

describe("task-spec engine", () => {
  it("classifies Arabic move as operational move_file", () => {
    const spec = buildTaskSpec({
      prompt: "انقل الملف Sam-Harness team test.xls من سطح المكتب الي المحرك D:",
    });
    expect(spec.route).toBe("operational");
    expect(spec.intent).toBe("move");
    expect(needsClarify(spec)).toBe(false);
    expect(toolNames(spec)).toContain("move_file");
  });

  it("requires clarification before destructive delete", () => {
    const spec = buildTaskSpec({
      prompt: "احذف الملف old.txt من سطح المكتب",
    });
    expect(spec.intent).toBe("delete");
    expect(needsClarify(spec)).toBe(true);
  });

  it("accepts delete after explicit confirmation answer", () => {
    const q =
      "تأكيد الحذف النهائي؟ اكتب نعم للحذف (destructive — لا سلة محذوفات مضمونة)";
    const spec = buildTaskSpec({
      prompt: "احذف الملف old.txt من سطح المكتب",
      answers: { [q]: "نعم" },
    });
    expect(needsClarify(spec)).toBe(false);
    expect(toolNames(spec)).toContain("delete_path");
  });

  it("builds mkdir + write compound plan without collapsing", () => {
    const spec = buildTaskSpec({
      prompt:
        "على سطح المكتب: أنشئ مجلد باسم ladder-l2 ثم اكتب داخله ملف readme.txt المحتوى سطر واحد فقط: L2 PASS compound-ok",
    });
    expect(spec.route).toBe("operational");
    expect(toolNames(spec)).toEqual(["mkdir", "write_file"]);
  });

  it("routes architecture analysis away from desktop operator", () => {
    const spec = buildTaskSpec({
      prompt: "حلّل مشروع تجريبي وأخرج حزمة تقارير بدون تعديل كود",
      route: "architecture",
      targetRepo: process.cwd(),
    });
    expect(spec.route).toBe("architecture");
    expect(spec.workspaceMode).toBe("code");
  });
});
