/**
 * Resolve the platform desktop backend. Tests may inject a mock via setDesktopBackend.
 */
import type { DesktopBackend } from "./types.js";
import { createMockBackend } from "./backends/mock.js";
import { createStubBackend } from "./backends/stub.js";
import { createWindowsBackend } from "./backends/windows.js";

let injected: DesktopBackend | null = null;

export function setDesktopBackend(backend: DesktopBackend | null): void {
  injected = backend;
}

export function getDesktopBackend(): DesktopBackend {
  if (injected) return injected;
  if (String(process.env.SAM_DESKTOP_BACKEND || "").trim().toLowerCase() === "mock") {
    return createMockBackend();
  }
  switch (process.platform) {
    case "win32":
      return createWindowsBackend();
    case "darwin":
      return createStubBackend("darwin");
    default:
      return createStubBackend("linux");
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
