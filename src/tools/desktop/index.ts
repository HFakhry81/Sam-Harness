/**
 * Phase 4 — Windows desktop operator (UIA-first, cross-OS abstraction).
 */
export type {
  DesktopActionName,
  DesktopActionPlan,
  DesktopActionRequest,
  DesktopActionResult,
  DesktopActionRisk,
  DesktopBackend,
  DesktopPlatform,
  UiaElement,
  VerifyExpectation,
  WindowInfo,
} from "./types.js";

export {
  getDesktopBackend,
  setDesktopBackend,
  useMockDesktopBackend,
  __resetDesktopBackendForTests,
} from "./backendFactory.js";
export { createMockBackend, createMockDesktopState } from "./backends/mock.js";
export { createWindowsBackend } from "./backends/windows.js";
export { createStubBackend } from "./backends/stub.js";

export {
  runDesktopAction,
  planDesktopAction,
  isDesktopDryRun,
  desktopToolToAction,
  listDesktopToolNames,
} from "./operator.js";

export {
  classifyDesktopRisk,
  requiresApproval,
  resolveApproval,
  approveDesktopAction,
  isDesktopAutoApproved,
} from "./permissions.js";

export {
  pauseDesktop,
  resumeDesktop,
  killDesktop,
  readKillSwitchState,
  assertDesktopNotStopped,
  __resetKillSwitchForTests,
} from "./killSwitch.js";
