/**
 * Install helpers used by PowerShell / shell bootstraps and unit tests.
 * No network — only filesystem / env mutations the installers also perform.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureOutputHome, getOutputHome } from "../outputHome.js";

export type EnvPromptValue = {
  key: string;
  value: string;
};

export type CreateEnvResult = {
  path: string;
  created: boolean;
  updated: boolean;
  keysSet: string[];
};

const DEFAULT_PROMPTS: Array<{ key: string; defaultValue: string; comment?: string }> = [
  { key: "SAM_LOCALE", defaultValue: "ar", comment: "Arabic-first UI (ar|en)" },
  { key: "SAM_NUMERALS", defaultValue: "eastern", comment: "eastern|western digits" },
  { key: "CONTROL_PLANE_PORT", defaultValue: "8787" },
  { key: "EMAIL_PROVIDER", defaultValue: "smtp" },
  { key: "SAM_TENANT_ID", defaultValue: "local" },
];

/**
 * Create `.env` from `.env.example` if missing (idempotent).
 * Optionally apply prompt overrides without clobbering existing non-empty values
 * unless `force` is set.
 */
export function createEnvFromExample(
  cwd: string,
  opts?: {
    prompts?: EnvPromptValue[];
    force?: boolean;
    exampleName?: string;
    envName?: string;
  }
): CreateEnvResult {
  const exampleName = opts?.exampleName || ".env.example";
  const envName = opts?.envName || ".env";
  const examplePath = path.join(cwd, exampleName);
  const envPath = path.join(cwd, envName);
  const keysSet: string[] = [];

  if (!fs.existsSync(examplePath)) {
    throw new Error(`Missing ${exampleName} in ${cwd}`);
  }

  let created = false;
  let updated = false;
  let body: string;

  if (!fs.existsSync(envPath) || opts?.force) {
    body = fs.readFileSync(examplePath, "utf-8");
    if (!fs.existsSync(envPath)) created = true;
    else updated = true;
  } else {
    body = fs.readFileSync(envPath, "utf-8");
  }

  const prompts = opts?.prompts?.length
    ? opts.prompts
    : DEFAULT_PROMPTS.map((p) => ({ key: p.key, value: p.defaultValue }));

  for (const p of prompts) {
    const re = new RegExp(`^${escapeRegExp(p.key)}=.*$`, "m");
    if (re.test(body)) {
      const current = body.match(re)?.[0]?.split("=").slice(1).join("=") ?? "";
      if (opts?.force || current.trim() === "") {
        body = body.replace(re, `${p.key}=${p.value}`);
        keysSet.push(p.key);
        updated = true;
      }
    } else {
      body = body.replace(/\s*$/, "") + `\n${p.key}=${p.value}\n`;
      keysSet.push(p.key);
      updated = true;
    }
  }

  // Ensure SAM_OUTPUT_HOME comment path is documented if empty
  if (!/^SAM_OUTPUT_HOME=.+$/m.test(body) || /^SAM_OUTPUT_HOME=\s*$/m.test(body)) {
    const home = defaultOutputHomePath();
    if (/^SAM_OUTPUT_HOME=/m.test(body)) {
      body = body.replace(/^SAM_OUTPUT_HOME=.*$/m, `SAM_OUTPUT_HOME=${home}`);
    } else {
      body += `\nSAM_OUTPUT_HOME=${home}\n`;
    }
    keysSet.push("SAM_OUTPUT_HOME");
    updated = true;
  }

  if (created || updated || !fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, body, "utf-8");
  }

  return { path: envPath, created, updated, keysSet: [...new Set(keysSet)] };
}

export function defaultOutputHomePath(homedir: string = os.homedir()): string {
  return path.join(homedir, "Documents", "Sam-Harness");
}

