import { describe, expect, it } from "vitest";
import { assertProviderAllowed, normalizeBaseUrl, resolveProviderSelection } from "./provider-policy.js";

describe("provider policy", () => {
  it("resolves default DeepSeek-compatible provider values", () => {
    expect(resolveProviderSelection({})).toEqual({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat"
    });
  });

  it("normalizes provider base URLs", () => {
    expect(normalizeBaseUrl("https://api.deepseek.com/")).toBe("https://api.deepseek.com");
  });

  it("allows approved provider base URLs and models", () => {
    expect(() =>
      assertProviderAllowed(
        { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
        { allowedBaseUrls: ["https://api.deepseek.com/"], allowedModels: ["deepseek-chat"] }
      )
    ).not.toThrow();
  });

  it("rejects unapproved provider base URLs", () => {
    expect(() =>
      assertProviderAllowed(
        { baseUrl: "https://unapproved.example.com", model: "deepseek-chat" },
        { allowedBaseUrls: ["https://api.deepseek.com"] }
      )
    ).toThrow(/base URL is not allowed/);
  });

  it("rejects unapproved provider models", () => {
    expect(() =>
      assertProviderAllowed(
        { baseUrl: "https://api.deepseek.com", model: "experimental-model" },
        { allowedModels: ["deepseek-chat"] }
      )
    ).toThrow(/model is not allowed/);
  });
});
