/**
 * Resolve the platform desktop backend. Tests may inject a mock via setDesktopBackend.
 */
import type { DesktopBackend } from "./types.js";
import { createMockBackend } from "./backends/mock.js";
import { createStubBackend } from "./backends/stub.js";
import { createWindowsBackend } from "./backends/windows.js";
import { createLinuxBackend } from "./backends/linux.js";
import { createMacosBackend } from "./backends/macos.js";

let injected: DesktopBackend | null = null;

export function setDesktopBackend(backend: DesktopBackend | null): void {
  injected = backend;
}

export function getDesktopBackend(): DesktopBackend {
  if (injected) return injected;
  const forced = String(process.env.SAM_DESKTOP_BACKEND || "").trim().toLowerCase();
  if (forced === "mock") return createMockBackend();
  if (forced === "stub") {
    return createStubBackend(process.platform === "darwin" ? "darwin" : "linux");
  }
  if (forced === "linux") return createLinuxBackend();
  if (forced === "macos" || forced === "darwin") return createMacosBackend();
  if (forced === "windows" || forced === "win32") return createWindowsBackend();

  switch (process.platform) {
    case "win32":
      return createWindowsBackend();
    case "darwin":
      return createMacosBackend();
    default:
      return createLinuxBackend();
  }
}

/** Test helper: force mock unless overridden. */
export function useMockDesktopBackend(
  factory: () => DesktopBackend = () => createMockBackend()
): DesktopBackend {
  const b = factory();
  setDesktopBackend(b);
  return b;
}

export function __resetDesktopBackendForTests(): void {
  injected = null;
}
