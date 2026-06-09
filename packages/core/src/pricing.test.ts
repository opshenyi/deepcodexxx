import { describe, expect, it } from "vitest";
import { applyPricingProfileToBudget, parsePricingProfiles, resolvePricingProfile } from "./pricing.js";

describe("pricing profiles", () => {
  it("parses JSON array pricing profiles", () => {
    const profiles = parsePricingProfiles(
      JSON.stringify([
        {
          id: "deepseek-example",
          label: "DeepSeek example",
          inputUsdPerMillionTokens: 0.1,
          outputUsdPerMillionTokens: 0.2
        }
      ])
    );

    expect(profiles).toEqual([
      {
        id: "deepseek-example",
        label: "DeepSeek example",
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.2
      }
    ]);
  });

  it("parses object-map pricing profiles", () => {
    expect(
      parsePricingProfiles(
        JSON.stringify({
          local: {
            label: "Local",
            inputUsdPerMillionTokens: "0",
            outputUsdPerMillionTokens: "0"
          }
        })
      )
    ).toEqual([
      {
        id: "local",
        label: "Local",
        inputUsdPerMillionTokens: 0,
        outputUsdPerMillionTokens: 0
      }
    ]);
  });

  it("applies a pricing profile without overriding explicit prices", () => {
    const profile = resolvePricingProfile(parsePricingProfiles(JSON.stringify({ p: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 } })), "p");

    expect(applyPricingProfileToBudget({ maxEstimatedUsd: 1, inputUsdPerMillionTokens: 9 }, profile)).toEqual({
      maxEstimatedUsd: 1,
      inputUsdPerMillionTokens: 9,
      outputUsdPerMillionTokens: 2
    });
  });

  it("rejects unknown profile ids", () => {
    expect(() => resolvePricingProfile([], "missing")).toThrow(/Unknown pricing profile/);
  });
});
