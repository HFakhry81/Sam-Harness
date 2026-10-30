import "../lib/loadEnv.js";
import * as fs from "fs";
import * as path from "path";
import { ChatOllama } from "@langchain/ollama";
import {
  assertWithinCostCap,
  chargeCloudCall,
  CostCapExceededError,
  getCostBudget,
  getCostCapUsd,
} from "../lib/costLedger.js";
import { loadHybridProfile } from "../controlplane/hybridProfile.js";

export { CostCapExceededError };

/** Read at call-time so .env is never missed due to ESM import order. */
function ollamaApiKey(): string {
  return String(process.env.OLLAMA_API_KEY || "").trim();
}

function hybridForcesLocal(): boolean {
  if (String(process.env.FORCE_LOCAL_SPECIALISTS || "").trim() === "1") return true;
  const mode = String(process.env.HYBRID_MODE || "").trim().toLowerCase();
  if (mode === "local") return true;
  try {
    const p = path.join(process.cwd(), "hybrid-profile.json");
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as { mode?: string };
      if (String(j.mode || "").toLowerCase() === "local") return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function hybridMode(): "local" | "cloud" | "auto" {
  const env = String(process.env.HYBRID_MODE || "").trim().toLowerCase();
  if (env === "local" || env === "cloud" || env === "auto") return env;
  try {
    return loadHybridProfile(process.cwd()).mode;
  } catch {
    return "auto";
  }
}

/** True when daily spend has reached the configured cost cap. */
export function isCostCapExhausted(cwd: string = process.cwd()): boolean {
  const budget = getCostBudget(cwd);
  return budget.blocked;
}

/**
 * Whether cloud specialists may be used right now.
 * Respects FORCE_LOCAL / hybrid local mode / missing key / exhausted cost cap.
 */
export function useOllamaCloudNow(): boolean {
  if (hybridForcesLocal()) return false;
  if (!ollamaApiKey()) return false;
  if (isCostCapExhausted()) return false;
  return true;
}

/** @deprecated prefer useOllamaCloudNow() — kept for existing imports */
export const useOllamaCloud = useOllamaCloudNow();

function cloudConfig() {
  return {
    baseUrl: "https://ollama.com",
    headers: { Authorization: `Bearer ${ollamaApiKey()}` },
  };
}

const local = { baseUrl: "http://localhost:11434" };

/** Local/fast model for CEO routing & short drafts */
export function makeCeoModel() {
  return new ChatOllama({
    ...local,
    model: process.env.CEO_MODEL || "qwen2.5-coder:1.5b",
    temperature: 0.1,
    think: false,
    numPredict: 900,
    numCtx: 4096,
  });
}

/**
 * Cloud (or local fallback) for heavy specialist agents.
 * When hybrid mode is `cloud` and the daily cost cap is exhausted, throws CostCapExceededError.
 * When mode is `auto`, falls back to local once the cap is hit.
 */
export function makeSpecialistModel(opts: {
  cloudModel: string;
  localModel: string;
  temperature: number;
  numPredict?: number;
  /** Force local even if API key present (TLS / offline recovery) */
  forceLocal?: boolean;
}) {
  const cwd = process.cwd();
  const wantCloud = !opts.forceLocal && Boolean(ollamaApiKey()) && !hybridForcesLocal();
  let cloud = wantCloud && useOllamaCloudNow();

  if (wantCloud && !cloud) {
    const mode = hybridMode();
    const budget = getCostBudget(cwd);
    if (budget.blocked) {
      if (mode === "cloud") {
        throw new CostCapExceededError(
          budget.blockReason ||
            `Cost cap exceeded ($${budget.spentUsd} / $${budget.capUsd}). Cloud specialists are blocked.`,
          budget.spentUsd,
          budget.capUsd
        );
      }
      // auto/local: stay on local
      cloud = false;
    }
  }

  // Cap of $0 (or exhausted) must never open a cloud client
  if (cloud) {
    assertWithinCostCap(cwd, 0);
  }

  return new ChatOllama({
    ...(cloud ? cloudConfig() : local),
    model: cloud ? opts.cloudModel : opts.localModel,
    temperature: opts.temperature,
    think: false,
    numPredict: opts.numPredict ?? 1200,
    numCtx: 8192,
  });
}

export function isTlsOrFetchError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  const cause = String((err as any)?.cause?.message || (err as any)?.cause || "");
  const code = String((err as any)?.cause?.code || (err as any)?.code || "");
  return /fetch failed|UNABLE_TO_VERIFY|CERT|TLS|ECONNREFUSED|ENOTFOUND|certificate/i.test(
    `${msg} ${cause} ${code}`
  );
}

export function specialistLabel(cloudName: string, localName: string) {
  return useOllamaCloudNow()
    ? `Cloud (${cloudName})`
    : `Local (${localName})`;
}

/**
 * Invoke a model and charge the daily ledger when the active specialist is cloud.
 */
export async function invokeTracked(
  model: { invoke: (prompt: string) => Promise<{ content?: unknown }> },
  prompt: string,
  meta: { modelName: string; cloud?: boolean }
): Promise<string> {
  const cwd = process.cwd();
  const cloud = meta.cloud ?? useOllamaCloudNow();
  if (cloud) {
    // Pre-check with a prompt-based estimate so we fail before the network call
    const estChars = String(prompt || "").length;
    const { estimateCloudCallUsd } = await import("../lib/costLedger.js");
    assertWithinCostCap(cwd, estimateCloudCallUsd(meta.modelName, estChars, 600));
  }
  const res = await model.invoke(prompt);
  const text = String(res.content || "");
  if (cloud) {
    chargeCloudCall(cwd, { model: meta.modelName, prompt, output: text });
  }
  return text;
}

/** Snapshot for UI / API */
export function costStatus(cwd: string = process.cwd()) {
  const budget = getCostBudget(cwd);
  return {
    ...budget,
    capUsd: getCostCapUsd(cwd),
  };
}
