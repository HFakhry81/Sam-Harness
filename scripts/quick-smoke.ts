/**
 * Opt-in live smoke for the quick/web path.
 * Usage: pnpm run quick:smoke -- "اهلا"
 *        pnpm run quick:smoke -- "ابحث على النت عن آخر أخبار Ollama"
 *
 * Requires network for web path and a local Ollama for model calls.
 * Empty web evidence never calls the model (prints skippedModel).
 */
import "../src/lib/loadEnv.js";
import { tryRunQuickPath, classifyIntentHeuristic } from "../src/lib/quickPath/index.js";

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const prompt = argv.join(" ").trim() || "hello";
  const heuristic = classifyIntentHeuristic(prompt);
  console.log(
    JSON.stringify(
      {
        prompt,
        predicted: {
          intent: heuristic.intent,
          replyPath: heuristic.replyPath,
          confidence: heuristic.confidence,
          reason: heuristic.reason,
        },
      },
      null,
      2
    )
  );

  const out = await tryRunQuickPath({
    prompt,
    cwd: process.cwd(),
    heuristicOnly: false,
    onEvent: (ev) => {
      console.error(`[event] ${ev.type}: ${ev.message}`);
    },
  });

  if (!out) {
    console.log(
      JSON.stringify(
        {
          path: "agency",
          model: null,
          ms: 0,
          reply: null,
          sources: [],
          note: "classifier chose agency — no quick/web run",
        },
        null,
        2
      )
    );
    process.exitCode = 0;
    return;
  }

  const { result } = out;
  console.log(
    JSON.stringify(
      {
        path: result.replyPath,
        intent: result.intent,
        model: result.model || null,
        ms: result.durationMs,
        ok: result.ok,
        skippedModel: Boolean(result.skippedModel),
        searchFailureReason: result.searchFailureReason || null,
        reply: result.reply,
        sources: result.sources || [],
        error: result.error || null,
      },
      null,
      2
    )
  );
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
