/**
 * Phase 7 — Arabic-first i18n, RTL helpers, doctor, install (no network).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARABIC_INTENT_CUES,
  assertTranslationCoverage,
  catalogKeys,
  containsArabicScript,
  detectTextLocale,
  dirForLocale,
  formatNumber,
  getLocalePayload,
  getMessages,
  htmlDirAttrs,
  languageSystemDirective,
  loadLocaleConfig,
  matchesArabicIntent,
  missingTranslationKeys,
  parseAppLocale,
  renderLocalizedDocument,
  rtlLogicalHints,
  t,
  toEasternNumerals,
  toWesternNumerals,
  withLanguageDirective,
  wrapRtlText,
} from "../src/lib/i18n/index.js";
import {
  formatDoctorReport,
  runDoctor,
} from "../src/lib/doctor/index.js";
import {
  createEnvFromExample,
  defaultOutputHomePath,
  describeStartupRegistration,
  removeInstallMarker,
  setupOutputHome,
  uninstallLocal,
  writeInstallMarker,
} from "../src/lib/install/index.js";
import { detectOpsIntent } from "../src/agent/heuristic.js";
import { detectRoute } from "../src/controlplane/taskSpec.js";

const envKeys = [
  "SAM_LOCALE",
  "SAM_UI_LOCALE",
  "SAM_CONTENT_LOCALE",
  "SAM_NUMERALS",
  "SAM_EGYPTIAN_FRIENDLY",
  "SAM_OUTPUT_HOME",
] as const;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of envKeys) {
    prevEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of envKeys) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
});

describe("i18n catalogs", () => {
  it("has identical keys in ar and en (no missing translations)", () => {
    const gap = missingTranslationKeys();
    expect(gap.missingInAr).toEqual([]);
    expect(gap.missingInEn).toEqual([]);
    expect(() => assertTranslationCoverage()).not.toThrow();
    expect(catalogKeys("ar").length).toBeGreaterThan(40);
    expect(catalogKeys("ar")).toEqual(catalogKeys("en"));
  });

  it("defaults to Arabic locale with RTL", () => {
    const cfg = loadLocaleConfig({});
    expect(cfg.locale).toBe("ar");
    expect(cfg.dir).toBe("rtl");
    expect(cfg.lang).toBe("ar-EG");
    expect(cfg.numerals).toBe("eastern");
    expect(dirForLocale("ar")).toBe("rtl");
    expect(dirForLocale("en")).toBe("ltr");
    expect(htmlDirAttrs("ar")).toEqual({ lang: "ar-EG", dir: "rtl" });
  });

  it("respects SAM_LOCALE / SAM_NUMERALS env", () => {
    const cfg = loadLocaleConfig({
      SAM_LOCALE: "en",
      SAM_NUMERALS: "western",
    });
    expect(cfg.locale).toBe("en");
    expect(cfg.dir).toBe("ltr");
    expect(cfg.numerals).toBe("western");
  });

  it("t() falls back to English when Arabic key somehow missing path uses catalog", () => {
    process.env.SAM_LOCALE = "ar";
    expect(t("nav.compose")).toMatch(/مهمة/);
    expect(t("nav.compose", { locale: "en" })).toBe("Task");
    expect(t("cost.ok", { locale: "en", vars: { spent: "0.1", cap: "0.5", remaining: "0.4" } })).toContain(
      "0.1"
    );
  });

  it("getLocalePayload exposes messages for UI", () => {
    const payload = getLocalePayload({ SAM_LOCALE: "ar" });
    expect(payload.locale).toBe("ar");
    expect(payload.messages["brand.name"]).toBe("Sam-Harness");
    expect(getMessages("en")["login.submit"]).toBe("Sign in");
  });
});

describe("RTL + numerals helpers", () => {
  it("wraps RTL text and detects Arabic script", () => {
    expect(containsArabicScript("اعمل ملف")).toBe(true);
    expect(detectTextLocale("اعمل ملف على Desktop")).toBe("mixed");
    expect(detectTextLocale("create a file")).toBe("en");
    expect(wrapRtlText("مرحبا", "ar")).toContain("مرحبا");
    expect(rtlLogicalHints()["text-align-start"]).toContain("start");
  });

  it("converts eastern/western numerals", () => {
    expect(toEasternNumerals("2026")).toBe("٢٠٢٦");
    expect(toWesternNumerals("٢٠٢٦")).toBe("2026");
    expect(formatNumber(42, { numerals: "eastern" })).toBe("٤٢");
    expect(formatNumber("٤٢", { numerals: "western" })).toBe("42");
  });

  it("renders Arabic document wrapper with RTL preamble", () => {
    process.env.SAM_CONTENT_LOCALE = "ar";
    process.env.SAM_NUMERALS = "eastern";
    const doc = renderLocalizedDocument("## قسم\nالنص 12", { title: "تقرير" });
    expect(doc).toContain('dir="rtl"');
    expect(doc).toContain("lang=\"ar-EG\"");
    expect(doc).toContain("١٢");
  });
});

describe("Arabic intent + agent language directive", () => {
  it("matches Egyptian/MSA intent cues", () => {
    expect(matchesArabicIntent("سوّي ملف جديد", "create_file")).toBe(true);
    expect(matchesArabicIntent("شيل الملف ده", "delete_file")).toBe(true);
    expect(matchesArabicIntent("انقل التقرير للمكتب", "move_file")).toBe(true);
    expect(ARABIC_INTENT_CUES.analyze.length).toBeGreaterThan(2);
  });

  it("classifies Egyptian create/delete via heuristic + route", () => {
    expect(detectOpsIntent("سوّي ملف نصي على سطح المكتب")).toBe("write_file");
    expect(detectOpsIntent("شيل الملف القديم من سطح المكتب")).toBe("delete");
    expect(detectRoute("سوّي ملف Excel على سطح المكتب")).toBe("operational");
  });

  it("injects Arabic language directive by default", () => {
    process.env.SAM_CONTENT_LOCALE = "ar";
    const d = languageSystemDirective({ locale: "ar" });
    expect(d).toMatch(/العربية|Language/);
    const wrapped = withLanguageDirective("Do the task", {
      userText: "حلّل النظام واكتب تقرير",
    });
    expect(wrapped).toContain("Do the task");
    expect(wrapped.toLowerCase()).toMatch(/language|اللغة/);
  });

  it("parseAppLocale accepts aliases", () => {
    expect(parseAppLocale("arabic")).toBe("ar");
    expect(parseAppLocale("English")).toBe("en");
    expect(parseAppLocale("nope", "ar")).toBe("ar");
  });
});

describe("doctor", () => {
  it("runs offline and reports locale + node", () => {
    const report = runDoctor({
      cwd: process.cwd(),
      env: { ...process.env, SAM_LOCALE: "ar" },
    });
    expect(report.checks.find((c) => c.id === "node")?.severity).toBe("ok");
    expect(report.checks.find((c) => c.id === "locale")?.severity).toBe("ok");
    expect(report.checks.find((c) => c.id === "ollama")?.severity).toBe("ok");
    const text = formatDoctorReport(report);
    expect(text).toMatch(/Sam-Harness doctor/);
  });
});

describe("install helpers", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sh-install-"));
    fs.writeFileSync(
      path.join(tmp, ".env.example"),
      ["# example", "SAM_LOCALE=", "CONTROL_PLANE_PORT=8787", "SAM_OUTPUT_HOME=", ""].join(
        "\n"
      ),
      "utf-8"
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates .env from example idempotently with Arabic defaults", () => {
    const r1 = createEnvFromExample(tmp, {
      prompts: [
        { key: "SAM_LOCALE", value: "ar" },
        { key: "SAM_NUMERALS", value: "eastern" },
      ],
    });
    expect(r1.created).toBe(true);
    expect(fs.existsSync(r1.path)).toBe(true);
    const body = fs.readFileSync(r1.path, "utf-8");
    expect(body).toMatch(/SAM_LOCALE=ar/);
    expect(body).toMatch(/SAM_OUTPUT_HOME=/);

    const r2 = createEnvFromExample(tmp, {
      prompts: [{ key: "SAM_LOCALE", value: "en" }],
    });
    expect(r2.created).toBe(false);
    // does not clobber non-empty locale without force
    expect(fs.readFileSync(r1.path, "utf-8")).toMatch(/SAM_LOCALE=ar/);
  });

  it("sets up output home and install marker; uninstall removes marker", () => {
    const home = path.join(tmp, "Sam-Out");
    process.env.SAM_OUTPUT_HOME = home;
    const layout = setupOutputHome({ SAM_OUTPUT_HOME: home });
    expect(fs.existsSync(layout.reports)).toBe(true);
    expect(fs.existsSync(layout.documents)).toBe(true);

    const marker = writeInstallMarker(tmp, { locale: "ar" });
    expect(fs.existsSync(marker)).toBe(true);

    const un = uninstallLocal({ cwd: tmp });
    expect(un.removed).toContain(".sam-harness-installed");
    expect(removeInstallMarker(tmp)).toBe(false);

    expect(defaultOutputHomePath("C:\\Users\\x")).toMatch(/Sam-Harness/);
  });

  it("describes startup registration per platform without executing", () => {
    const win = describeStartupRegistration({
      platform: "win32",
      projectDir: tmp,
      enable: true,
    });
    expect(win.kind).toBe("scheduled-task");
    expect(win.commandHint).toMatch(/schtasks/i);

    const mac = describeStartupRegistration({
      platform: "darwin",
      enable: false,
    });
    expect(mac.kind).toBe("launch-agent");

    const linux = describeStartupRegistration({
      platform: "linux",
      enable: true,
    });
    expect(linux.kind).toBe("systemd-user");
  });
});
