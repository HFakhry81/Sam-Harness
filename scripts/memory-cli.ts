#!/usr/bin/env tsx
/**
 * Self-learning memory CLI — list / show / prune under SAM_OUTPUT_HOME/memory/.
 *
 * Usage:
 *   pnpm run memory -- list
 *   pnpm run memory -- list lessons
 *   pnpm run memory -- show <id>
 *   pnpm run memory -- prune [--min-hits N] [--kind lesson|skill]
 *   pnpm run memory -- promote
 *   pnpm run memory -- stats
 *
 * All console output is English-only ASCII.
 */
import "../src/lib/loadEnv.js";
import {
  findEntryById,
  getMemoryDir,
  listAllEntries,
  loadMemoryFile,
  loadPromotedRules,
  promoteEligibleLessons,
  pruneMemory,
  type MemoryKind,
} from "../src/memory/index.js";
import { getOutputHome } from "../src/lib/outputHome.js";

function usage(): never {
  console.log(`Sam-Harness memory CLI (self-learning)

Commands:
  list [lessons|skills|all]   List memory entries (default: all)
  show <id>                   Show one entry as JSON
  prune [--min-hits N] [--kind lesson|skill]
                              Remove low-hit unpromoted entries (default min-hits=1 keeps all with hits>=1;
                              use --min-hits 2 to drop single-hit noise)
  promote                     Promote recurring expressible lessons to pre-check rules
  stats                       Summary counts
  path                        Print memory directory path

Store: <SAM_OUTPUT_HOME>/memory/ (lessons.json, skills.json, promoted-rules.json)
`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  cmd: string;
  rest: string[];
  minHits: number;
  kind?: MemoryKind;
} {
  // pnpm may forward a literal "--" separator into argv
  const args = [...argv].filter((a, i) => !(i === 0 && a === "--"));
  while (args[0] === "--") args.shift();
  const cmd = (args.shift() || "").toLowerCase();
  let minHits = 2;
  let kind: MemoryKind | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--min-hits" || a === "--minHits") {
      minHits = Math.max(1, Number(args[++i]) || 2);
    } else if (a === "--kind") {
      const k = String(args[++i] || "").toLowerCase();
      if (k === "lesson" || k === "skill") kind = k;
    } else {
      rest.push(a);
    }
  }
  return { cmd, rest, minHits, kind };
}

function main(): void {
  const { cmd, rest, minHits, kind } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") usage();

  if (cmd === "path") {
    console.log(getMemoryDir());
    return;
  }

  if (cmd === "stats") {
    const lessons = loadMemoryFile("lesson").entries;
    const skills = loadMemoryFile("skill").entries;
    const rules = loadPromotedRules().rules;
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputHome: getOutputHome(),
          memoryDir: getMemoryDir(),
          lessons: lessons.length,
          skills: skills.length,
          promotedRules: rules.length,
          promotedLessons: lessons.filter((e) => e.promoted).length,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "list") {
    const filter = (rest[0] || "all").toLowerCase();
    let entries = listAllEntries();
    if (filter === "lessons" || filter === "lesson") {
      entries = entries.filter((e) => e.kind === "lesson");
    } else if (filter === "skills" || filter === "skill") {
      entries = entries.filter((e) => e.kind === "skill");
    }
    const rows = entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      hits: e.hitCount,
      ok: e.successCount,
      fail: e.failureCount,
      promoted: Boolean(e.promoted),
      parentId: e.parentId || null,
      tags: e.tags.slice(0, 8),
      text: e.text.length > 100 ? e.text.slice(0, 97) + "..." : e.text,
    }));
    console.log(
      JSON.stringify({ ok: true, count: rows.length, entries: rows }, null, 2)
    );
    return;
  }

  if (cmd === "show") {
    const id = rest[0];
    if (!id) {
      console.error("Usage: pnpm run memory -- show <id>");
      process.exit(1);
    }
    const entry = findEntryById(id);
    if (!entry) {
      console.error(JSON.stringify({ ok: false, error: "not found", id }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, entry }, null, 2));
    return;
  }

  if (cmd === "prune") {
    const result = pruneMemory({ minHits, kind });
    console.log(
      JSON.stringify(
        { ok: true, minHits, kind: kind || "all", ...result },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "promote") {
    const created = promoteEligibleLessons();
    console.log(
      JSON.stringify(
        {
          ok: true,
          promoted: created.length,
          rules: created.map((r) => ({
            id: r.id,
            pattern: r.pattern,
            fromLessonId: r.fromLessonId,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  usage();
}

main();
