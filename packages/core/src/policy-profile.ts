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
      shellEnvironment: "minimal",
      shellExecutionMode: "direct"
    }
  },
  {
    id: "guarded-write",
    label: "Guarded write",
    description: "Workspace-scoped edits with manual review for writes, shell commands, memory changes, and network-denied shell policy.",
    approvalMode: "manual",
    maxSteps: 12,
    policy: {
      mode: "workspace-write",
      allowShell: true,
      allowFileWrite: true,
      allowNetwork: false,
      allowStateWrite: true,
      shellEnvironment: "minimal",
      shellExecutionMode: "direct"
    }
  },
  {
    id: "full-access-review",
    label: "Full access review",
    description: "Full-access command policy with manual review, a minimal shell environment, and network-denied shell policy.",
    approvalMode: "manual",
    maxSteps: 12,
    policy: {
      mode: "full-access",
      allowShell: true,
      allowFileWrite: true,
      allowNetwork: false,
      allowStateWrite: true,
      shellEnvironment: "minimal",
      shellExecutionMode: "direct"
    }
  }
];

export function listPolicyProfiles(customProfiles: PolicyProfile[] = []): PolicyProfile[] {
  assertCustomProfiles(customProfiles);
  return [...POLICY_PROFILES, ...customProfiles].map(cloneProfile);
}

export function resolvePolicyProfile(
  profileId: string | undefined,
  customProfiles: PolicyProfile[] = []
): PolicyProfile | undefined {
  const id = normalizeProfileId(profileId);
  if (!id) {
    return undefined;
  }
  const profile = listPolicyProfiles(customProfiles).find((entry) => entry.id === id);
  if (!profile) {
    throw new Error(`Unknown policy profile: ${profileId}`);
  }
  return cloneProfile(profile);
}

export function resolvePolicyProfileOrDefault(
  profileId: string | undefined,
  customProfiles: PolicyProfile[] = []
): PolicyProfile {
  return resolvePolicyProfile(profileId, customProfiles) ?? resolvePolicyProfile(DEFAULT_POLICY_PROFILE_ID)!;
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

function assertCustomProfiles(customProfiles: PolicyProfile[]): void {
  const builtInIds = new Set(POLICY_PROFILES.map((profile) => profile.id));
  const seen = new Set<string>();
  for (const profile of customProfiles) {
    if (builtInIds.has(profile.id)) {
      throw new Error(`Custom policy profile cannot replace built-in profile: ${profile.id}`);
    }
    if (seen.has(profile.id)) {
      throw new Error(`Duplicate custom policy profile: ${profile.id}`);
    }
    seen.add(profile.id);
  }
}

function cloneProfile(profile: PolicyProfile): PolicyProfile {
  return {
    ...profile,
    policy: {
      ...profile.policy,
      deniedPaths: profile.policy.deniedPaths ? [...profile.policy.deniedPaths] : undefined,
      deniedFileExtensions: profile.policy.deniedFileExtensions ? [...profile.policy.deniedFileExtensions] : undefined,
      redactionPatterns: profile.policy.redactionPatterns ? [...profile.policy.redactionPatterns] : undefined,
      dlpPatterns: profile.policy.dlpPatterns ? [...profile.policy.dlpPatterns] : undefined
    },
    budget: profile.budget ? { ...profile.budget } : undefined
  };
}
