/**
 * Phase 11: end-to-end review-graph regression with stubbed LLM.
 * Strategist returns minimal prose; auditor APPROVEs only when the prompt
 * contains every Key Finding id + every REQ id/status and no placeholders.
 * Spendy-like fixture with ~70 REQs must reach APPROVED / gate OPEN in loop 1.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  __resetReviewGraphForTests,
  __setReviewInvokeForTests,
  runReviewGraph,
} from "../src/agency/reviewGraph.js";
import {
  __setPackWriteRootForTests,
  writePackArtifact,
} from "../src/lib/packWorkspace.js";
import { injectGroundedStrategyBlocks } from "../src/agency/finalReport.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "grounded-audit");
const SPENDY_REPO = path.join(FIX, "spendy-repo");
const SPENDY_SPEC = path.join(FIX, "spendy-spec");

const KEY_FINDING_IDS = [
  "DEP-_react_native_async_storage_async_storag",
  "DEP-_supabase_supabase_js",
  "AUTH-OTP",
  "UI-HANDLER-1",
  "MOCK-001",
  "STACK-001",
] as const;

function buildSeventyReqRows() {
  return Array.from({ length: 70 }, (_, i) => {
    const id = `REQ-${String(i + 1).padStart(3, "0")}`;
    const status =
      i % 11 === 0 ? "partial" : i % 17 === 0 ? "contradicts" : "missing";
    return {
      id,
      text: `Spendy wallet feature requirement ${i + 1}: support EGP flows and OTP auth`,
      status,
      codePaths:
        status === "missing" ? [] : ["src/screens/HomeScreen.js", "package.json"],
    };
  });
}

function buildSpendyLikeFindings() {
  return [
    {
      id: KEY_FINDING_IDS[0],
      category: "dependency",
      severity: "P0",
      summary:
        "Missing dependency '@react-native-async-storage/async-storage' in package.json",
      paths: ["package.json", "src/screens/HomeScreen.js"],
      detail: "Add async-storage to package.json",
    },
    {
      id: KEY_FINDING_IDS[1],
      category: "dependency",
      severity: "P0",
      summary: "Missing dependency '@supabase/supabase-js' in package.json",
      paths: ["package.json", "src/screens/HomeScreen.js"],
      detail: "Add supabase-js to package.json",
    },
    {
      id: "AUTH-OTP",
      category: "auth",
      severity: "P0",
      summary: "Spec requires OTP sign-in but no OTP flow found in code",
      paths: ["src/screens/HomeScreen.js"],
      detail: "Add OTP verification screens/handlers",
    },
    {
      id: "UI-HANDLER-1",
      category: "ui_handler",
      severity: "P0",
      summary: "<Pressable> without onPress/onClick in src/screens/HomeScreen.js:15",
      paths: ["src/screens/HomeScreen.js:15"],
      detail: "Wire Logout onPress",
    },
    {
      id: "MOCK-001",
      category: "mock_data",
      severity: "P0",
      summary: "Screens/data layer use mock data instead of a live backend",
      paths: ["src/data/mockData.js", "src/screens/HomeScreen.js"],
      detail: "Replace mockData with live API",
    },
      {
      id: "STACK-001",
      category: "stack_conflict",
      severity: "P0",
      summary:
        "Spec stack (expo, fastapi, flutter, supabase) conflicts with repo stack (react-native, supabase)",
      paths: ["package.json"],
      detail: "Align specs or migrate codebase",
    },
  ];
}

function hasPlaceholderLeak(text: string): boolean {
  return (
    /PROMPT_ONLY_DETERMINISTIC_SUMMARY/i.test(text) ||
    /Requirement Status List:/i.test(text) ||
    /Deterministic RTM\/Key Findings live in the written strategy file/i.test(
      text
    ) ||
    /full blocks are in ceo-draft\.md\s*[—\-]/i.test(text)
  );
}

describe("phase11 stubbed-LLM review graph — Spendy ~70 REQs APPROVED loop 1", () => {
  let tmpPack: string;
  let loopDir: string;
  let lastAuditorPrompt = "";

  beforeEach(() => {
    tmpPack = fs.mkdtempSync(path.join(os.tmpdir(), "sam-phase11-pack-"));
    loopDir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-phase11-loop-"));
    __setPackWriteRootForTests(tmpPack);
    __resetReviewGraphForTests();
    lastAuditorPrompt = "";

    writePackArtifact("evidence.json", JSON.stringify({ ok: true }, null, 2));
    writePackArtifact(
      "evidence-pack.md",
      [
        `# Evidence pack`,
        `Target: ${SPENDY_REPO}`,
        `Spec: ${SPENDY_SPEC}`,
        `Citable file hits: \`src/screens/HomeScreen.js\`, \`package.json\`, \`src/data/mockData.js\``,
        `Repo index: react-native + mock data`,
      ].join("\n")
    );
    writePackArtifact(
      "REQ_TRACEABILITY.md",
      `# REQ_TRACEABILITY\nSpendy fixture RTM placeholder for rubric artifacts.\n`
    );
  });

  afterEach(() => {
    __setReviewInvokeForTests(null);
    __resetReviewGraphForTests();
    __setPackWriteRootForTests(null);
    try {
      fs.rmSync(tmpPack, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(loopDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("reaches APPROVED gate OPEN in loop 1 when auditor sees full RTM + Key Findings", async () => {
    const reqRows = buildSeventyReqRows();
    const findings = buildSpendyLikeFindings();
    const codeBackedCount = reqRows.filter((r) =>
      /^(implemented|partial|contradicts)$/i.test(r.status)
    ).length;
    const eligibleCount = reqRows.length;
    const assessedCoverage = 1;
    const implementationCoverage = codeBackedCount / eligibleCount;

    const expectedFindingIds = findings.map((f) => f.id);
    const expectedReqTokens = reqRows.map((r) => ({
      id: r.id,
      status: r.status,
    }));

    __setReviewInvokeForTests(async (prompt, meta) => {
      const role = String(meta.role || "");
      if (role === "strategist") {
        // Minimal prose — deterministic RTM/Key Findings are injected by the graph
        return [
          `## Direct answer`,
          `Audit of Spendy at \`src/screens/HomeScreen.js\` against the product brief (EGP).`,
          `Stack conflict: spec wants Flutter + FastAPI; repo is React Native + Expo (\`package.json\`).`,
          ``,
          `## Current state vs gaps`,
          `- Missing deps @react-native-async-storage/async-storage and @supabase/supabase-js (see \`package.json\`).`,
          `- AUTH-OTP / OTP flow absent; Logout Pressable lacks onPress at \`src/screens/HomeScreen.js\`.`,
          `- MOCK-001: \`src/data/mockData.js\` still drives UI.`,
          ``,
          `## Recommendations`,
          `1. Install missing packages and wire OTP auth.`,
          `2. Add Logout onPress handler.`,
          `3. Replace mockData with live Supabase reads.`,
          `4. Align stack conflict (STACK-001) or update the brief.`,
        ].join("\n");
      }

      // Auditor: approve only when the prompt carries full grounded blocks
      lastAuditorPrompt = prompt;
      const missingFindings = expectedFindingIds.filter((id) => !prompt.includes(id));
      const missingReqs = expectedReqTokens.filter(
        (r) =>
          !prompt.includes(r.id) ||
          !new RegExp(
            `(\\|\\s*${r.id}\\s*\\|\\s*${r.status}\\b|${r.id}\\s*:\\s*\\*?\\*?${r.status})`,
            "i"
          ).test(prompt)
      );
      const placeholder = hasPlaceholderLeak(prompt);
      const hasRtm = /##\s*Requirements traceability \(deterministic\)/i.test(
        prompt
      );
      const hasFindings = /##\s*Key Findings\b/i.test(prompt);

      if (
        missingFindings.length ||
        missingReqs.length ||
        placeholder ||
        !hasRtm ||
        !hasFindings
      ) {
        return [
          `[REJECTED]`,
          `### Issue 1`,
          `- Rejection reason: Auditor prompt missing grounded RTM/Key Findings (findings=${missingFindings.join(",") || "ok"}; reqs=${missingReqs.map((r) => r.id).slice(0, 8).join(",") || "ok"}; placeholder=${placeholder}; rtm=${hasRtm}; kf=${hasFindings})`,
          `- Severity: Critical`,
          `- How to fix: Pass the same deterministic blocks as written ceo-draft.md`,
          `FIX 1: Restore injectGroundedStrategyBlocks into auditor-visible strategy`,
        ].join("\n");
      }
      return `[APPROVED]\nStrategy matches evidence; RTM and Key Findings present.`;
    });

    const evidenceMarkdown = [
      `# Evidence`,
      `Spec root: ${SPENDY_SPEC}`,
      `Citable file hits under TARGET REPO:`,
      `- \`src/screens/HomeScreen.js\``,
      `- \`src/data/mockData.js\``,
      `- \`package.json\``,
      `Repo index: react-native, mock data, missing async-storage + supabase-js`,
    ].join("\n");

    const out = await runReviewGraph({
      brief: `Audit Spendy wallet against product requirements. Currency EGP.`,
      evidenceMarkdown,
      loopDir,
      userGoal: `examine ${SPENDY_REPO} against ${SPENDY_SPEC}`,
      targetRepo: SPENDY_REPO,
      specRoot: SPENDY_SPEC,
      taskIntent: "audit",
      reqCoverage: assessedCoverage,
      assessedCoverage,
      implementationCoverage,
      eligibleCount,
      codeBackedCount,
      groundedCurrency: "EGP",
      specsReadCount: 2,
      reqRows,
      findings,
      runId: `phase11-${Date.now().toString(36)}`,
      threadId: `phase11-thread-${Date.now().toString(36)}`,
    });

    expect(lastAuditorPrompt.length).toBeGreaterThan(500);
    expect(lastAuditorPrompt).toMatch(
      /## Requirements traceability \(deterministic\)/
    );
    expect(lastAuditorPrompt).toMatch(/## Key Findings/);
    expect(hasPlaceholderLeak(lastAuditorPrompt)).toBe(false);
    for (const id of expectedFindingIds) {
      expect(lastAuditorPrompt).toContain(id);
    }
    for (const r of expectedReqTokens) {
      expect(lastAuditorPrompt).toContain(r.id);
    }

    // Written strategy equals auditor-visible deterministic blocks
    const written = injectGroundedStrategyBlocks(
      [
        `## Direct answer`,
        `Audit of Spendy at \`src/screens/HomeScreen.js\` against \`requirements.md\` (EGP).`,
      ].join("\n"),
      {
        checklistFindings: findings as any,
        reqRows,
        coverageRatio: implementationCoverage,
        assessedCoverageRatio: assessedCoverage,
        eligibleCount,
        codeBackedCount,
        assessedCount: eligibleCount,
        groundedCurrency: "EGP",
      }
    );
    for (const id of expectedFindingIds) {
      expect(out.strategy).toContain(id);
      expect(written).toContain(id);
    }
    for (const r of expectedReqTokens) {
      expect(out.strategy).toContain(r.id);
      expect(out.strategy).toMatch(
        new RegExp(`\\|\\s*${r.id}\\s*\\|\\s*${r.status}\\b`, "i")
      );
    }

    expect(out.auditPassed).toBe(true);
    expect(out.goalPassed).toBe(true);
    expect(out.loop).toBe(1);
    expect(out.auditReport).toMatch(/\[APPROVED\]/);
    expect(out.auditReport).toMatch(/gate:\s*OPEN/i);
  }, 60_000);
});
