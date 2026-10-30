/**
 * In-memory desktop backend for unit tests on any OS.
 */
import * as fs from "fs";
import * as path from "path";
import type {
  ClipboardContent,
  DesktopBackend,
  FileDialogRequest,
  ScreenshotResult,
  UiaElement,
  WindowInfo,
} from "../types.js";

export type MockDesktopState = {
  windows: WindowInfo[];
  focused?: string;
  tree: UiaElement;
  clipboard: ClipboardContent;
  typed: string[];
  keys: string[];
  clicks: Array<Record<string, unknown>>;
  launched: string[];
  screenshots: string[];
  mediaOpened: string[];
  ffmpegCalls: string[][];
  fileDialogs: FileDialogRequest[];
  diffRatio: number;
};

export function createMockDesktopState(
  overrides: Partial<MockDesktopState> = {}
): MockDesktopState {
  return {
    windows: [
      {
        handle: "1",
        title: "Untitled - Notepad",
        processName: "notepad",
        pid: 1001,
        bounds: { x: 10, y: 10, width: 800, height: 600 },
      },
    ],
    focused: "1",
    tree: {
      name: "Untitled - Notepad",
      controlType: "Window",
      children: [
        {
          name: "Text Editor",
          automationId: "15",
          controlType: "Document",
          value: "",
        },
        {
          name: "File",
          controlType: "MenuItem",
          automationId: "Item 1",
        },
      ],
    },
    clipboard: { text: "" },
    typed: [],
    keys: [],
    clicks: [],
    launched: [],
    screenshots: [],
    mediaOpened: [],
    ffmpegCalls: [],
    fileDialogs: [],
    diffRatio: 0.05,
    ...overrides,
  };
}

function walkFind(
  node: UiaElement,
  pred: (n: UiaElement) => boolean
): UiaElement | null {
  if (pred(node)) return node;
  for (const c of node.children || []) {
    const hit = walkFind(c, pred);
    if (hit) return hit;
  }
  return null;
}

export function createMockBackend(state: MockDesktopState = createMockDesktopState()): DesktopBackend & {
  state: MockDesktopState;
} {
  const backend: DesktopBackend & { state: MockDesktopState } = {
    platform: "mock",
    name: "mock",
    state,

    async listWindows() {
      return [...state.windows];
    },

    async focusWindow(opts) {
      const win =
        state.windows.find((w) => opts.handle && w.handle === opts.handle) ||
        state.windows.find(
          (w) =>
            opts.titleIncludes &&
            w.title.toLowerCase().includes(String(opts.titleIncludes).toLowerCase())
        ) ||
        state.windows.find(
          (w) =>
            opts.processName &&
            (w.processName || "")
              .toLowerCase()
              .includes(String(opts.processName).toLowerCase())
        );
      if (!win) throw new Error(`Mock: window not found (${JSON.stringify(opts)})`);
      state.focused = win.handle;
      return win;
    },

    async launchApp(opts) {
      state.launched.push(opts.app);
      const base = path.basename(opts.app).replace(/\.exe$/i, "");
      const win: WindowInfo = {
        handle: String(1000 + state.windows.length),
        title: base === "notepad" ? "Untitled - Notepad" : base,
        processName: base,
        pid: 2000 + state.windows.length,
        bounds: { x: 0, y: 0, width: 640, height: 480 },
      };
      state.windows.push(win);
      state.focused = win.handle;
      if (base.toLowerCase() === "notepad") {
        state.tree = {
          name: win.title,
          controlType: "Window",
          children: [
            {
              name: "Text Editor",
              automationId: "15",
              controlType: "Document",
              value: "",
            },
          ],
        };
      }
      return { pid: win.pid, window: win };
    },

    async closeWindow(opts) {
      const before = state.windows.length;
      state.windows = state.windows.filter((w) => {
        if (opts.handle && w.handle === opts.handle) return false;
        if (
          opts.titleIncludes &&
          w.title.toLowerCase().includes(String(opts.titleIncludes).toLowerCase())
        ) {
          return false;
        }
        return true;
      });
      if (state.windows.length === before) throw new Error("Mock: close_window target missing");
    },

    async getUiaTree() {
      return structuredClone(state.tree);
    },

    async findUia(opts) {
      return walkFind(state.tree, (n) => {
        if (opts.automationId && n.automationId !== opts.automationId) return false;
        if (opts.name && (n.name || "").toLowerCase() !== opts.name.toLowerCase()) {
          // allow includes
          if (!(n.name || "").toLowerCase().includes(opts.name.toLowerCase())) return false;
        }
        if (
          opts.controlType &&
          (n.controlType || "").toLowerCase() !== opts.controlType.toLowerCase()
        ) {
          return false;
        }
        return Boolean(opts.automationId || opts.name || opts.controlType);
      });
    },

    async invokeUia(opts) {
      const el = await backend.findUia(opts);
      if (!el) throw new Error("Mock: uia element not found for invoke");
      return el;
    },

    async setUiaValue(opts) {
      const el = await backend.findUia(opts);
      if (!el) throw new Error("Mock: uia element not found for set_value");
      el.value = opts.value;
      return el;
    },

    async typeText(opts) {
      state.typed.push(opts.text);
      const doc = walkFind(state.tree, (n) => n.controlType === "Document");
      if (doc) doc.value = `${doc.value || ""}${opts.text}`;
    },

    async sendKeys(opts) {
      state.keys.push(opts.keys);
    },

    async click(opts) {
      state.clicks.push({ ...opts });
    },

    async moveMouse() {
      /* no-op */
    },

    async getClipboard() {
      return { ...state.clipboard };
    },

    async setClipboard(opts) {
      state.clipboard = { text: opts.text, format: "text" };
    },

    async handleFileDialog(opts) {
      state.fileDialogs.push(opts);
      return { path: opts.path, handled: true };
    },

    async screenshot(opts) {
      const dest =
        opts?.path ||
        path.join(process.cwd(), `mock-shot-${state.screenshots.length + 1}.png`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // Minimal valid-ish PNG header bytes (not a real image; enough for file presence)
      const buf = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
        0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      // Vary last bytes so consecutive shots differ for diffRatio fallback
      buf[buf.length - 5] = (state.screenshots.length + 1) & 0xff;
      fs.writeFileSync(dest, buf);
      state.screenshots.push(dest);
      return { path: dest, bytes: buf.length, width: 1, height: 1 } satisfies ScreenshotResult;
    },

    async openMedia(opts) {
      state.mediaOpened.push(opts.path);
      return { opened: true, path: opts.path };
    },

    async ffmpeg(opts) {
      state.ffmpegCalls.push(opts.args);
      return { stdout: "mock-ffmpeg", stderr: "", code: 0 };
    },

    async screenshotDiff() {
      return state.diffRatio;
    },

    async isProcessRunning(name: string) {
      const n = name.toLowerCase().replace(/\.exe$/i, "");
      return state.windows.some((w) =>
        (w.processName || "").toLowerCase().replace(/\.exe$/i, "").includes(n)
      );
    },

    async installKillHotkey() {
      return { installed: false, note: "mock has no hotkey" };
    },
  };
  return backend;
}
