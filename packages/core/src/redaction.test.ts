import { describe, expect, it } from "vitest";
import { redactSensitiveText, redactSensitiveValue } from "./redaction.js";

describe("redaction", () => {
  it("redacts common secret assignments and bearer tokens", () => {
    const value =
      "DEEPSEEK_API_KEY=live-secret Authorization: Bearer token-value PASSWORD: hunter2 github_pat_1234567890abcdef";

    expect(redactSensitiveText(value)).toBe(
      "DEEPSEEK_API_KEY=[redacted] Authorization: Bearer [redacted] PASSWORD=[redacted] [redacted-token]"
    );
  });

  it("redacts sensitive object keys recursively", () => {
    expect(
      redactSensitiveValue({
        command: "echo safe",
        env: {
          apiKey: "secret",
          nested: ["ACCESS_TOKEN=abc123"]
        }
      })
    ).toEqual({
      command: "echo safe",
      env: {
        apiKey: "[redacted]",
        nested: ["ACCESS_TOKEN=[redacted]"]
      }
    });
  });

  it("applies caller-provided redaction patterns", () => {
    expect(redactSensitiveText("ticket ACME_ABCDEFGHIJKLMNOP should hide", {
      additionalPatterns: ["ACME_[A-Z]{16}"]
    })).toBe("ticket [redacted-custom] should hide");

    expect(
      redactSensitiveValue(
        {
          command: "echo ACME_ABCDEFGHIJKLMNOP"
        },
        { additionalPatterns: ["ACME_[A-Z]{16}"] }
      )
    ).toEqual({
      command: "echo [redacted-custom]"
    });
  });
});
