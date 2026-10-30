/**
 * Tools manager — syntax + action-list consistency (Ubuntu + Windows CI).
 * No network.
 * - Skips bash-dependent cases when no usable bash (e.g. Windows WSL stub).
 * - Asserts UTF-8 BOM on .ps1 so Windows PowerShell 5.1 can parse Arabic.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = path.join(root, "Tools");
const manifestPath = path.join(tools, "lib", "actions.manifest");
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function readManifest(): string[] {
  return fs
    .readFileSync(manifestPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function listPs1Files(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.ps1$/i.test(ent.name) || /\.psm1$/i.test(ent.name)) out.push(full);
    }
  };
  walk(path.join(tools));
  walk(path.join(root, "scripts", "install"));
  return out.sort();
}

function hasUtf8Bom(filePath: string): boolean {
  const buf = fs.readFileSync(filePath);
  return buf.length >= 3 && buf.subarray(0, 3).equals(UTF8_BOM);
}

function readUtf8(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  if (buf.subarray(0, 3).equals(UTF8_BOM)) {
    return buf.subarray(3).toString("utf8");
  }
  return buf.toString("utf8");
}

function which(cmd: string): string | null {
  const fromPath = process.env.PATH || "";
  for (const dir of fromPath.split(path.delimiter)) {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const p = path.join(dir, cmd + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Prefer Git Bash on Windows; require `bash -c 'echo ok'` to print ok.
 * Rejects the Windows WSL stub that fails with execvpe(/bin/bash).
 */
function findUsableBash(): string | null {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const programFiles = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Programs")
        : undefined,
    ].filter(Boolean) as string[];
    for (const rootDir of programFiles) {
      candidates.push(path.join(rootDir, "Git", "bin", "bash.exe"));
      candidates.push(path.join(rootDir, "Git", "usr", "bin", "bash.exe"));
    }
  }
  const pathBash = which("bash");
  if (pathBash) candidates.push(pathBash);
  candidates.push("bash");

  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    if (c !== "bash" && path.isAbsolute(c) && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ["-c", "echo ok"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    if (r.error) continue;
    if (r.status === 0 && String(r.stdout || "").includes("ok")) {
      return c;
    }
  }
  return null;
}

/** Prefer Windows PowerShell 5.1 (powershell.exe) over pwsh 7. */
function findWindowsPowerShell51(): string | null {
  if (process.platform === "win32") {
    const sys = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    if (fs.existsSync(sys)) return sys;
  }
  return which("powershell") || which("pwsh");
}

function findAnyPowerShell(): string | null {
  return findWindowsPowerShell51() || which("pwsh") || which("powershell");
}

const usableBash = findUsableBash();

