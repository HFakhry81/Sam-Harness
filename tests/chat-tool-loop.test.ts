import { describe, expect, it, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { runChatToolLoop } from "../src/lib/intentRouter/toolLoop.js";
import type { invokeQuickModel } from "../src/lib/quickPath/quickModel.js";

describe("chat tool loop", () => {
  it("runs multiple read-only tools and keeps all tool results in the local follow-up", async () => {
    const invokeModel = vi.fn(
      async (input: Parameters<typeof invokeQuickModel>[0]) => {
        if (invokeModel.mock.calls.length === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "read-package",
                name: "read_file",
                args: { path: "package.json", maxLines: 20 },
              },
            ],
            model: "remote-test-model",
            cloud: true,
            costUsd: 0.001,
            baseUrl: "https://example.invalid",
          };
        }
        if (invokeModel.mock.calls.length === 2) {
          expect(input.messages?.some((message) => message instanceof ToolMessage)).toBe(true);
          return {
            text: "",
            toolCalls: [
              {
                id: "search-package",
                name: "search_code",
                args: { path: process.cwd(), pattern: '"name"' },
              },
            ],
            model: "local-test-model",
            cloud: false,
            costUsd: 0,
            baseUrl: "http://127.0.0.1:11434",
          };
        }

        expect(input.messages?.filter((message) => message instanceof ToolMessage)).toHaveLength(2);
        expect(input.modelPreference).toBe("local");
        return {
          text: "The package metadata was read and searched.",
          model: "local-test-model",
          cloud: false,
          costUsd: 0,
          baseUrl: "http://127.0.0.1:11434",
        };
      }
    );

    const result = await runChatToolLoop({
      prompt: "Read the package metadata, then search it for the package name.",
      cwd: process.cwd(),
      modelPreference: "cloud",
      invokeModel: invokeModel as typeof invokeQuickModel,
    });

    expect(result.reply).toContain("read and searched");
    expect(result.toolsUsed.map((tool) => tool.name)).toEqual([
      "read_file",
      "search_code",
    ]);
    expect(result.toolsUsed.every((tool) => tool.ok)).toBe(true);
    expect(result.costUsd).toBe(0.001);
    expect(result.cloud).toBe(true);
    expect(invokeModel.mock.calls.map(([call]) => call.modelPreference)).toEqual([
      "cloud",
      "local",
      "local",
    ]);
  });

  it("rejects tool names outside the read-only chat allowlist", async () => {
    const invokeModel = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "write", name: "write_file", args: { path: "x", content: "x" } }],
        model: "test",
        cloud: false,
        costUsd: 0,
        baseUrl: "http://127.0.0.1:11434",
      })
      .mockResolvedValueOnce({
        text: "Writes are unavailable in chat.",
        model: "test",
        cloud: false,
        costUsd: 0,
        baseUrl: "http://127.0.0.1:11434",
      });

    const result = await runChatToolLoop({
      prompt: "Write a file.",
      cwd: process.cwd(),
      invokeModel: invokeModel as typeof invokeQuickModel,
    });

    expect(result.toolsUsed).toEqual([
      { name: "write_file", ok: false, message: "Tool is not available in chat." },
    ]);
    expect(invokeModel).toHaveBeenCalledTimes(2);
  });
});
