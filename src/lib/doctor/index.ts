/**
 * Health / diagnostic checks for `pnpm run doctor`.
 * All checks are local (no network required for the core suite).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadLocaleConfig } from "../i18n/index.js";
import { assertTranslationCoverage } from "../i18n/index.js";
import { getOutputHome, getOutputLayout } from "../outputHome.js";
import { verifyHelpIntegrity } from "../help/index.js";

export type DoctorSeverity = "ok" | "warn" | "fail";

export type DoctorCheck = {
  id: string;
  title: string;
  severity: DoctorSeverity;
  detail: string;
};

export type DoctorReport = {
  ok: boolean;
  checkedAt: string;
  platform: NodeJS.Platform;
  node: string;
  checks: DoctorCheck[];
};

export type DoctorOptions = {
  cwd?: string;
  /** Skip optional Ollama reachability (always skipped unless explicitly enabled). */
  probeOllama?: boolean;
  env?: NodeJS.ProcessEnv;
};

function nodeMajor(v: string): number {
  const m = /^v?(\d+)/.exec(v);
  return m ? Number(m[1]) : 0;
}

function checkNode(env: NodeJS.ProcessEnv): DoctorCheck {
  const ver = process.version;
  const major = nodeMajor(ver);
  if (major < 20) {
    return {
      id: "node",
      title: "Node.js",
      severity: "fail",
      detail: `${ver} — need >= 20`,
    };
  }
  return {
    id: "node",
    title: "Node.js",
    severity: "ok",
    detail: ver,
  };
}

function checkPnpm(): DoctorCheck {
  // We cannot reliably spawn pnpm in unit tests; infer from packageManager field / PATH hint.
  const pkgPath = path.join(process.cwd(), "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      packageManager?: string;
      engines?: { pnpm?: string };
    };
    const pm = pkg.packageManager || "";
    if (/^pnpm@/.test(pm)) {
      return {
        id: "pnpm",
        title: "pnpm (packageManager)",
        severity: "ok",
        detail: pm,
      };
    }
    return {
      id: "pnpm",
      title: "pnpm (packageManager)",
      severity: "warn",
      detail: "packageManager field missing — use Corepack pnpm@11+",
    };
  } catch (e: any) {
    return {
      id: "pnpm",
      title: "pnpm",
      severity: "fail",
      detail: e?.message || String(e),
    };
  }
}

function checkEnvFile(cwd: string): DoctorCheck {
  const envPath = path.join(cwd, ".env");
  const example = path.join(cwd, ".env.example");
  if (fs.existsSync(envPath)) {
    return {
      id: "env",
      title: ".env",
      severity: "ok",
      detail: envPath,
    };
  }
  if (fs.existsSync(example)) {
    return {
      id: "env",
      title: ".env",
      severity: "warn",
      detail: "missing — copy from .env.example (install script can create it)",
    };
  }
  return {
    id: "env",
    title: ".env",
    severity: "fail",
    detail: "neither .env nor .env.example found",
  };
}

function checkOutputHome(env: NodeJS.ProcessEnv): DoctorCheck {
  try {
    const prev = process.env.SAM_OUTPUT_HOME;
    if (env.SAM_OUTPUT_HOME !== undefined) {
      process.env.SAM_OUTPUT_HOME = env.SAM_OUTPUT_HOME;
    }
    const home = getOutputHome();
    const layout = getOutputLayout(home);
    // Do not create dirs in doctor unless writable check needs parent
    const parent = path.dirname(home);
    const parentOk = fs.existsSync(parent);
    if (!parentOk) {
      return {
        id: "output_home",
        title: "SAM_OUTPUT_HOME",
        severity: "warn",
        detail: `${home} (parent missing — install will create)`,
      };
    }
    try {
      fs.accessSync(parent, fs.constants.W_OK);
    } catch {
      return {
        id: "output_home",
        title: "SAM_OUTPUT_HOME",
        severity: "fail",
        detail: `${home} — parent not writable`,
      };
    }
    return {
      id: "output_home",
      title: "SAM_OUTPUT_HOME",
      severity: "ok",
      detail: `${home} → reports/documents/runs/…`,
    };
  } catch (e: any) {
    return {
      id: "output_home",
      title: "SAM_OUTPUT_HOME",
      severity: "fail",
      detail: e?.message || String(e),
    };
  }
}

