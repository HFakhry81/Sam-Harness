import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const skillName = "hybrid-project-auditor";
const skillSource = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills",
  skillName,
  "SKILL.md"
);

export const globalSkillLocations = [
  { platform: "Agent Skills (shared)", directory: ".agents/skills" },
  { platform: "GitHub Copilot", directory: ".copilot/skills" },
  { platform: "Google Antigravity", directory: path.join(".gemini", "config", "skills") },
  { platform: "Gemini CLI", directory: ".gemini/skills" },
  { platform: "Claude Code", directory: ".claude/skills" },
  { platform: "Cursor", directory: ".cursor/skills" },
  { platform: "OpenCode", directory: path.join(".config", "opencode", "skills") },
  { platform: "OpenAI Codex", directory: path.join(".codex", "skills") },
] as const;

export function installGlobalSkill(home: string, force = false): string[] {
  const contents = fs.readFileSync(skillSource, "utf8");
  const targets = globalSkillLocations.map(({ directory }) =>
    path.join(home, directory, skillName, "SKILL.md")
  );
  const conflicts = targets.filter(
    (target) => fs.existsSync(target) && fs.readFileSync(target, "utf8") !== contents
  );

  if (conflicts.length > 0 && !force) {
    throw new Error(
      [
        "A different skill with this name already exists:",
        ...conflicts.map((target) => `  ${target}`),
        "Review it or rerun with --force to replace only this skill's SKILL.md.",
      ].join("\n")
    );
  }

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== contents) {
      fs.writeFileSync(target, contents, "utf8");
    }
  }

  return targets;
}

function main(args: string[]): void {
  let home = os.homedir();
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--home") {
      const value = args[index + 1];
      if (!value) throw new Error("--home requires a directory path.");
      home = path.resolve(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: pnpm run skill:install [--force] [--home <directory>]\n" +
          "Installs the shared skill into supported user-level Agent Skills folders."
      );
      return;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const installed = installGlobalSkill(home, force);
  for (const target of installed) console.log(`[OK] ${target}`);
  console.log(`Installed ${skillName} for ${installed.length} platform locations.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
