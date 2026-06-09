import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_LEGACY_ALIAS_RETIRES_AT,
  createDeepSeekModelCatalogSummary,
  getDeepSeekModelCatalogEntry,
  listDeepSeekModelCatalog
} from "./provider-catalog.js";

describe("provider catalog", () => {
  it("lists current DeepSeek V4 models and legacy aliases", () => {
    const models = listDeepSeekModelCatalog();

    expect(models.map((model) => model.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner"
    ]);
    expect(models.find((model) => model.id === "deepseek-v4-flash")).toMatchObject({
      status: "recommended",
      defaultModel: true,
      fallbackEligible: true,
      supportsToolCalls: true
    });
    expect(models.find((model) => model.id === "deepseek-reasoner")).toMatchObject({
      status: "legacy",
      fallbackEligible: false,
      supportsToolCalls: true,
      migrationTarget: "deepseek-v4-flash",
      retiresAt: DEEPSEEK_LEGACY_ALIAS_RETIRES_AT
    });
  });

  it("returns defensive copies for model entries", () => {
    const entry = getDeepSeekModelCatalogEntry("deepseek-v4-flash");

    expect(entry).toMatchObject({ id: "deepseek-v4-flash", status: "recommended" });
    if (entry) {
      entry.status = "legacy";
    }
    expect(getDeepSeekModelCatalogEntry("deepseek-v4-flash")).toMatchObject({ status: "recommended" });
  });

  it("summarizes catalog status for UI and CI surfaces", () => {
    expect(createDeepSeekModelCatalogSummary(new Date("2026-06-09T00:00:00.000Z"))).toMatchObject({
      generatedAt: "2026-06-09T00:00:00.000Z",
      sourceCheckedAt: "2026-06-09",
      recommended: 1,
      supported: 1,
      legacy: 2,
      defaultModel: "deepseek-v4-flash",
      legacyRetiresAt: DEEPSEEK_LEGACY_ALIAS_RETIRES_AT
    });
  });
});
