/**
 * Tools manager — syntax + action-list consistency (Ubuntu + Windows CI).
 * No network. Skips pwsh parse when PowerShell is not installed.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = path.join(root, "Tools");
const manifestPath = path.join(tools, "lib", "actions.manifest");

function readManifest(): string[] {
  return fs
    .readFileSync(manifestPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function which(cmd: string): string | null {
  try {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (r.error) return null;
    // some tools use -v; presence of binary matters more
  } catch {
    /* ignore */
  }
  const fromPath = process.env.PATH || "";
  for (const dir of fromPath.split(path.delimiter)) {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const p = path.join(dir, cmd + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function findPwsh(): string | null {
  return which("pwsh") || which("powershell");
}

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

  it("bash manager references every manifest action", () => {
    const sh = fs.readFileSync(path.join(tools, "sam-harness-manager.sh"), "utf8");
    const actions = readManifest().filter((a) => a !== "exit");
    for (const a of actions) {
      expect(sh, `bash manager missing action ${a}`).toMatch(
        new RegExp(`\\b${a.replace(/-/g, "\\-")}\\b`)
      );
    }
    // numbered menu rows include install..health
    expect(sh).toContain("resolve_choice");
    expect(sh).toContain("invoke_action");
  });

  it("PowerShell manager references every manifest action", () => {
    const ps1 = fs.readFileSync(path.join(tools, "Sam-Harness-Manager.ps1"), "utf8");
    const actions = readManifest().filter((a) => a !== "exit");
    for (const a of actions) {
      expect(ps1, `ps1 manager missing action ${a}`).toContain(`"${a}"`);
    }
    expect(ps1).toContain("Invoke-SamAction");
    expect(ps1).toContain("Show-SamMenu");
  });

  it("legacy bat wrappers call manager -Action", () => {
    const map: Record<string, string> = {
      "01-setup-prereqs.bat": "setup-prereqs",
      "02-install-deps.bat": "install-deps",
      "03-update.bat": "update",
      "04-build-check.bat": "build-check",
      "05-start-ui.bat": "start-ui",
      "06-pull-ollama-models.bat": "pull-models",
    };
    for (const [file, action] of Object.entries(map)) {
      const body = fs.readFileSync(path.join(tools, file), "utf8");
      expect(body).toMatch(/Sam-Harness-Manager\.cmd/i);
      expect(body).toContain(`-Action ${action}`);
    }
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
      const body = fs.readFileSync(path.join(tools, file), "utf8");
      expect(body).toContain("sam-harness-manager.sh");
      expect(body).toContain(`--action ${action}`);
    }
  });

  it("bash -n syntax check on Tools shell scripts", () => {
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
      const r = spawnSync("bash", ["-n", s], { encoding: "utf8" });
      expect(r.status, `${s}\n${r.stderr}`).toBe(0);
    }
  });

  it("PowerShell parse check when pwsh/powershell is available", () => {
    const pwsh = findPwsh();
    if (!pwsh) {
      // ubuntu-latest often has no PowerShell — skip, windows-latest covers it
      expect(true).toBe(true);
      return;
    }
    const files = [
      path.join(tools, "Sam-Harness-Manager.ps1"),
      path.join(tools, "lib", "SamHarness.Common.ps1"),
      path.join(root, "scripts", "install", "install.ps1"),
      path.join(root, "scripts", "install", "uninstall.ps1"),
    ];
    for (const f of files) {
      const escaped = f.replace(/'/g, "''");
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$tokens = $null",
        "$errs = $null",
        `$null = [System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errs)`,
        "if ($errs -and $errs.Count -gt 0) { $errs | ForEach-Object { Write-Output $_.ToString() }; exit 1 }",
        "exit 0",
      ].join("; ");
      const r = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
      });
      expect(r.status, `${f}\n${r.stdout}\n${r.stderr}`).toBe(0);
    }
  });

  it("manager --help / usage exits 0 on bash", () => {
    const r = spawnSync(
      "bash",
      [path.join(tools, "sam-harness-manager.sh"), "--help"],
      { encoding: "utf8", cwd: root }
    );
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/action/i);
  });

  it("cleanup-logs and view-logs run non-interactively", () => {
    const r1 = spawnSync(
      "bash",
      [
        path.join(tools, "sam-harness-manager.sh"),
        "--action",
        "cleanup-logs",
        "--lang",
        "en",
        "--non-interactive",
      ],
      { encoding: "utf8", cwd: root, env: { ...process.env, SAM_TOOLS_LANG: "en" } }
    );
    expect(r1.status, r1.stdout + r1.stderr).toBe(0);
    expect(r1.stdout).toMatch(/\[OK\]/);

    const r2 = spawnSync(
      "bash",
      [
        path.join(tools, "sam-harness-manager.sh"),
        "--action",
        "view-logs",
        "--lang",
        "en",
        "--non-interactive",
      ],
      { encoding: "utf8", cwd: root }
    );
    expect(r2.status, r2.stdout + r2.stderr).toBe(0);
  });

  it("update refuses dirty tree", () => {
    // create a temp dirty marker without touching real repo state permanently
    const marker = path.join(root, `.tools-manager-dirty-test-${process.pid}`);
    fs.writeFileSync(marker, "dirty\n", "utf8");
    try {
      const r = spawnSync(
        "bash",
        [
          path.join(tools, "sam-harness-manager.sh"),
          "--action",
          "update",
          "--lang",
          "en",
          "--non-interactive",
        ],
        { encoding: "utf8", cwd: root }
      );
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/Dirty working tree|غير نظيفة/i);
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });

  it("team.json local models are discoverable for pull-models", () => {
    const team = JSON.parse(
      fs.readFileSync(path.join(root, "config", "team.json"), "utf8")
    ) as { roles: { models?: { local?: string | null } }[] };
    const locals = new Set<string>();
    for (const role of team.roles || []) {
      const m = role.models?.local;
      if (m && String(m).trim()) locals.add(String(m).trim());
    }
    expect(locals.size).toBeGreaterThanOrEqual(2);
    expect(locals.has("qwen2.5-coder:1.5b") || locals.has("gemma3:1b")).toBe(true);

    // bash helper path via sourcing common
    const script = `
      set -e
      TOOLS_DIR="${tools.replace(/"/g, '\\"')}"
      PROJECT_ROOT="${root.replace(/"/g, '\\"')}"
      source "$TOOLS_DIR/lib/sam-harness-common.sh"
      sam_team_local_models
    `;
    const r = spawnSync("bash", ["-lc", script], { encoding: "utf8" });
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
      const body = fs.readFileSync(path.join(root, rel), "utf8");
      expect(body, rel).toMatch(/Sam-Harness-Manager|sam-harness-manager/);
    }
  });

  it("package.json exposes migrate and tools scripts", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      packageManager: string;
    };
    expect(pkg.scripts.migrate).toContain("migrate.ts");
    expect(pkg.scripts.tools).toContain("sam-harness-manager.sh");
    expect(pkg.scripts["tools:win"]).toContain("Sam-Harness-Manager.ps1");
    expect(pkg.packageManager).toMatch(/^pnpm@11\./);
  });

  it(".gitattributes enforces CRLF for bat/cmd/ps1 and LF for sh", () => {
    const ga = fs.readFileSync(path.join(root, ".gitattributes"), "utf8");
    expect(ga).toMatch(/\*\.bat\s+text\s+eol=crlf/);
    expect(ga).toMatch(/\*\.cmd\s+text\s+eol=crlf/);
    expect(ga).toMatch(/\*\.ps1\s+text\s+eol=crlf/);
    expect(ga).toMatch(/\*\.sh\s+text\s+eol=lf/);
  });
});
