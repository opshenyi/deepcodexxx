import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_PROFILE_ID,
  listPolicyProfiles,
  mergeProfilePolicy,
  resolvePolicyProfile,
  resolvePolicyProfileOrDefault
} from "./policy-profile.js";

describe("policy profiles", () => {
  it("lists built-in reusable policy profiles", () => {
    expect(listPolicyProfiles().map((profile) => profile.id)).toEqual([
      "inspection",
      "guarded-write",
      "full-access-review"
    ]);
  });

  it("resolves the default guarded-write profile", () => {
    const profile = resolvePolicyProfileOrDefault(undefined);

    expect(profile.id).toBe(DEFAULT_POLICY_PROFILE_ID);
    expect(profile.approvalMode).toBe("manual");
    expect(profile.policy).toMatchObject({
      mode: "workspace-write",
      allowShell: true,
      allowFileWrite: true,
      shellEnvironment: "minimal"
    });
  });

  it("treats custom as no built-in profile", () => {
    expect(resolvePolicyProfile("custom")).toBeUndefined();
  });

  it("merges explicit policy overrides over a profile", () => {
    const profile = resolvePolicyProfile("inspection");

    expect(mergeProfilePolicy(profile, { mode: "workspace-write", allowShell: true })).toMatchObject({
      mode: "workspace-write",
      allowShell: true,
      allowFileWrite: false
    });
  });

  it("rejects unknown profile ids", () => {
    expect(() => resolvePolicyProfile("unknown")).toThrow(/Unknown policy profile/);
  });
});
