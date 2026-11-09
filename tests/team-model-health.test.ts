import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertLocalOllamaModelAvailable,
  clearOllamaModelCacheForTests,
  guardLocalOllamaInvocation,
  inspectLocalOllamaModel,
  listLocalOllamaModels,
  ollamaModelNamesMatch,
} from "../src/lib/ollamaModels.js";

const BASE_URL = "http://127.0.0.1:11434";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearOllamaModelCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearOllamaModelCacheForTests();
});

describe("Ollama model inventory", () => {
  it("reads installed models and treats an omitted tag as latest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [{ name: "qwen2.5:latest", size: 1024, details: { family: "qwen" } }],
        })
      )
    );

    const models = await listLocalOllamaModels({ baseUrl: BASE_URL, refresh: true });

    expect(models[0]).toMatchObject({ name: "qwen2.5:latest", family: "qwen" });
    expect(ollamaModelNamesMatch("qwen2.5:latest", "qwen2.5")).toBe(true);
    await expect(
      assertLocalOllamaModelAvailable("qwen2.5", "auditor", { baseUrl: BASE_URL })
    ).resolves.toBeUndefined();
  });

  it("blocks an assignment when the configured model is not installed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ models: [] })));

    await expect(
      assertLocalOllamaModelAvailable("qwen-claude:27b-fast", "auditor", {
        baseUrl: BASE_URL,
      })
    ).rejects.toThrow(/Role "auditor" is blocked.*not installed/);
  });

  it("blocks the model call before invoking an unavailable local model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ models: [] })));
    const invoke = vi.fn(async (_prompt: string) => "should not run");
    const guarded = guardLocalOllamaInvocation(
      invoke,
      "qwen-claude:27b-fast",
      "auditor",
      { baseUrl: BASE_URL }
    );

    await expect(guarded("audit prompt")).rejects.toThrow(
      /Role "auditor" is blocked/
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("inspects the selected model without generating a response", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/show")) return jsonResponse({ details: {} });
      return jsonResponse({ models: [{ name: "qwen2.5:latest" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await inspectLocalOllamaModel("qwen2.5", { baseUrl: BASE_URL });

    expect(result.model.name).toBe("qwen2.5:latest");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/show$/);
  });

  it("does not turn a malformed Ollama response into an empty model list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));

    await expect(
      listLocalOllamaModels({ baseUrl: BASE_URL, refresh: true })
    ).rejects.toThrow(/no models array/);
  });
});