function checkLocale(env: NodeJS.ProcessEnv): DoctorCheck {
  try {
    const cfg = loadLocaleConfig(env);
    assertTranslationCoverage();
    return {
      id: "locale",
      title: "Locale / i18n",
      severity: "ok",
      detail: `locale=${cfg.locale} dir=${cfg.dir} numerals=${cfg.numerals} content=${cfg.contentLocale}`,
    };
  } catch (e: any) {
    return {
      id: "locale",
      title: "Locale / i18n",
      severity: "fail",
      detail: e?.message || String(e),
    };
  }
}

function checkNodeModules(cwd: string): DoctorCheck {
  const nm = path.join(cwd, "node_modules");
  if (fs.existsSync(nm)) {
    return {
      id: "deps",
      title: "node_modules",
      severity: "ok",
      detail: "present",
    };
  }
  return {
    id: "deps",
    title: "node_modules",
    severity: "warn",
    detail: "missing — run pnpm install (or install script)",
  };
}

function checkTaskSeed(cwd: string): DoctorCheck {
  if (fs.existsSync(path.join(cwd, "task.ts"))) {
    return { id: "task", title: "task.ts", severity: "ok", detail: "present" };
  }
  if (fs.existsSync(path.join(cwd, "templates", "task.seed.ts"))) {
    return {
      id: "task",
      title: "task.ts",
      severity: "warn",
      detail: "missing — seed from templates/task.seed.ts",
    };
  }
  return {
    id: "task",
    title: "task.ts",
    severity: "fail",
    detail: "missing and no seed template",
  };
}

function checkPlatform(): DoctorCheck {
  return {
    id: "platform",
    title: "Platform",
    severity: "ok",
    detail: `${process.platform} ${os.arch()} · home=${os.homedir()}`,
  };
}

function checkHelpDocs(cwd: string): DoctorCheck {
  try {
    const result = verifyHelpIntegrity(cwd);
    if (result.ok) {
      return {
        id: "help",
        title: "Help docs",
        severity: "ok",
        detail: `${result.topics.length} topics × ar/en`,
      };
    }
    return {
      id: "help",
      title: "Help docs",
      severity: "fail",
      detail: result.issues
        .slice(0, 4)
        .map((i) => `${i.locale}/${i.id || "?"}: ${i.problem}`)
        .join("; "),
    };
  } catch (e: any) {
    return {
      id: "help",
      title: "Help docs",
      severity: "fail",
      detail: e?.message || String(e),
    };
  }
}

/** Run diagnostic suite (no network). */
export function runDoctor(opts: DoctorOptions = {}): DoctorReport {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const prevCwd = process.cwd();
  if (cwd !== prevCwd) {
    try {
      process.chdir(cwd);
    } catch {
      /* keep */
    }
  }
  try {
    const checks: DoctorCheck[] = [
      checkPlatform(),
      checkNode(env),
      checkPnpm(),
      checkEnvFile(cwd),
      checkNodeModules(cwd),
      checkTaskSeed(cwd),
      checkOutputHome(env),
      checkLocale(env),
      checkHelpDocs(cwd),
    ];

    if (opts.probeOllama) {
      checks.push({
        id: "ollama",
        title: "Ollama",
        severity: "warn",
        detail: "probe requested but skipped in offline doctor (set manually)",
      });
    } else {
      checks.push({
        id: "ollama",
        title: "Ollama (optional)",
        severity: "ok",
        detail: "not probed (offline doctor) — expected at http://127.0.0.1:11434",
      });
    }

    const ok = !checks.some((c) => c.severity === "fail");
    return {
      ok,
      checkedAt: new Date().toISOString(),
      platform: process.platform,
      node: process.version,
      checks,
    };
  } finally {
    if (cwd !== prevCwd) {
      try {
        process.chdir(prevCwd);
      } catch {
        /* ignore */
      }
    }
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `Sam-Harness doctor · ${report.ok ? "OK" : "ISSUES"} · ${report.platform} · Node ${report.node}`,
    `Checked: ${report.checkedAt}`,
    "",
  ];
  for (const c of report.checks) {
    const mark = c.severity === "ok" ? "[OK]" : c.severity === "warn" ? "[!!]" : "[XX]";
    lines.push(`${mark} ${c.title}: ${c.detail}`);
  }
  lines.push("");
  return lines.join("\n");
}
