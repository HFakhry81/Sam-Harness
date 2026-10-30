/**
 * Desktop operator contracts — OS-agnostic. Backends implement DesktopBackend.
 */

export type DesktopPlatform = "win32" | "darwin" | "linux" | "mock";

export type DesktopActionRisk =
  | "read"
  | "ops_safe"
  | "destructive"
  | "financial"
  | "sending";

export type DesktopActionName =
  | "list_windows"
  | "focus_window"
  | "launch_app"
  | "close_window"
  | "uia_tree"
  | "uia_find"
  | "uia_invoke"
  | "uia_set_value"
  | "type_text"
  | "key"
  | "click"
  | "move_mouse"
  | "clipboard_get"
  | "clipboard_set"
  | "file_dialog"
  | "screenshot"
  | "open_media"
  | "ffmpeg"
  | "verify";

export type WindowInfo = {
  handle: string;
  title: string;
  processName?: string;
  pid?: number;
  bounds?: { x: number; y: number; width: number; height: number };
};

export type UiaElement = {
  id?: string;
  name?: string;
  controlType?: string;
  automationId?: string;
  className?: string;
  value?: string;
  boundingRectangle?: { x: number; y: number; width: number; height: number };
  children?: UiaElement[];
};

export type ScreenshotResult = {
  path: string;
  bytes: number;
  width?: number;
  height?: number;
};

export type ClipboardContent = {
  text?: string;
  format?: string;
};

export type FileDialogRequest = {
  mode: "open" | "save";
  path?: string;
  filter?: string;
  /** Window title substring to target the dialog */
  dialogTitle?: string;
};

export type VerifyExpectation =
  | { kind: "window_title"; includes: string }
  | { kind: "process_running"; name: string }
  | { kind: "file_exists"; path: string }
  | { kind: "uia_exists"; name?: string; automationId?: string; controlType?: string }
  | { kind: "uia_value"; automationId?: string; name?: string; equals?: string; includes?: string }
  | { kind: "screenshot_changed"; minDiffRatio?: number }
  | { kind: "screenshot_stable"; maxDiffRatio?: number };

export type DesktopActionRequest = {
  action: DesktopActionName;
  params?: Record<string, unknown>;
  /** When true, plan only — no side effects */
  dryRun?: boolean;
  /** Skip verify-after-act */
  skipVerify?: boolean;
  /** Override verify expectations */
  verify?: VerifyExpectation[];
  /** Max verify retries (default 2) */
  verifyRetries?: number;
  /** Explicit approval id or true when human already approved */
  approved?: boolean | string;
  /** Run id for timeline / artifact folder */
  runId?: string;
};

export type DesktopActionPlan = {
  action: DesktopActionName;
  risk: DesktopActionRisk;
  requiresApproval: boolean;
  summary: string;
  params: Record<string, unknown>;
  verify: VerifyExpectation[];
};

export type DesktopActionResult = {
  ok: boolean;
  action: DesktopActionName;
  message: string;
  dryRun?: boolean;
  risk?: DesktopActionRisk;
  requiresApproval?: boolean;
  approvalId?: string;
  data?: unknown;
  verification?: {
    ok: boolean;
    attempts: number;
    details: string[];
  };
  recording?: {
    screenshotBefore?: string;
    screenshotAfter?: string;
    timelineEventId?: string;
  };
  plan?: DesktopActionPlan;
};

export type DesktopBackend = {
  readonly platform: DesktopPlatform;
  readonly name: string;

  listWindows(): Promise<WindowInfo[]>;
  focusWindow(opts: { handle?: string; titleIncludes?: string; processName?: string }): Promise<WindowInfo>;
  launchApp(opts: {
    app: string;
    args?: string[];
    cwd?: string;
    waitForWindowMs?: number;
  }): Promise<{ pid?: number; window?: WindowInfo }>;
  closeWindow(opts: { handle?: string; titleIncludes?: string }): Promise<void>;

  getUiaTree(opts?: { handle?: string; titleIncludes?: string; maxDepth?: number }): Promise<UiaElement>;
  findUia(opts: {
    handle?: string;
    titleIncludes?: string;
    name?: string;
    automationId?: string;
    controlType?: string;
    maxDepth?: number;
  }): Promise<UiaElement | null>;
  invokeUia(opts: {
    handle?: string;
    titleIncludes?: string;
    name?: string;
    automationId?: string;
    controlType?: string;
    pattern?: "Invoke" | "Toggle" | "ExpandCollapse" | "SelectionItem";
  }): Promise<UiaElement>;
  setUiaValue(opts: {
    handle?: string;
    titleIncludes?: string;
    name?: string;
    automationId?: string;
    value: string;
  }): Promise<UiaElement>;

  typeText(opts: { text: string; delayMs?: number }): Promise<void>;
  sendKeys(opts: { keys: string }): Promise<void>;
  click(opts: {
    x?: number;
    y?: number;
    button?: "left" | "right" | "middle";
    clickCount?: number;
    /** Prefer UIA target when provided */
    name?: string;
    automationId?: string;
    handle?: string;
    titleIncludes?: string;
  }): Promise<void>;
  moveMouse(opts: { x: number; y: number }): Promise<void>;

  getClipboard(): Promise<ClipboardContent>;
  setClipboard(opts: { text: string }): Promise<void>;

  handleFileDialog(opts: FileDialogRequest): Promise<{ path?: string; handled: boolean }>;

  screenshot(opts?: { path?: string; region?: { x: number; y: number; width: number; height: number } }): Promise<ScreenshotResult>;

  openMedia(opts: { path: string }): Promise<{ opened: boolean; path: string }>;
  ffmpeg(opts: {
    args: string[];
    cwd?: string;
    timeoutMs?: number;
  }): Promise<{ stdout: string; stderr: string; code: number }>;

  /** Optional pixel-diff between two PNG paths; returns 0..1 change ratio */
  screenshotDiff?(beforePath: string, afterPath: string): Promise<number>;

  /** Process existence check (more reliable than UIA window list on CI/session-isolated hosts) */
  isProcessRunning?(name: string): Promise<boolean>;

  /** Register / poll kill-switch hotkey support (best-effort) */
  installKillHotkey?(opts: { flagPath: string }): Promise<{ installed: boolean; note?: string }>;
};
