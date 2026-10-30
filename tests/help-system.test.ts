/**
 * Help system: docs index integrity, bilingual topics, CLI answer, API surface.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import {
  HELP_TOPIC_IDS,
  answerHelpQuery,
  detectHelpIntent,
  exportAllHelp,
  listHelpIndex,
  loadHelpDoc,
  markdownToHtml,
  resolveTopicId,
  searchHelp,
  verifyHelpIntegrity,
} from "../src/lib/help/index.js";

const ROOT = process.cwd();

describe("Help docs integrity", () => {
  it("every catalog topic exists in ar and en with non-empty body", () => {
    const result = verifyHelpIntegrity(ROOT);
    expect(result.issues, JSON.stringify(result.issues, null, 2)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.topics.length).toBeGreaterThanOrEqual(14);
  });

  it("ar and en indexes list the same topic ids in catalog order", () => {
    const ar = listHelpIndex("ar", ROOT).map((t) => t.id);
    const en = listHelpIndex("en", ROOT).map((t) => t.id);
    expect(ar).toEqual(en);
    expect(new Set(ar)).toEqual(new Set(HELP_TOPIC_IDS));
    expect(ar[0]).toBe("index");
  });

  it("loads workflow topic with mermaid in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const doc = loadHelpDoc("workflow", locale, ROOT);
      expect(doc.body).toMatch(/mermaid/);
      expect(doc.body.length).toBeGreaterThan(200);
      expect(markdownToHtml(doc.body)).toMatch(/<h1>|<h2>/);
    }
  });

  it("resolveTopicId understands aliases", () => {
    expect(resolveTopicId("roles")).toBe("workflow");
    expect(resolveTopicId("hybrid")).toBe("hybrid-mode");
    expect(resolveTopicId("doctor")).toBe("troubleshooting");
  });
});

describe("Help search & answer", () => {
  it("detects help intents in Arabic and English", () => {
    expect(detectHelpIntent("help")).toBe(true);
    expect(detectHelpIntent("مساعدة")).toBe(true);
    expect(detectHelpIntent("pnpm run help workflow")).toBe(true);
    expect(detectHelpIntent("انقل الملف إلى سطح المكتب")).toBe(false);
  });

  it("answers cost / hybrid queries from docs", () => {
    const ar = answerHelpQuery({ query: "سقف التكلفة 0.50", locale: "ar", cwd: ROOT });
    expect(ar.ok).toBe(true);
    expect(["hybrid-mode", "cost", "index"]).toContain(ar.topicId);
    expect(ar.body.length).toBeGreaterThan(40);

    const en = answerHelpQuery({ query: "daily cost cap near-cap", locale: "en", cwd: ROOT });
    expect(en.ok).toBe(true);
    expect(en.body.toLowerCase()).toMatch(/0\.50|cap|hybrid|cost/);
  });

  it("search returns ranked hits", () => {
    const hits = searchHelp({ query: "desktop UIA windows", locale: "en", cwd: ROOT });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("desktop-control");
  });
});

describe("Help export", () => {
  it("writes HTML, print HTML, and markdown bundle per locale", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-help-export-"));
    const prev = process.env.SAM_OUTPUT_HOME;
    process.env.SAM_OUTPUT_HOME = tmp;
    try {
      const results = exportAllHelp({ cwd: ROOT });
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r.integrityOk).toBe(true);
        expect(fs.existsSync(path.join(r.documentsDir, "index.html"))).toBe(true);
        expect(fs.existsSync(path.join(r.documentsDir, "HELP_PRINT.html"))).toBe(true);
        expect(fs.existsSync(path.join(r.documentsDir, "HELP_BUNDLE.md"))).toBe(true);
        expect(fs.existsSync(path.join(r.distDir, "manifest.json"))).toBe(true);
        const html = fs.readFileSync(path.join(r.documentsDir, "index.html"), "utf-8");
        expect(html).toMatch(/Sam-Harness/);
        expect(html).toMatch(/dir="(rtl|ltr)"/);
      }
    } finally {
      if (prev === undefined) delete process.env.SAM_OUTPUT_HOME;
      else process.env.SAM_OUTPUT_HOME = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Help CLI", () => {
  it("pnpm run help --check exits 0", async () => {
    const { spawnSync } = await import("child_process");
    const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const res = spawnSync(process.execPath, [tsxBin, path.join(ROOT, "scripts/help.ts"), "--check"], {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env },
    });
    expect(res.status).toBe(0);
    expect(res.stdout || "").toMatch(/OK/i);
  });

  it("pnpm run help workflow prints content", async () => {
    const { spawnSync } = await import("child_process");
    const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const res = spawnSync(
      process.execPath,
      [tsxBin, path.join(ROOT, "scripts/help.ts"), "--locale", "en", "workflow"],
      { cwd: ROOT, encoding: "utf-8", env: { ...process.env } }
    );
    expect(res.status).toBe(0);
    expect(res.stdout || "").toMatch(/Workflow|LangGraph|roles/i);
  });
});

describe("Help API", () => {
  const PORT = 18797;
  const TOKEN = "help-system-test-token-0123456789abcdef";
  let child: ChildProcess | null = null;

  beforeAll(async () => {
    const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    child = spawn(process.execPath, [tsxBin, path.join(ROOT, "src/controlplane/server.ts")], {
      cwd: ROOT,
      env: {
        ...process.env,
        CONTROL_PLANE_PORT: String(PORT),
        CONTROL_PLANE_TOKEN: TOKEN,
        CONTROL_PLANE_NO_BROWSER: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const start = Date.now();
    while (Date.now() - start < 20000) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/help`);
        if (res.ok) return;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("Control Plane help API did not become ready");
  }, 30000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  });

  it("GET /api/help lists topics without auth", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/help?locale=en`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.topics.length).toBeGreaterThanOrEqual(14);
    expect(body.topics.some((t: { id: string }) => t.id === "workflow")).toBe(true);
  });

  it("GET /api/help/workflow returns html", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/help/workflow?locale=ar`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.topic.id).toBe("workflow");
    expect(body.topic.html).toMatch(/<h1>|<h2>|<pre/);
  });

  it("GET /api/help?q= searches", async () => {
    const res = await fetch(
      `http://127.0.0.1:${PORT}/api/help?locale=en&q=${encodeURIComponent("cost cap")}`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hits.length).toBeGreaterThan(0);
  });
});
