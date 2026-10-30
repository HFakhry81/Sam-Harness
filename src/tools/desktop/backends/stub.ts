/**
 * Stub backends for macOS / Linux — structure ready for future Accessibility APIs.
 */
import type {
  ClipboardContent,
  DesktopBackend,
  DesktopPlatform,
  FileDialogRequest,
  ScreenshotResult,
  UiaElement,
  WindowInfo,
} from "../types.js";

function notImplemented(platform: DesktopPlatform, method: string): never {
  throw new Error(
    `Desktop backend "${platform}" stub: ${method} is not implemented yet. Use Windows (win32) or inject a mock backend for tests.`
  );
}

export function createStubBackend(platform: "darwin" | "linux"): DesktopBackend {
  const name = platform === "darwin" ? "macos-accessibility-stub" : "linux-atspi-stub";
  return {
    platform,
    name,
    async listWindows(): Promise<WindowInfo[]> {
      return notImplemented(platform, "listWindows");
    },
    async focusWindow(): Promise<WindowInfo> {
      return notImplemented(platform, "focusWindow");
    },
    async launchApp() {
      return notImplemented(platform, "launchApp");
    },
    async closeWindow() {
      return notImplemented(platform, "closeWindow");
    },
    async getUiaTree(): Promise<UiaElement> {
      return notImplemented(platform, "getUiaTree");
    },
    async findUia(): Promise<UiaElement | null> {
      return notImplemented(platform, "findUia");
    },
    async invokeUia(): Promise<UiaElement> {
      return notImplemented(platform, "invokeUia");
    },
    async setUiaValue(): Promise<UiaElement> {
      return notImplemented(platform, "setUiaValue");
    },
    async typeText() {
      return notImplemented(platform, "typeText");
    },
    async sendKeys() {
      return notImplemented(platform, "sendKeys");
    },
    async click() {
      return notImplemented(platform, "click");
    },
    async moveMouse() {
      return notImplemented(platform, "moveMouse");
    },
    async getClipboard(): Promise<ClipboardContent> {
      return notImplemented(platform, "getClipboard");
    },
    async setClipboard() {
      return notImplemented(platform, "setClipboard");
    },
    async handleFileDialog(_opts: FileDialogRequest) {
      return notImplemented(platform, "handleFileDialog");
    },
    async screenshot(): Promise<ScreenshotResult> {
      return notImplemented(platform, "screenshot");
    },
    async openMedia() {
      return notImplemented(platform, "openMedia");
    },
    async ffmpeg() {
      return notImplemented(platform, "ffmpeg");
    },
    async installKillHotkey() {
      return {
        installed: false,
        note: `${platform} hotkey listener not implemented — use SAM_DESKTOP_KILL_FILE / pause APIs`,
      };
    },
  };
}
