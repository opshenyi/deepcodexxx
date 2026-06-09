import type { ProviderPolicy } from "./types.js";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

export interface ProviderSelectionInput {
  baseUrl?: string;
  model?: string;
}

export interface EffectiveProviderSelection {
  baseUrl: string;
  model: string;
}

export function resolveProviderSelection(input: ProviderSelectionInput = {}): EffectiveProviderSelection {
  return {
    baseUrl: normalizeBaseUrl(input.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL),
    model: normalizeModel(input.model || process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL)
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

function normalizeModel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Provider model must be a non-empty string.");
  }
  return trimmed;
}
