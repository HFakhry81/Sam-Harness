import { loadCostOptConfig } from "./cost/config.js";

export type OllamaModelInfo = {
  name: string;
  size?: number;
  modifiedAt?: string;
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
};

type OllamaTagsResponse = { models?: Array<Record<string, unknown>> };

const MODEL_CACHE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;
const cache = new Map<string, { expiresAt: number; models: OllamaModelInfo[] }>();

function apiBase(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Ollama base URL must use HTTP or HTTPS");
  }
  parsed.pathname = parsed.pathname.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function modelName(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Ollama returned a model without a valid name");
  }
  return raw.trim();
}

async function requestJson<T>(baseUrl: string, endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase(baseUrl)}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Ollama ${endpoint} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await response.json()) as T;
}

function parseTags(payload: OllamaTagsResponse): OllamaModelInfo[] {
  if (!Array.isArray(payload.models)) {
    throw new Error("Ollama /api/tags response has no models array");
  }
  return payload.models.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Ollama /api/tags response contains an invalid model");
    }
    const details =
      raw.details && typeof raw.details === "object"
        ? (raw.details as Record<string, unknown>)
        : {};
    return {
      name: modelName(raw.name || raw.model),
      ...(typeof raw.size === "number" ? { size: raw.size } : {}),
      ...(typeof raw.modified_at === "string" ? { modifiedAt: raw.modified_at } : {}),
      ...(typeof details.family === "string" ? { family: details.family } : {}),
      ...(typeof details.parameter_size === "string"
        ? { parameterSize: details.parameter_size }
        : {}),
      ...(typeof details.quantization_level === "string"
        ? { quantizationLevel: details.quantization_level }
        : {}),
    };
  });
}

export function ollamaModelNamesMatch(left: string, right: string): boolean {
  const canonical = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    return trimmed.includes(":") ? trimmed : `${trimmed}:latest`;
  };
  return canonical(left) === canonical(right);
}

export async function listLocalOllamaModels(opts: {
  baseUrl?: string;
  refresh?: boolean;
} = {}): Promise<OllamaModelInfo[]> {
  const baseUrl = opts.baseUrl || loadCostOptConfig().localBaseUrl;
  const key = apiBase(baseUrl);
  const cached = cache.get(key);
  if (!opts.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.models.map((model) => ({ ...model }));
  }
  const payload = await requestJson<OllamaTagsResponse>(key, "/api/tags");
  const models = parseTags(payload);
  cache.set(key, { expiresAt: Date.now() + MODEL_CACHE_MS, models });
  return models.map((model) => ({ ...model }));
}

export async function inspectLocalOllamaModel(
  name: string,
  opts: { baseUrl?: string } = {}
): Promise<{ exists: true; model: OllamaModelInfo }> {
  const requested = modelName(name);
  const baseUrl = opts.baseUrl || loadCostOptConfig().localBaseUrl;
  await requestJson<Record<string, unknown>>(baseUrl, "/api/show", { model: requested });
  const models = await listLocalOllamaModels({ baseUrl, refresh: true });
  const model = models.find((entry) => ollamaModelNamesMatch(entry.name, requested));
  if (!model) {
    throw new Error(`Ollama model "${requested}" is not installed`);
  }
  return { exists: true, model };
}

export async function assertLocalOllamaModelAvailable(
  name: string,
  role: string,
  opts: { baseUrl?: string } = {}
): Promise<void> {
  const requested = modelName(name);
  let models: OllamaModelInfo[];
  try {
    models = await listLocalOllamaModels(opts);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Role "${role}" is blocked: cannot verify local Ollama model "${requested}". ${detail}`
    );
  }
  if (!models.some((entry) => ollamaModelNamesMatch(entry.name, requested))) {
    throw new Error(
      `Role "${role}" is blocked: local Ollama model "${requested}" is not installed. Install it or assign an available model in Team settings.`
    );
  }
}

export function guardLocalOllamaInvocation<
  TArgs extends unknown[],
  TResult,
>(
  invoke: (...args: TArgs) => Promise<TResult>,
  model: string,
  role: string,
  opts: { baseUrl?: string } = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    await assertLocalOllamaModelAvailable(model, role, opts);
    return invoke(...args);
  };
}

export function usesOllamaLocalProvider(): boolean {
  const provider = String(process.env.SAM_LOCAL_PROVIDER || "").trim().toLowerCase();
  if (
    provider &&
    !["ollama", "native-ollama"].includes(provider)
  ) {
    return false;
  }
  const baseUrl = loadCostOptConfig().localBaseUrl;
  return Boolean(provider) || !/:1234(?:\/|$)/.test(baseUrl);
}

export function clearOllamaModelCacheForTests(): void {
  cache.clear();
}
