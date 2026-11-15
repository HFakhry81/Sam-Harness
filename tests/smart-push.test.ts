import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fillPullRequestTemplate,
  markPullRequestChecksGreen,
  validateBranchProtection,
} from "../scripts/git/smart-push.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = fs.readFileSync(
  path.join(root, ".github", "PULL_REQUEST_TEMPLATE.md"),
  "utf8"
);

describe("smart push pull request tracking", () => {
  it("fills the repository template and leaves CI unchecked until GitHub confirms it", () => {
    const body = fillPullRequestTemplate(template, {
      summary: "Add the shared auditor skill.",
      testPlan: "`pnpm typecheck` and `pnpm test` passed locally.",
      localChecksPassed: true,
    });

    expect(body).toContain("## Summary\n\n- Add the shared auditor skill.");
    expect(body).toContain("- [x] Branch name matches");
    expect(body).toContain("- [x] This PR targets **`staging`**");
    expect(body).toContain("- [ ] CI green:");
    expect(body).toContain("- [x] `pnpm typecheck` and `pnpm test` passed locally.");
  });

  it("records the staging-to-main release exception and marks required checks green", () => {
    const body = fillPullRequestTemplate(template, {
      summary: "Release staging to main.",
      testPlan: "Required GitHub checks: status is being tracked.",
      release: true,
    });
    const checked = markPullRequestChecksGreen(body);

    expect(body).toContain("release exception: `staging` is the required head");
    expect(body).toContain("- [ ] Required GitHub checks: status is being tracked.");
    expect(checked).toContain("- [x] CI green:");
    expect(checked).toContain("- [x] Required GitHub checks: status is being tracked.");
    expect(markPullRequestChecksGreen(checked)).toBe(checked);
  });

  it("refuses auto-merge when a required branch protection is missing", () => {
    const protection = {
      strict: true,
      checks: ["quality (ubuntu-latest)", "quality (windows-latest)"],
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
    };

    expect(() => validateBranchProtection("staging", protection)).toThrow(/branch-flow/);
    expect(() =>
      validateBranchProtection("staging", {
        ...protection,
        checks: [...protection.checks, "branch-flow"],
      })
    ).not.toThrow();
  });
});
