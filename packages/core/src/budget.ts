import type { AgentEvent, BudgetLimitReason, BudgetPolicy, BudgetSnapshot } from "./types.js";

type ModelUsageEvent = Extract<AgentEvent, { type: "model_usage" }>;

export interface BudgetLimitResult {
  reason: BudgetLimitReason;
  message: string;
}

export function normalizeBudgetPolicy(policy?: BudgetPolicy): BudgetPolicy | undefined {
  if (!policy) {
    return undefined;
  }

  const normalized: BudgetPolicy = {};
  if (policy.maxTokens !== undefined) {
    normalized.maxTokens = assertNonNegativeNumber(policy.maxTokens, "maxTokens");
  }
  if (policy.maxEstimatedUsd !== undefined) {
    normalized.maxEstimatedUsd = assertNonNegativeNumber(policy.maxEstimatedUsd, "maxEstimatedUsd");
  }
  if (policy.inputUsdPerMillionTokens !== undefined) {
    normalized.inputUsdPerMillionTokens = assertNonNegativeNumber(
      policy.inputUsdPerMillionTokens,
      "inputUsdPerMillionTokens"
    );
  }
  if (policy.outputUsdPerMillionTokens !== undefined) {
    normalized.outputUsdPerMillionTokens = assertNonNegativeNumber(
      policy.outputUsdPerMillionTokens,
      "outputUsdPerMillionTokens"
    );
  }

  if (
    normalized.maxEstimatedUsd !== undefined &&
    (normalized.inputUsdPerMillionTokens === undefined || normalized.outputUsdPerMillionTokens === undefined)
  ) {
    throw new Error(
      "Cost budget requires inputUsdPerMillionTokens and outputUsdPerMillionTokens so DeepCodex can enforce it."
    );
  }

  return isBudgetPolicyEnabled(normalized) ? normalized : undefined;
}

export function createInitialBudgetSnapshot(policy?: BudgetPolicy): BudgetSnapshot {
  const snapshot: BudgetSnapshot = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };
  return applyBudgetLimits(snapshot, policy);
}

export function isBudgetPolicyEnabled(policy?: BudgetPolicy): boolean {
  return Boolean(
    policy?.maxTokens !== undefined ||
      policy?.maxEstimatedUsd !== undefined ||
      policy?.inputUsdPerMillionTokens !== undefined ||
      policy?.outputUsdPerMillionTokens !== undefined
  );
}

export function addModelUsageToBudget(
  current: BudgetSnapshot,
  usage: ModelUsageEvent,
  policy?: BudgetPolicy
): BudgetSnapshot {
  return applyBudgetLimits(
    {
      promptTokens: current.promptTokens + usage.promptTokens,
      completionTokens: current.completionTokens + usage.completionTokens,
      totalTokens: current.totalTokens + usage.totalTokens
    },
    policy
  );
}

export function evaluateBudgetLimit(snapshot: BudgetSnapshot): BudgetLimitResult | undefined {
  if (snapshot.maxTokens !== undefined && snapshot.totalTokens >= snapshot.maxTokens) {
    return {
      reason: "tokens",
      message: `Token budget reached: ${snapshot.totalTokens} of ${snapshot.maxTokens} tokens used.`
    };
  }

  if (
    snapshot.maxEstimatedUsd !== undefined &&
    snapshot.estimatedUsd !== undefined &&
    snapshot.estimatedUsd >= snapshot.maxEstimatedUsd
  ) {
    return {
      reason: "cost",
      message: `Cost budget reached: ${formatUsd(snapshot.estimatedUsd)} of ${formatUsd(
        snapshot.maxEstimatedUsd
      )} estimated.`
    };
  }

  return undefined;
}

export function formatBudgetSnapshot(snapshot: BudgetSnapshot): string {
  const lines = [
    `Prompt tokens: ${snapshot.promptTokens}`,
    `Completion tokens: ${snapshot.completionTokens}`,
    `Total tokens: ${snapshot.totalTokens}`
  ];

  if (snapshot.maxTokens !== undefined) {
    lines.push(`Token budget: ${snapshot.totalTokens} / ${snapshot.maxTokens}`);
    lines.push(`Remaining tokens: ${snapshot.remainingTokens ?? 0}`);
  }

  if (snapshot.estimatedUsd !== undefined) {
    lines.push(`Estimated cost: ${formatUsd(snapshot.estimatedUsd)}`);
  }

  if (snapshot.maxEstimatedUsd !== undefined) {
    lines.push(`Cost budget: ${formatUsd(snapshot.estimatedUsd ?? 0)} / ${formatUsd(snapshot.maxEstimatedUsd)}`);
    lines.push(`Remaining cost: ${formatUsd(snapshot.remainingUsd ?? 0)}`);
  }

  return lines.join("\n");
}

function applyBudgetLimits(snapshot: BudgetSnapshot, policy?: BudgetPolicy): BudgetSnapshot {
  const next: BudgetSnapshot = { ...snapshot };
  if (policy?.maxTokens !== undefined) {
    next.maxTokens = policy.maxTokens;
    next.remainingTokens = Math.max(0, policy.maxTokens - snapshot.totalTokens);
  }

  if (policy?.inputUsdPerMillionTokens !== undefined && policy.outputUsdPerMillionTokens !== undefined) {
    next.estimatedUsd =
      (snapshot.promptTokens / 1_000_000) * policy.inputUsdPerMillionTokens +
      (snapshot.completionTokens / 1_000_000) * policy.outputUsdPerMillionTokens;
  }

  if (policy?.maxEstimatedUsd !== undefined) {
    next.maxEstimatedUsd = policy.maxEstimatedUsd;
    next.remainingUsd = Math.max(0, policy.maxEstimatedUsd - (next.estimatedUsd ?? 0));
  }

  return next;
}

function assertNonNegativeNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return value;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}
