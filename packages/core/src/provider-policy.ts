import type { DeepSeekReasoningEffort, DeepSeekThinkingType, ProviderPolicy } from "./types.js";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEFAULT_DEEPSEEK_THINKING: DeepSeekThinkingType = "disabled";

export interface ProviderSelectionInput {
  baseUrl?: string;
  model?: string;
  fallbackModels?: string[];
  thinking?: string;
  reasoningEffort?: string;
}

export interface EffectiveProviderSelection {
  baseUrl: string;
  model: string;
  fallbackModels: string[];
  thinking: DeepSeekThinkingType;
  reasoningEffort?: DeepSeekReasoningEffort;
}

export function resolveProviderSelection(input: ProviderSelectionInput = {}): EffectiveProviderSelection {
  const model = normalizeModel(input.model || process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL);
  const thinking = normalizeDeepSeekThinking(
    input.thinking || process.env.DEEPCODEX_PROVIDER_THINKING || DEFAULT_DEEPSEEK_THINKING
  );
  const reasoningEffort = normalizeOptionalReasoningEffort(
    input.reasoningEffort || process.env.DEEPCODEX_PROVIDER_REASONING_EFFORT
  );
  return {
    baseUrl: normalizeBaseUrl(input.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL),
    model,
    fallbackModels: normalizeFallbackModels(
      model,
      input.fallbackModels ?? readCommaSeparatedEnv(process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS)
    ),
    thinking,
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
}

export function assertProviderAllowed(selection: EffectiveProviderSelection, policy?: ProviderPolicy): void {
  const allowedBaseUrls = policy?.allowedBaseUrls?.map(normalizeBaseUrl);
  if (allowedBaseUrls?.length && !allowedBaseUrls.includes(normalizeBaseUrl(selection.baseUrl))) {
    throw new Error(
      `Provider base URL is not allowed by workspace policy: ${selection.baseUrl}. Allowed: ${allowedBaseUrls.join(", ")}`
    );
  }

  const allowedModels = policy?.allowedModels?.map(normalizeModel);
  if (allowedModels?.length && !allowedModels.includes(normalizeModel(selection.model))) {
    throw new Error(
      `Provider model is not allowed by workspace policy: ${selection.model}. Allowed: ${allowedModels.join(", ")}`
    );
  }

  for (const fallbackModel of selection.fallbackModels) {
    if (allowedModels?.length && !allowedModels.includes(normalizeModel(fallbackModel))) {
      throw new Error(
        `Provider fallback model is not allowed by workspace policy: ${fallbackModel}. Allowed: ${allowedModels.join(
          ", "
        )}`
      );
    }
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Provider base URL must be a non-empty string.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Provider base URL must be a valid absolute URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Provider base URL must use http or https.");
  }
  return trimmed.replace(/\/+$/, "");
}

export function normalizeModel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Provider model must be a non-empty string.");
  }
  return trimmed;
}

export function normalizeFallbackModels(primaryModel: string, fallbackModels: string[] = []): string[] {
  const primary = normalizeModel(primaryModel);
  const normalized = fallbackModels.map(normalizeModel).filter((model) => model !== primary);
  return [...new Set(normalized)];
}

export function normalizeDeepSeekThinking(value: string): DeepSeekThinkingType {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "enabled" || trimmed === "disabled") {
    return trimmed;
  }
  throw new Error("Provider thinking must be enabled or disabled.");
}

export function normalizeOptionalReasoningEffort(value: string | undefined): DeepSeekReasoningEffort | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "high" || trimmed === "max") {
    return trimmed;
  }
  throw new Error("Provider reasoning effort must be high or max.");
}

function readCommaSeparatedEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
