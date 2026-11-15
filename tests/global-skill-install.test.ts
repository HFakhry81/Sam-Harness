import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { globalSkillLocations, installGlobalSkill } from "../scripts/install-global-skill.js";

const tempHomes: string[] = [];

function createHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sam-global-skill-"));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

describe("global skill installer", () => {
  it("installs the canonical skill into each supported user-level location", () => {
    const home = createHome();
    const targets = installGlobalSkill(home);
    const source = fs.readFileSync(
      path.resolve("skills", "hybrid-project-auditor", "SKILL.md"),
      "utf8"
    );

    expect(targets).toHaveLength(globalSkillLocations.length);
    for (const target of targets) {
      expect(fs.readFileSync(target, "utf8")).toBe(source);
    }
  });

  it("refuses to overwrite a conflicting skill unless forced", () => {
    const home = createHome();
    const conflict = path.join(
      home,
      globalSkillLocations[0].directory,
      "hybrid-project-auditor",
      "SKILL.md"
    );
    fs.mkdirSync(path.dirname(conflict), { recursive: true });
    fs.writeFileSync(conflict, "user customization\n", "utf8");

    expect(() => installGlobalSkill(home)).toThrow(/--force/);
    expect(() => fs.readFileSync(
      path.join(
        home,
        globalSkillLocations[1].directory,
        "hybrid-project-auditor",
        "SKILL.md"
      ),
      "utf8"
    )).toThrow();

    installGlobalSkill(home, true);
    expect(fs.readFileSync(conflict, "utf8")).toContain("name: hybrid-project-auditor");
  });
});
