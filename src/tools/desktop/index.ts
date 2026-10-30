/**
 * Phase 4/8 — Desktop operator (Windows UIA; Linux xdotool/wmctrl; macOS osascript).
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
export { createLinuxBackend } from "./backends/linux.js";
export { createMacosBackend } from "./backends/macos.js";
export {
  detectLinuxCapabilities,
  detectMacCapabilities,
  buildLinuxScreenshotCommand,
  buildLinuxTypeCommand,
  buildLinuxKeyCommand,
  buildLinuxClickCommand,
  buildLinuxListWindowsCommand,
  buildMacScreenshotCommand,
  buildMacOsascript,
  hasUnixTool,
  __resetUnixToolCacheForTests,
} from "./backends/unixDetect.js";

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
