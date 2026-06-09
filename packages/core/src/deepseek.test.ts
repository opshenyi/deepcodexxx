import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekClient, DeepSeekError } from "./deepseek.js";

const originalFetch = globalThis.fetch;
const originalProviderEnv = {
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  DEEPCODEX_PROVIDER_FALLBACK_MODELS: process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS,
  DEEPCODEX_PROVIDER_THINKING: process.env.DEEPCODEX_PROVIDER_THINKING,
  DEEPCODEX_PROVIDER_REASONING_EFFORT: process.env.DEEPCODEX_PROVIDER_REASONING_EFFORT
};

beforeEach(() => {
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS;
  delete process.env.DEEPCODEX_PROVIDER_THINKING;
  delete process.env.DEEPCODEX_PROVIDER_REASONING_EFFORT;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvValue("DEEPSEEK_MODEL", originalProviderEnv.DEEPSEEK_MODEL);
  restoreEnvValue("DEEPCODEX_PROVIDER_FALLBACK_MODELS", originalProviderEnv.DEEPCODEX_PROVIDER_FALLBACK_MODELS);
  restoreEnvValue("DEEPCODEX_PROVIDER_THINKING", originalProviderEnv.DEEPCODEX_PROVIDER_THINKING);
  restoreEnvValue(
    "DEEPCODEX_PROVIDER_REASONING_EFFORT",
    originalProviderEnv.DEEPCODEX_PROVIDER_REASONING_EFFORT
  );
  vi.restoreAllMocks();
});

describe("DeepSeekClient", () => {
  it("returns demo mode without calling fetch when no API key is configured", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({ apiKey: "", maxRetries: 0 });

    const response = await client.chat([{ role: "user", content: "hello" }]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.choices[0]?.message.content).toContain("local demo mode");
  });

  it("retries retryable provider status codes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ id: "ok" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({ apiKey: "test-key", maxRetries: 1, retryBaseDelayMs: 0 });

    const response = await client.chat([{ role: "user", content: "hello" }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.id).toBe("ok");
  });

  it("disables DeepSeek V4 thinking by default for tool-loop compatibility", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: "ok" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({ apiKey: "test-key", maxRetries: 0 });

    await client.chat([{ role: "user", content: "hello" }]);

    expect(requestedPayloads(fetchMock)[0]).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      temperature: 0.2
    });
  });

  it("sends reasoning effort only when thinking mode is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: "ok-thinking" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({
      apiKey: "test-key",
      thinking: "enabled",
      reasoningEffort: "max",
      maxRetries: 0
    });

    await client.chat(
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "", reasoning_content: "provider reasoning replay" }
      ],
      [sampleTool()]
    );

    expect(requestedPayloads(fetchMock)[0]).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "",
          reasoning_content: "provider reasoning replay"
        })
      ])
    });
    expect(requestedPayloads(fetchMock)[0]).not.toHaveProperty("temperature");
    expect(requestedPayloads(fetchMock)[0]).not.toHaveProperty("tool_choice");
  });

  it("retries network errors", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce(jsonResponse({ id: "ok-after-network" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({ apiKey: "test-key", maxRetries: 1, retryBaseDelayMs: 0 });

    const response = await client.chat([{ role: "user", content: "hello" }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.id).toBe("ok-after-network");
  });

  it("falls back to the next model after retryable failures are exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("still busy", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ id: "ok-on-fallback" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      fallbackModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
      maxRetries: 1,
      retryBaseDelayMs: 0
    });

    const response = await client.chat([{ role: "user", content: "hello" }]);

    expect(response.id).toBe("ok-on-fallback");
    expect(client.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(client.lastModel).toBe("deepseek-v4-pro");
    expect(requestedModels(fetchMock)).toEqual(["deepseek-v4-flash", "deepseek-v4-flash", "deepseek-v4-pro"]);
  });

  it("does not retry non-retryable provider status codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({
      apiKey: "test-key",
      fallbackModels: ["deepseek-v4-pro"],
      maxRetries: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.chat([{ role: "user", content: "hello" }])).rejects.toMatchObject({
      status: 400,
      retryable: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedModels(fetchMock)).toEqual(["deepseek-v4-flash"]);
  });

  it("reports the final attempt count when retryable failures are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({ apiKey: "test-key", maxRetries: 1, retryBaseDelayMs: 0 });

    await expect(client.chat([{ role: "user", content: "hello" }])).rejects.toThrow(/after 2 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry invalid JSON from a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({
      apiKey: "test-key",
      fallbackModels: ["deepseek-v4-pro"],
      maxRetries: 2,
      retryBaseDelayMs: 0
    });

    const promise = client.chat([{ role: "user", content: "hello" }]);
    await expect(promise).rejects.toBeInstanceOf(DeepSeekError);
    await expect(promise).rejects.toThrow(/invalid JSON/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedModels(fetchMock)).toEqual(["deepseek-v4-flash"]);
  });
});

function jsonResponse(partial: { id: string }): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "ok"
          }
        }
      ],
      ...partial
    }),
    { status: 200 }
  );
}

function requestedModels(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).model as string);
}

function requestedPayloads(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

function sampleTool() {
  return {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    }
  };
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
