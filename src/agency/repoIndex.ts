/**
 * Repo indexing for evidence scout v2 — package.json, workspace, import graph,
 * schemas, routes/screens, env usage, mock-data usage. Real paths only.
 */
import * as fs from "fs";
import * as path from "path";

export type RepoIndexHit = {
  path: string;
  kind: "file" | "dir" | "finding";
  note: string;
  category:
    | "package"
    | "workspace"
    | "import_gap"
    | "schema"
    | "route"
    | "env"
    | "mock"
    | "other";
};

export type RepoIndexResult = {
  targetRepo: string;
  scannedAt: string;
  hits: RepoIndexHit[];
  packageNames: string[];
  missingImports: Array<{ file: string; specifier: string }>;
  currencies: string[];
  locales: string[];
  usesMockData: boolean;
};

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".expo",
  "android",
  "ios",
]);

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 7 || out.length > 6000) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
}

function safeRead(file: string, max = 200_000): string {
  try {
    return fs.readFileSync(file, "utf-8").slice(0, max);
  } catch {
    return "";
  }
}

function rel(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, "/");
}

function collectDeps(pkgPath: string): { name?: string; deps: Set<string> } {
  const deps = new Set<string>();
  try {
    const j = JSON.parse(safeRead(pkgPath));
    for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const block = j[key];
      if (block && typeof block === "object") {
        for (const k of Object.keys(block)) deps.add(k);
      }
    }
    return { name: j.name, deps };
  } catch {
    return { deps };
  }
}

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;

function isPackageSpecifier(spec: string): boolean {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) {
    return false;
  }
  return true;
}

function packageRootName(spec: string): string {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.slice(0, 2).join("/");
  }
  return spec.split("/")[0];
}

export function indexRepo(targetRepo: string): RepoIndexResult {
  const root = path.normalize(targetRepo);
  const scannedAt = new Date().toISOString();
  const hits: RepoIndexHit[] = [];
  const packageNames: string[] = [];
  const missingImports: RepoIndexResult["missingImports"] = [];
  const currencies = new Set<string>();
  const locales = new Set<string>();
  let usesMockData = false;

  if (!fs.existsSync(root)) {
    return {
      targetRepo: root,
      scannedAt,
      hits: [],
      packageNames: [],
      missingImports: [],
      currencies: [],
      locales: [],
      usesMockData: false,
    };
  }

  const allDeps = new Set<string>();
  const files: string[] = [];
  walk(root, files);

  // package.json / workspace
  for (const file of files) {
    const r = rel(root, file);
    const base = path.basename(file);
    if (base === "package.json") {
      hits.push({
        path: r,
        kind: "file",
        note: "package manifest",
        category: "package",
      });
      const { name, deps } = collectDeps(file);
      if (name) packageNames.push(name);
      for (const d of deps) allDeps.add(d);
      const raw = safeRead(file);
      if (/scripts/.test(raw)) {
        hits.push({
          path: r,
          kind: "file",
          note: "scripts present in package.json",
          category: "package",
        });
      }
    }
    if (/^(pnpm-workspace|lerna|nx|turbo)\.(yaml|yml|json)$/i.test(base)) {
      hits.push({
        path: r,
        kind: "file",
        note: "workspace / monorepo config",
        category: "workspace",
      });
    }
    if (/\.(sql)$/i.test(base) || /schema|migration|prisma/i.test(r)) {
      if (/\.(sql|prisma)$/i.test(base) || /schema/i.test(base)) {
        hits.push({
          path: r,
          kind: "file",
          note: "schema / migration artifact",
          category: "schema",
        });
      }
    }
    if (
      /(route|screen|pages?|app\/|navigation)/i.test(r) &&
      /\.(tsx?|jsx?)$/i.test(base)
    ) {
      hits.push({
        path: r,
        kind: "file",
        note: "route/screen module",
        category: "route",
      });
    }
    if (/mockData|mocks?\//i.test(r) || /^mock/i.test(base)) {
      usesMockData = true;
      hits.push({
        path: r,
        kind: "file",
        note: "mock data module",
        category: "mock",
      });
    }
  }

  // Import graph + env + currency/locale peeks
  for (const file of files) {
    if (!/\.(m?[jt]sx?|cjs|mjs)$/i.test(file)) continue;
    const r = rel(root, file);
    if (r.split("/").length > 8) continue;
    const sample = safeRead(file, 80_000);
    if (!sample) continue;

    if (/\bprocess\.env\.|EXPO_PUBLIC_|NEXT_PUBLIC_/i.test(sample)) {
      hits.push({
        path: r,
        kind: "file",
        note: "environment variable usage",
        category: "env",
      });
    }
    if (/mockData|MOCK_DATA|from ['"].*mock/i.test(sample)) {
      usesMockData = true;
      hits.push({
        path: r,
        kind: "file",
        note: "imports or references mock data",
        category: "mock",
      });
    }
    for (const code of sample.match(/\b(?:EGP|SAR|USD|EUR|AED|GBP)\b/g) || []) {
      currencies.add(code);
    }
    if (/ج\.?\s*م|£E|E£|LE\b/i.test(sample)) currencies.add("EGP");
    if (/ر\.?\s*س|﷼/i.test(sample)) currencies.add("SAR");
    for (const loc of sample.match(/\b(?:ar-EG|en-US|ar-SA|en-GB)\b/g) || []) {
      locales.add(loc);
    }
    if (/\blocale\s*[:=]\s*['"]ar/i.test(sample)) locales.add("ar");

    let m: RegExpExecArray | null;
    const re = new RegExp(IMPORT_RE.source, "g");
    while ((m = re.exec(sample))) {
      const spec = m[1];
      if (!isPackageSpecifier(spec)) continue;
      const rootName = packageRootName(spec);
      if (!allDeps.has(rootName) && !allDeps.has(spec)) {
        // Allow relative-like workspace packages that exist as folders
        const maybeLocal = path.join(root, "packages", rootName.replace(/^@[^/]+\//, ""));
        if (fs.existsSync(maybeLocal)) continue;
        missingImports.push({ file: r, specifier: spec });
        hits.push({
          path: r,
          kind: "finding",
          note: `imports '${spec}' but package not listed in dependencies`,
          category: "import_gap",
        });
      }
    }
  }

  // Dedup hits by path+note
  const byKey = new Map<string, RepoIndexHit>();
  for (const h of hits) {
    const k = `${h.path}::${h.note}`;
    if (!byKey.has(k)) byKey.set(k, h);
  }

  return {
    targetRepo: root,
    scannedAt,
    hits: [...byKey.values()].slice(0, 200),
    packageNames,
    missingImports: missingImports.slice(0, 80),
    currencies: [...currencies],
    locales: [...locales],
    usesMockData,
  };
}
