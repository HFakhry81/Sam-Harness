/**
 * Seed task — copy to ../task.ts on first setup (Tools\01-setup-prereqs.bat).
 * Prefer composing tasks from Control Plane UI (pnpm run ui).
 */
export type SamHarnessRoute = "operational" | "architecture" | "implement";

export type SamHarnessTask = {
  id: string;
  route: SamHarnessRoute;
  title: string;
  targetRepo: string;
  packDir: string;
  body: string;
};

export const taskConfig: SamHarnessTask = {
  id: "pending-idle",
  route: "operational",
  title: "(لا توجد مهمة نشطة)",
  targetRepo: process.cwd(),
  packDir: "docs",
  body: `# Sam-Harness Task

## Route
operational

## Title
(لا توجد مهمة نشطة)

## Goal
لا توجد مهمة قيد التنفيذ. اكتب مهمة جديدة من Control Plane.
`.trim(),
};

export function getTaskMarkdown(): string {
  return taskConfig.body;
}

export default taskConfig;
