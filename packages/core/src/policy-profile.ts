import type { ApprovalPolicy, PolicyProfile } from "./types.js";

export const DEFAULT_POLICY_PROFILE_ID = "guarded-write";

const POLICY_PROFILES: PolicyProfile[] = [
  {
    id: "inspection",
    label: "Inspection",
    description: "Read-only planning with no shell, file writes, memory writes, or session state.",
    approvalMode: "deny",
    maxSteps: 8,
    policy: {
      mode: "suggest",
      allowShell: false,
      allowFileWrite: false,
      allowNetwork: false,
      allowStateWrite: false,
      shellEnvironment: "minimal"
    }
  },
  {
    id: "guarded-write",
    label: "Guarded write",
    description: "Workspace-scoped edits with manual review for writes, shell commands, and memory changes.",
    approvalMode: "manual",
    maxSteps: 12,
    policy: {
      mode: "workspace-write",
      allowShell: true,
      allowFileWrite: true,
      allowNetwork: false,
      allowStateWrite: true,
      shellEnvironment: "minimal"
    }
  },
  {
    id: "full-access-review",
    label: "Full access review",
    description: "Full-access command policy with manual review and a minimal shell environment.",
    approvalMode: "manual",
    maxSteps: 12,
    policy: {
      mode: "full-access",
      allowShell: true,
      allowFileWrite: true,
      allowNetwork: false,
      allowStateWrite: true,
      shellEnvironment: "minimal"
    }
  }
];

export function listPolicyProfiles(): PolicyProfile[] {
  return POLICY_PROFILES.map(cloneProfile);
}

export function resolvePolicyProfile(profileId: string | undefined): PolicyProfile | undefined {
  const id = normalizeProfileId(profileId);
  if (!id) {
    return undefined;
  }
  const profile = POLICY_PROFILES.find((entry) => entry.id === id);
  if (!profile) {
    throw new Error(`Unknown policy profile: ${profileId}`);
  }
  return cloneProfile(profile);
}

export function resolvePolicyProfileOrDefault(profileId: string | undefined): PolicyProfile {
  return resolvePolicyProfile(profileId) ?? resolvePolicyProfile(DEFAULT_POLICY_PROFILE_ID)!;
}

export function mergeProfilePolicy(
  profile: PolicyProfile | undefined,
  overrides: Partial<ApprovalPolicy> = {}
): ApprovalPolicy {
  const base = profile?.policy ?? resolvePolicyProfileOrDefault(undefined).policy;
  return {
    ...base,
    ...overrides,
    mode: overrides.mode ?? base.mode
  };
}

function normalizeProfileId(profileId: string | undefined): string | undefined {
  const id = profileId?.trim();
  if (!id || id === "custom") {
    return undefined;
  }
  return id;
}

function cloneProfile(profile: PolicyProfile): PolicyProfile {
  return {
    ...profile,
    policy: { ...profile.policy },
    budget: profile.budget ? { ...profile.budget } : undefined
  };
}
