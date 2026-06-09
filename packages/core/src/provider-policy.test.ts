import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertProviderAllowed, normalizeBaseUrl, resolveProviderSelection } from "./provider-policy.js";

const originalProviderEnv = {
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  DEEPCODEX_PROVIDER_FALLBACK_MODELS: process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS
};

beforeEach(() => {
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS;
});

afterEach(() => {
  restoreEnvValue("DEEPSEEK_BASE_URL", originalProviderEnv.DEEPSEEK_BASE_URL);
  restoreEnvValue("DEEPSEEK_MODEL", originalProviderEnv.DEEPSEEK_MODEL);
  restoreEnvValue("DEEPCODEX_PROVIDER_FALLBACK_MODELS", originalProviderEnv.DEEPCODEX_PROVIDER_FALLBACK_MODELS);
});

describe("provider policy", () => {
  it("resolves default DeepSeek-compatible provider values", () => {
    expect(resolveProviderSelection({})).toEqual({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      fallbackModels: []
    });
  });

  it("normalizes fallback models while removing duplicates and the primary model", () => {
    expect(
      resolveProviderSelection({
        model: "deepseek-chat",
        fallbackModels: [" deepseek-reasoner ", "deepseek-chat", "deepseek-reasoner"]
      })
    ).toEqual({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      fallbackModels: ["deepseek-reasoner"]
    });
  });

  it("normalizes provider base URLs", () => {
    expect(normalizeBaseUrl("https://api.deepseek.com/")).toBe("https://api.deepseek.com");
  });

  it("allows approved provider base URLs and models", () => {
    expect(() =>
      assertProviderAllowed(
        { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", fallbackModels: ["deepseek-reasoner"] },
        { allowedBaseUrls: ["https://api.deepseek.com/"], allowedModels: ["deepseek-chat", "deepseek-reasoner"] }
      )
    ).not.toThrow();
  });

  it("rejects unapproved provider base URLs", () => {
    expect(() =>
      assertProviderAllowed(
        { baseUrl: "https://unapproved.example.com", model: "deepseek-chat", fallbackModels: [] },
        { allowedBaseUrls: ["https://api.deepseek.com"] }
      )
    ).toThrow(/base URL is not allowed/);
  });

  it("rejects unapproved provider models", () => {
    expect(() =>
      assertProviderAllowed(
        { baseUrl: "https://api.deepseek.com", model: "experimental-model", fallbackModels: [] },
        { allowedModels: ["deepseek-chat"] }
      )
    ).toThrow(/model is not allowed/);
  });

  it("rejects unapproved provider fallback models", () => {
    expect(() =>
      assertProviderAllowed(
        { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", fallbackModels: ["experimental-model"] },
        { allowedModels: ["deepseek-chat"] }
      )
    ).toThrow(/fallback model is not allowed/);
  });
});

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