describe("Tools manager", () => {
  it("actions.manifest lists expected actions", () => {
    const actions = readManifest();
    expect(actions).toContain("install");
    expect(actions).toContain("setup-prereqs");
    expect(actions).toContain("install-deps");
    expect(actions).toContain("update");
    expect(actions).toContain("build-check");
    expect(actions).toContain("start-ui");
    expect(actions).toContain("pull-models");
    expect(actions).toContain("doctor");
    expect(actions).toContain("help");
    expect(actions).toContain("backup");
    expect(actions).toContain("restore");
    expect(actions).toContain("repair");
    expect(actions).toContain("uninstall");
    expect(actions).toContain("view-logs");
    expect(actions).toContain("cleanup-logs");
    expect(actions).toContain("health");
    expect(actions).toContain("exit");
    expect(actions.length).toBeGreaterThanOrEqual(17);
  });

  it("PowerShell scripts use UTF-8 BOM (required for Windows PowerShell 5.1 + Arabic)", () => {
    const files = listPs1Files();
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      expect(hasUtf8Bom(f), `missing UTF-8 BOM: ${f}`).toBe(true);
    }
    const manager = readUtf8(path.join(tools, "Sam-Harness-Manager.ps1"));
    expect(manager).toContain("مدير");
    expect(manager).toContain("القائمة الرئيسية");
  });

  it("bash manager references every manifest action", () => {
    const sh = readUtf8(path.join(tools, "sam-harness-manager.sh"));
    const actions = readManifest().filter((a) => a !== "exit");
    for (const a of actions) {
      expect(sh, `bash manager missing action ${a}`).toMatch(
        new RegExp(`\\b${a.replace(/-/g, "\\-")}\\b`)
      );
    }
    expect(sh).toContain("resolve_choice");
    expect(sh).toContain("invoke_action");
  });

  it("PowerShell manager references every manifest action", () => {
    const ps1 = readUtf8(path.join(tools, "Sam-Harness-Manager.ps1"));
    const actions = readManifest().filter((a) => a !== "exit");
    for (const a of actions) {
      expect(ps1, `ps1 manager missing action ${a}`).toContain(`"${a}"`);
    }
    expect(ps1).toContain("Invoke-SamAction");
    expect(ps1).toContain("Show-SamMenu");
  });

  it("legacy bat wrappers call manager -Action and set UTF-8 code page", () => {
    const map: Record<string, string> = {
      "01-setup-prereqs.bat": "setup-prereqs",
      "02-install-deps.bat": "install-deps",
      "03-update.bat": "update",
      "04-build-check.bat": "build-check",
      "05-start-ui.bat": "start-ui",
      "06-pull-ollama-models.bat": "pull-models",
    };
    for (const [file, action] of Object.entries(map)) {
      const body = readUtf8(path.join(tools, file));
      expect(body).toMatch(/Sam-Harness-Manager\.cmd/i);
      expect(body).toContain(`-Action ${action}`);
      expect(body).toMatch(/chcp 65001/i);
    }
    const cmd = readUtf8(path.join(tools, "Sam-Harness-Manager.cmd"));
    expect(cmd).toMatch(/chcp 65001/i);
    expect(cmd).toMatch(/ExecutionPolicy Bypass/i);
    expect(cmd).toMatch(/Sam-Harness-Manager\.ps1/i);
  });

  it("legacy sh wrappers call manager --action", () => {
    const map: Record<string, string> = {
      "01-setup-prereqs.sh": "setup-prereqs",
      "02-install-deps.sh": "install-deps",
      "03-update.sh": "update",
      "04-build-check.sh": "build-check",
      "05-start-ui.sh": "start-ui",
      "06-pull-ollama-models.sh": "pull-models",
    };
    for (const [file, action] of Object.entries(map)) {
      const body = readUtf8(path.join(tools, file));
      expect(body).toContain("sam-harness-manager.sh");
      expect(body).toContain(`--action ${action}`);
    }
  });

  it("bash -n syntax check on Tools shell scripts", () => {
    if (!usableBash) {
      // Windows WSL stub / no Git Bash — skip, do not fail the suite
      expect(usableBash).toBeNull();
      return;
    }
    const scripts = [
      path.join(tools, "sam-harness-manager.sh"),
      path.join(tools, "lib", "sam-harness-common.sh"),
      path.join(tools, "01-setup-prereqs.sh"),
      path.join(tools, "02-install-deps.sh"),
      path.join(tools, "03-update.sh"),
      path.join(tools, "04-build-check.sh"),
      path.join(tools, "05-start-ui.sh"),
      path.join(tools, "06-pull-ollama-models.sh"),
      path.join(root, "scripts", "install", "install.sh"),
      path.join(root, "scripts", "install", "uninstall.sh"),
    ];
    for (const s of scripts) {
      expect(fs.existsSync(s), s).toBe(true);
      const r = spawnSync(usableBash, ["-n", s], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(r.status, `${s}\n${r.stderr}`).toBe(0);
    }
  });

  it("PowerShell parse check (prefer Windows PowerShell 5.1)", () => {
    const ps = findAnyPowerShell();
    if (!ps) {
      expect(true).toBe(true);
      return;
    }
    const files = listPs1Files();
    for (const f of files) {
      expect(hasUtf8Bom(f), f).toBe(true);
      const escaped = f.replace(/'/g, "''");
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$tokens = $null",
        "$errs = $null",
        `$null = [System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errs)`,
        "if ($errs -and $errs.Count -gt 0) { $errs | ForEach-Object { Write-Output $_.ToString() }; exit 1 }",
        "exit 0",
      ].join("; ");
      const r = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(r.status, `${ps} ${f}\n${r.stdout}\n${r.stderr}`).toBe(0);
    }
  });

  it("manager --help / usage exits 0 on bash", () => {
    if (!usableBash) {
      expect(usableBash).toBeNull();
      return;
    }
    const r = spawnSync(
      usableBash,
      [path.join(tools, "sam-harness-manager.sh"), "--help"],
      { encoding: "utf8", cwd: root, windowsHide: true }
    );
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/action/i);
  });

  it("cleanup-logs and view-logs run non-interactively", () => {
    if (!usableBash) {
      expect(usableBash).toBeNull();
      return;
    }
    const r1 = spawnSync(
      usableBash,
      [
        path.join(tools, "sam-harness-manager.sh"),
        "--action",
        "cleanup-logs",
        "--lang",
        "en",
        "--non-interactive",
      ],
      {
        encoding: "utf8",
        cwd: root,
        env: { ...process.env, SAM_TOOLS_LANG: "en" },
        windowsHide: true,
      }
    );
    expect(r1.status, r1.stdout + r1.stderr).toBe(0);
    expect(r1.stdout).toMatch(/\[OK\]/);

    const r2 = spawnSync(
      usableBash,
      [
        path.join(tools, "sam-harness-manager.sh"),
        "--action",
        "view-logs",
        "--lang",
        "en",
        "--non-interactive",
      ],
      { encoding: "utf8", cwd: root, windowsHide: true }
    );
    expect(r2.status, r2.stdout + r2.stderr).toBe(0);
  });

  it("update refuses dirty tree", () => {
    if (!usableBash) {
      expect(usableBash).toBeNull();
      return;
    }
    const marker = path.join(root, `.tools-manager-dirty-test-${process.pid}`);
    fs.writeFileSync(marker, "dirty\n", "utf8");
    try {
      const r = spawnSync(
        usableBash,
        [
          path.join(tools, "sam-harness-manager.sh"),
          "--action",
          "update",
          "--lang",
          "en",
          "--non-interactive",
        ],
        { encoding: "utf8", cwd: root, windowsHide: true }
      );
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/Dirty working tree|غير نظيفة/i);
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });

  it("team.json local models are discoverable for pull-models", () => {
    const team = JSON.parse(
      readUtf8(path.join(root, "config", "team.json"))
    ) as { roles: { models?: { local?: string | null } }[] };
    const locals = new Set<string>();
    for (const role of team.roles || []) {
      const m = role.models?.local;
      if (m && String(m).trim()) locals.add(String(m).trim());
    }
    expect(locals.size).toBeGreaterThanOrEqual(2);
    expect(locals.has("qwen2.5-coder:1.5b") || locals.has("gemma3:1b")).toBe(true);

    if (!usableBash) {
      // Still validate team.json without bash helper
      expect(usableBash).toBeNull();
      return;
    }
    const toolsPosix = tools.replace(/\\/g, "/");
    const rootPosix = root.replace(/\\/g, "/");
    const script = [
      "set -e",
      `TOOLS_DIR='${toolsPosix.replace(/'/g, `'\\''`)}'`,
      `PROJECT_ROOT='${rootPosix.replace(/'/g, `'\\''`)}'`,
      'source "$TOOLS_DIR/lib/sam-harness-common.sh"',
      "sam_team_local_models",
    ].join("\n");
    const r = spawnSync(usableBash, ["-lc", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(r.status, r.stderr).toBe(0);
    for (const m of locals) {
      expect(r.stdout).toContain(m);
    }
  });

  it("docs mention Sam-Harness-Manager", () => {
    for (const rel of [
      "Tools/README.md",
      "docs/help/en/install.md",
      "docs/help/ar/install.md",
      "docs/help/en/troubleshooting.md",
      "docs/help/ar/troubleshooting.md",
    ]) {
      const body = readUtf8(path.join(root, rel));
      expect(body, rel).toMatch(/Sam-Harness-Manager|sam-harness-manager/);
    }
  });

  it("package.json exposes migrate and tools scripts", () => {
    const pkg = JSON.parse(readUtf8(path.join(root, "package.json"))) as {
      scripts: Record<string, string>;
      packageManager: string;
    };
    expect(pkg.scripts.migrate).toContain("migrate.ts");
    expect(pkg.scripts.tools).toContain("sam-harness-manager.sh");
    expect(pkg.scripts["tools:win"]).toContain("Sam-Harness-Manager.ps1");
    expect(pkg.packageManager).toMatch(/^pnpm@11\./);
  });

  it(".gitattributes enforces CRLF for bat/cmd/ps1 and LF for sh", () => {
    const ga = readUtf8(path.join(root, ".gitattributes"));
    expect(ga).toMatch(/\*\.bat\s+text\s+eol=crlf/);
    expect(ga).toMatch(/\*\.cmd\s+text\s+eol=crlf/);
    expect(ga).toMatch(/\*\.ps1\s+text\s+eol=crlf/);
    expect(ga).toMatch(/\*\.sh\s+text\s+eol=lf/);
  });
});
