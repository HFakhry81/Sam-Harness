/**
 * Offline smoke for Phase 4 desktop operator (mock backend — any OS).
 */
import {
  createMockBackend,
  planDesktopAction,
  runDesktopAction,
  setDesktopBackend,
  __resetDesktopBackendForTests,
  classifyDesktopRisk,
  requiresApproval,
} from "../src/tools/desktop/index.js";
import { assertToolAllowed, OPERATOR_CAPABILITIES } from "../src/agency/capabilities.js";
import { executeTool } from "../src/tools/registry.js";

async function main(): Promise<void> {
  const checks: string[] = [];

  if (!OPERATOR_CAPABILITIES.tools.includes("desktop_launch_app")) {
    throw new Error("operator matrix missing desktop_launch_app");
  }
  checks.push("capabilities");

  assertToolAllowed("operator", "desktop_uia_tree");
  checks.push("assertToolAllowed");

  if (classifyDesktopRisk("close_window") !== "destructive") {
    throw new Error("close_window should be destructive");
  }
  if (!requiresApproval("financial")) {
    throw new Error("financial should require approval");
  }
  checks.push("risk-matrix");

  const mock = createMockBackend();
  setDesktopBackend(mock);
  try {
    const plan = planDesktopAction({
      action: "launch_app",
      params: { app: "notepad" },
      dryRun: true,
    });
    if (plan.action !== "launch_app" || plan.requiresApproval) {
      throw new Error("launch_app plan should be ops_safe without approval");
    }

    process.env.SAM_DESKTOP_DRY_RUN = "1";
    const dry = await runDesktopAction({
      action: "launch_app",
      params: { app: "notepad" },
    });
    if (!dry.dryRun || !dry.ok) throw new Error("dry-run failed");
    delete process.env.SAM_DESKTOP_DRY_RUN;

    const launch = await runDesktopAction({
      action: "launch_app",
      params: { app: "notepad", expectTitle: "Notepad" },
      skipVerify: true,
    });
    if (!launch.ok) throw new Error(`launch failed: ${launch.message}`);

    const viaRegistry = await executeTool("desktop_list_windows", {});
    if (!viaRegistry.ok) throw new Error(`registry list_windows failed: ${viaRegistry.message}`);

    const blocked = await runDesktopAction({
      action: "close_window",
      params: { titleIncludes: "Notepad" },
    });
    if (blocked.ok || !blocked.requiresApproval) {
      throw new Error("close_window should require approval when unapproved");
    }

    checks.push("mock-operator");
  } finally {
    __resetDesktopBackendForTests();
    delete process.env.SAM_DESKTOP_DRY_RUN;
  }

  console.log(`smoke:desktop PASS (${checks.join(", ")})`);
}

main().catch((e) => {
  console.error("smoke:desktop FAIL", e);
  process.exit(1);
});
