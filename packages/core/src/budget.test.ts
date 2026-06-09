import { describe, expect, it } from "vitest";
import {
  addModelUsageToBudget,
  createInitialBudgetSnapshot,
  evaluateBudgetLimit,
  formatBudgetSnapshot,
  normalizeBudgetPolicy
} from "./budget.js";

describe("budget controls", () => {
  it("tracks token usage against a session token budget", () => {
    const policy = normalizeBudgetPolicy({ maxTokens: 30 });
    const initial = createInitialBudgetSnapshot(policy);
    const updated = addModelUsageToBudget(
      initial,
      {
        type: "model_usage",
        model: "deepseek-chat",
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20
      },
      policy
    );

    expect(updated).toMatchObject({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      maxTokens: 30,
      remainingTokens: 10
    });
    expect(evaluateBudgetLimit(updated)).toBeUndefined();
  });

  it("estimates cost when explicit pricing is configured", () => {
    const policy = normalizeBudgetPolicy({
      maxEstimatedUsd: 0.00003,
      inputUsdPerMillionTokens: 0.5,
      outputUsdPerMillionTokens: 1
    });
    const updated = addModelUsageToBudget(
      createInitialBudgetSnapshot(policy),
      {
        type: "model_usage",
        model: "deepseek-chat",
        promptTokens: 20,
        completionTokens: 20,
        totalTokens: 40
      },
      policy
    );

    expect(updated.estimatedUsd).toBeCloseTo(0.00003);
    expect(evaluateBudgetLimit(updated)).toMatchObject({ reason: "cost" });
    expect(formatBudgetSnapshot(updated)).toContain("Estimated cost");
  });

  it("requires explicit pricing before enforcing a cost budget", () => {
    expect(() => normalizeBudgetPolicy({ maxEstimatedUsd: 1 })).toThrow(/requires inputUsdPerMillionTokens/);
  });
});
