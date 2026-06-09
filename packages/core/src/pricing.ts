import type { BudgetPolicy, PricingProfile } from "./types.js";

export function parsePricingProfiles(raw: string | undefined): PricingProfile[] {
  if (!raw?.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed).map(([id, value]) => ({ id, ...(value as Record<string, unknown>) }))
      : [];

  return entries.map((entry) => normalizePricingProfile(entry));
}

export function resolvePricingProfile(
  profiles: PricingProfile[],
  profileId: string | undefined
): PricingProfile | undefined {
  const id = profileId?.trim();
  if (!id || id === "custom") {
    return undefined;
  }
  const profile = profiles.find((entry) => entry.id === id);
  if (!profile) {
    throw new Error(`Unknown pricing profile: ${profileId}`);
  }
  return { ...profile };
}

export function applyPricingProfileToBudget(
  budget: BudgetPolicy | undefined,
  pricingProfile: PricingProfile | undefined
): BudgetPolicy | undefined {
  if (!budget && !pricingProfile) {
    return undefined;
  }
  return {
    ...budget,
    inputUsdPerMillionTokens: budget?.inputUsdPerMillionTokens ?? pricingProfile?.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: budget?.outputUsdPerMillionTokens ?? pricingProfile?.outputUsdPerMillionTokens
  };
}

function normalizePricingProfile(value: unknown): PricingProfile {
  if (!value || typeof value !== "object") {
    throw new Error("Pricing profile entries must be objects.");
  }
  const entry = value as Partial<PricingProfile>;
  const id = readRequiredString(entry.id, "id");
  return {
    id,
    label: readRequiredString(entry.label ?? id, "label"),
    description: typeof entry.description === "string" ? entry.description : undefined,
    inputUsdPerMillionTokens: readNonNegativeNumber(
      entry.inputUsdPerMillionTokens,
      "inputUsdPerMillionTokens"
    ),
    outputUsdPerMillionTokens: readNonNegativeNumber(
      entry.outputUsdPerMillionTokens,
      "outputUsdPerMillionTokens"
    )
  };
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Pricing profile ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readNonNegativeNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Pricing profile ${field} must be a non-negative number.`);
  }
  return parsed;
}
