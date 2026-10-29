import "../lib/loadEnv.js";
import * as fs from "fs";
import * as path from "path";
import { ChatOllama } from "@langchain/ollama";

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

export function useOllamaCloudNow(): boolean {
  if (hybridForcesLocal()) return false;
  return Boolean(ollamaApiKey());
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

/** Cloud (or local fallback) for heavy specialist agents */
export function makeSpecialistModel(opts: {
  cloudModel: string;
  localModel: string;
  temperature: number;
  numPredict?: number;
  /** Force local even if API key present (TLS / offline recovery) */
  forceLocal?: boolean;
}) {
  const cloud = !opts.forceLocal && useOllamaCloudNow();
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
