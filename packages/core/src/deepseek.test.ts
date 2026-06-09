import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekClient, DeepSeekError } from "./deepseek.js";

const originalFetch = globalThis.fetch;
const originalProviderEnv = {
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  DEEPCODEX_PROVIDER_FALLBACK_MODELS: process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS
};

beforeEach(() => {
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvValue("DEEPSEEK_MODEL", originalProviderEnv.DEEPSEEK_MODEL);
  restoreEnvValue("DEEPCODEX_PROVIDER_FALLBACK_MODELS", originalProviderEnv.DEEPCODEX_PROVIDER_FALLBACK_MODELS);
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
      model: "deepseek-chat",
      fallbackModels: ["deepseek-reasoner", "deepseek-chat"],
      maxRetries: 1,
      retryBaseDelayMs: 0
    });

    const response = await client.chat([{ role: "user", content: "hello" }]);

    expect(response.id).toBe("ok-on-fallback");
    expect(client.models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(client.lastModel).toBe("deepseek-reasoner");
    expect(requestedModels(fetchMock)).toEqual(["deepseek-chat", "deepseek-chat", "deepseek-reasoner"]);
  });

  it("does not retry non-retryable provider status codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new DeepSeekClient({
      apiKey: "test-key",
      fallbackModels: ["deepseek-reasoner"],
      maxRetries: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.chat([{ role: "user", content: "hello" }])).rejects.toMatchObject({
      status: 400,
      retryable: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedModels(fetchMock)).toEqual(["deepseek-chat"]);
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
      fallbackModels: ["deepseek-reasoner"],
      maxRetries: 2,
      retryBaseDelayMs: 0
    });

    const promise = client.chat([{ role: "user", content: "hello" }]);
    await expect(promise).rejects.toBeInstanceOf(DeepSeekError);
    await expect(promise).rejects.toThrow(/invalid JSON/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedModels(fetchMock)).toEqual(["deepseek-chat"]);
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

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
