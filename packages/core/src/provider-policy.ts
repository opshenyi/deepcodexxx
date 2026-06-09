import type { ProviderPolicy } from "./types.js";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

export interface ProviderSelectionInput {
  baseUrl?: string;
  model?: string;
  fallbackModels?: string[];
}

export interface EffectiveProviderSelection {
  baseUrl: string;
  model: string;
  fallbackModels: string[];
}

export function resolveProviderSelection(input: ProviderSelectionInput = {}): EffectiveProviderSelection {
  const model = normalizeModel(input.model || process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL);
  return {
    baseUrl: normalizeBaseUrl(input.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL),
    model,
    fallbackModels: normalizeFallbackModels(
      model,
      input.fallbackModels ?? readCommaSeparatedEnv(process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS)
    )
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

function readCommaSeparatedEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
