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

  it("lists and resolves custom workspace policy profiles", () => {
    const custom = [
      {
        id: "team-review",
        label: "Team review",
        description: "Team-managed review profile.",
        approvalMode: "manual" as const,
        maxSteps: 5,
        policy: {
          mode: "workspace-write" as const,
          allowShell: false,
          allowFileWrite: true,
          shellEnvironment: "minimal" as const,
          allowedShellCommands: ["^npm\\s+test$"],
          deniedShellCommands: ["\\bterraform\\s+apply\\b"]
        },
        budget: {
          maxTokens: 1000
        }
      }
    ];

    expect(listPolicyProfiles(custom).map((profile) => profile.id)).toEqual([
      "inspection",
      "guarded-write",
      "full-access-review",
      "team-review"
    ]);
    expect(resolvePolicyProfile("team-review", custom)).toMatchObject({
      id: "team-review",
      approvalMode: "manual",
      maxSteps: 5,
      policy: {
        mode: "workspace-write",
        allowShell: false,
        allowedShellCommands: ["^npm\\s+test$"],
        deniedShellCommands: ["\\bterraform\\s+apply\\b"]
      },
      budget: {
        maxTokens: 1000
      }
    });
    const resolved = resolvePolicyProfile("team-review", custom)!;
    resolved.policy.allowedShellCommands?.push("^local-only$");
    expect(custom[0]!.policy.allowedShellCommands).not.toContain("^local-only$");
    expect(resolvePolicyProfile("team-review", custom)?.policy.allowedShellCommands).not.toContain("^local-only$");
  });

  it("rejects custom profiles that replace built-ins", () => {
    expect(() =>
      listPolicyProfiles([
        {
          id: "inspection",
          label: "Override",
          description: "Invalid override.",
          approvalMode: "deny",
          policy: {
            mode: "suggest"
          }
        }
      ])
    ).toThrow(/cannot replace built-in/);
  });

  it("resolves the default guarded-write profile", () => {
    const profile = resolvePolicyProfileOrDefault(undefined);

    expect(profile.id).toBe(DEFAULT_POLICY_PROFILE_ID);
    expect(profile.approvalMode).toBe("manual");
    expect(profile.policy).toMatchObject({
      mode: "workspace-write",
      allowShell: true,
      allowFileWrite: true,
      shellEnvironment: "minimal",
      shellExecutionMode: "direct"
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
