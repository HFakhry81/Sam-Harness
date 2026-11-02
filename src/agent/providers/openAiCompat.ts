/**
 * Dependency-free OpenAI-compatible chat model.
 *
 * One adapter covers every provider that speaks `POST /v1/chat/completions`:
 *   - LM Studio           http://localhost:1234/v1
 *   - OpenRouter (free)   https://openrouter.ai/api/v1
 *   - Groq (free tier)    https://api.groq.com/openai/v1
 *   - Together (free)     https://api.together.xyz/v1
 *   - OpenAI              https://api.openai.com/v1
 *
 * No SDK is installed on purpose: the harness must stay installable offline and
 * zero-cost. Uses global fetch (Node 18+/20+/22).
 */
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export type OpenAiCompatFields = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Extra provider-specific body fields (e.g. reasoning_effort). */
  extraBody?: Record<string, unknown>;
};

/** Accept `.../v1`, `.../openai/v1`, or a bare host; always end at `/chat/completions`. */
export function openAiCompatUrl(baseUrl: string): string {
  const root = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!root) throw new Error("OpenAI-compatible baseUrl is empty");
  return /\/v\d+$/.test(root) ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const p = part as { type?: string; text?: string };
        return p?.type === "text" || p?.text ? String(p.text || "") : "";
      })
      .join("");
  }
  if (content == null) return "";
  return String(content);
}

function toOpenAiMessage(m: BaseMessage): { role: string; content: string } {
  const type = m._getType();
  const role =
    type === "system"
      ? "system"
      : type === "ai"
        ? "assistant"
        : type === "tool"
          ? "tool"
          : "user";
  return { role, content: contentToText(m.content) };
}

export class ChatOpenAiCompat extends BaseChatModel {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  extraBody?: Record<string, unknown>;

  constructor(fields: OpenAiCompatFields) {
    super({});
    this.baseUrl = fields.baseUrl;
    this.apiKey = fields.apiKey;
    this.model = fields.model;
    this.temperature = fields.temperature ?? 0.2;
    this.maxTokens = fields.maxTokens;
    this.timeoutMs = Math.max(1000, fields.timeoutMs ?? 180_000);
    this.extraBody = fields.extraBody;
    this._providerHeaders = fields.headers || {};
  }

  private _providerHeaders: Record<string, string>;

  _llmType(): string {
    return "openai-compatible";
  }

  /** Never serialize credentials into traces. */
  _identifyingParams(): Record<string, unknown> {
    return { model: this.model, baseUrl: this.baseUrl };
  }

  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const url = openAiCompatUrl(this.baseUrl);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this._providerHeaders,
    };
    if (this.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(toOpenAiMessage),
      temperature: this.temperature,
      stream: false,
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.extraBody || {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: string;
    let status = 0;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = res.status;
      raw = await res.text();
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? `timeout after ${this.timeoutMs}ms` : e?.message || String(e);
      throw new Error(`OpenAI-compatible request failed (${new URL(url).host}): ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (status < 200 || status >= 300) {
      throw new Error(
        `OpenAI-compatible ${status} from ${new URL(url).host}: ${String(raw).slice(0, 300)}`
      );
    }

    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(
        `OpenAI-compatible non-JSON response from ${new URL(url).host}: ${String(raw).slice(0, 200)}`
      );
    }

    const choice = json?.choices?.[0];
    const text = contentToText(choice?.message?.content ?? choice?.text ?? "");
    if (!text.trim()) {
      const hint = json?.error?.message ? `: ${json.error.message}` : "";
      throw new Error(`OpenAI-compatible empty response from ${new URL(url).host}${hint}`);
    }

    return {
      generations: [{ text, message: new AIMessage(text) }],
      llmOutput: json?.usage ? { usage: json.usage } : undefined,
    };
  }
}

/** True when an OpenAI-compatible base URL points at a local runtime (LM Studio). */
export function isLocalOpenAiCompatBase(baseUrl: string): boolean {
  try {
    const host = new URL(String(baseUrl || "")).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}