/** Ensure SAM_OUTPUT_HOME tree exists (idempotent). */
export function setupOutputHome(env: NodeJS.ProcessEnv = process.env) {
  if (!env.SAM_OUTPUT_HOME?.trim()) {
    env.SAM_OUTPUT_HOME = defaultOutputHomePath();
  }
  const prev = process.env.SAM_OUTPUT_HOME;
  process.env.SAM_OUTPUT_HOME = env.SAM_OUTPUT_HOME;
  try {
    return ensureOutputHome(getOutputHome());
  } finally {
    if (prev === undefined) delete process.env.SAM_OUTPUT_HOME;
    else process.env.SAM_OUTPUT_HOME = prev;
  }
}

export type StartupRegistration = {
  platform: NodeJS.Platform;
  kind: "scheduled-task" | "launch-agent" | "systemd-user" | "noop";
  name: string;
  /** Instruction or command the shell installer should run (not executed here). */
  commandHint: string;
  enabled: boolean;
};

/**
 * Describe how to register an optional startup entry.
 * Pure helper — does not mutate the OS (shell/PS1 scripts perform registration).
 */
export function describeStartupRegistration(opts?: {
  platform?: NodeJS.Platform;
  projectDir?: string;
  enable?: boolean;
}): StartupRegistration {
  const platform = opts?.platform || process.platform;
  const projectDir = opts?.projectDir || process.cwd();
  const enable = Boolean(opts?.enable);
  const name = "SamHarnessControlPlane";

  if (platform === "win32") {
    return {
      platform,
      kind: "scheduled-task",
      name,
      enabled: enable,
      commandHint: enable
        ? `schtasks /Create /TN "${name}" /TR "pnpm --dir \\"${projectDir}\\" run ui" /SC ONLOGON /RL LIMITED /F`
        : `schtasks /Delete /TN "${name}" /F`,
    };
  }
  if (platform === "darwin") {
    const plist = path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      "com.upnexa.sam-harness.plist"
    );
    return {
      platform,
      kind: "launch-agent",
      name,
      enabled: enable,
      commandHint: enable
        ? `write LaunchAgent ${plist} then launchctl load`
        : `launchctl unload ${plist} && rm -f ${plist}`,
    };
  }
  if (platform === "linux") {
    const unit = path.join(os.homedir(), ".config", "systemd", "user", "sam-harness.service");
    return {
      platform,
      kind: "systemd-user",
      name,
      enabled: enable,
      commandHint: enable
        ? `write ${unit} && systemctl --user enable --now sam-harness.service`
        : `systemctl --user disable --now sam-harness.service; rm -f ${unit}`,
    };
  }
  return {
    platform,
    kind: "noop",
    name,
    enabled: false,
    commandHint: "startup registration not supported on this platform",
  };
}

/** Marker file written by installers for uninstall discovery. */
export const INSTALL_MARKER = ".sam-harness-installed";

export function writeInstallMarker(
  cwd: string,
  meta?: Record<string, unknown>
): string {
  const p = path.join(cwd, INSTALL_MARKER);
  const body = {
    installedAt: new Date().toISOString(),
    platform: process.platform,
    outputHome: process.env.SAM_OUTPUT_HOME || defaultOutputHomePath(),
    ...meta,
  };
  fs.writeFileSync(p, JSON.stringify(body, null, 2), "utf-8");
  return p;
}

export function removeInstallMarker(cwd: string): boolean {
  const p = path.join(cwd, INSTALL_MARKER);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

/**
 * Uninstall local install artifacts (marker, optional startup hint).
 * Does **not** delete SAM_OUTPUT_HOME or node_modules unless explicitly requested.
 */
export function uninstallLocal(opts: {
  cwd: string;
  removeEnv?: boolean;
  removeOutputHome?: boolean;
  outputHome?: string;
}): { removed: string[] } {
  const removed: string[] = [];
  if (removeInstallMarker(opts.cwd)) removed.push(INSTALL_MARKER);
  if (opts.removeEnv) {
    const envPath = path.join(opts.cwd, ".env");
    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
      removed.push(".env");
    }
  }
  if (opts.removeOutputHome) {
    const home = opts.outputHome || defaultOutputHomePath();
    if (fs.existsSync(home)) {
      fs.rmSync(home, { recursive: true, force: true });
      removed.push(home);
    }
  }
  return { removed };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { DEFAULT_PROMPTS };
