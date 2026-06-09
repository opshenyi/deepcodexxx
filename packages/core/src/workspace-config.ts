import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionRetentionPolicy } from "./session-store.js";
import type { ApprovalMode, ApprovalPolicy, BudgetPolicy, ProfileApprovalMode, ShellEnvironmentMode } from "./types.js";

export const WORKSPACE_CONFIG_RELATIVE_PATH = ".deepcodex/config.json";

export interface WorkspaceConfig {
  version?: number;
  model?: string;
  policyProfileId?: string;
  pricingProfileId?: string;
  approvalMode?: ProfileApprovalMode;
  maxSteps?: number;
  budget?: BudgetPolicy;
  policy?: Partial<ApprovalPolicy>;
  retention?: SessionRetentionPolicy;
}

export interface WorkspaceConfigReadResult {
  path: string;
  exists: boolean;
  config: WorkspaceConfig;
}

export interface WriteWorkspaceConfigOptions {
  overwrite?: boolean;
}

export async function readWorkspaceConfig(workspaceInput: string): Promise<WorkspaceConfigReadResult> {
  const root = await resolveWorkspaceRoot(workspaceInput);
  const filePath = workspaceConfigPath(root);
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (raw === undefined) {
    return { path: filePath, exists: false, config: {} };
  }

  try {
    return {
      path: filePath,
      exists: true,
      config: normalizeWorkspaceConfig(JSON.parse(raw))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid DeepCodex workspace config at ${filePath}: ${message}`);
  }
}

export async function writeWorkspaceConfigTemplate(
  workspaceInput: string,
  options: WriteWorkspaceConfigOptions = {}
): Promise<WorkspaceConfigReadResult> {
  const root = await resolveWorkspaceRoot(workspaceInput);
  const filePath = workspaceConfigPath(root);
  const existing = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (existing !== undefined && !options.overwrite) {
    throw new Error(`Workspace config already exists: ${filePath}`);
  }

  const config = createWorkspaceConfigTemplate();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { path: filePath, exists: true, config };
}

export function createWorkspaceConfigTemplate(): WorkspaceConfig {
  return {
    version: 1,
    model: "deepseek-chat",
    policyProfileId: "guarded-write",
    approvalMode: "manual",
    maxSteps: 12,
    pricingProfileId: "custom",
    budget: {
      maxTokens: 120000
    },
    policy: {
      shellEnvironment: "minimal",
      maxFileBytes: 512 * 1024,
      deniedPaths: ["secrets"],
      deniedFileExtensions: [".pem", ".sqlite"],
      redactionPatterns: ["ACME_[A-Z0-9]{16,}"]
    },
    retention: {
      maxSessions: 100,
      maxAgeDays: 30
    }
  };
}

function workspaceConfigPath(root: string): string {
  return path.join(root, WORKSPACE_CONFIG_RELATIVE_PATH);
}

async function resolveWorkspaceRoot(workspaceInput: string): Promise<string> {
  const root = path.resolve(workspaceInput || process.cwd());
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${root}`);
  }
  return root;
}

function normalizeWorkspaceConfig(value: unknown): WorkspaceConfig {
  const entry = readObject(value, "config");
  return removeUndefinedConfigValues({
    version: readOptionalNumber(entry.version, "version"),
    model: readOptionalString(entry.model, "model"),
    policyProfileId: readOptionalString(entry.policyProfileId, "policyProfileId"),
    pricingProfileId: readOptionalString(entry.pricingProfileId, "pricingProfileId"),
    approvalMode: readOptionalApprovalMode(entry.approvalMode),
    maxSteps: readOptionalInteger(entry.maxSteps, "maxSteps"),
    budget: normalizeBudgetConfig(entry.budget),
    policy: normalizePolicyConfig(entry.policy),
    retention: normalizeRetentionConfig(entry.retention)
  });
}

function normalizePolicyConfig(value: unknown): Partial<ApprovalPolicy> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entry = readObject(value, "policy");
  return removeUndefinedPolicyValues({
    mode: readOptionalMode(entry.mode),
    allowShell: readOptionalBoolean(entry.allowShell, "policy.allowShell"),
    allowNetwork: readOptionalBoolean(entry.allowNetwork, "policy.allowNetwork"),
    allowFileWrite: readOptionalBoolean(entry.allowFileWrite, "policy.allowFileWrite"),
    allowStateWrite: readOptionalBoolean(entry.allowStateWrite, "policy.allowStateWrite"),
    deniedPaths: readOptionalStringArray(entry.deniedPaths, "policy.deniedPaths"),
    deniedFileExtensions: readOptionalStringArray(entry.deniedFileExtensions, "policy.deniedFileExtensions"),
    redactionPatterns: readOptionalRegexArray(entry.redactionPatterns, "policy.redactionPatterns"),
    maxFileBytes: readOptionalNumber(entry.maxFileBytes, "policy.maxFileBytes"),
    shellEnvironment: readOptionalShellEnvironment(entry.shellEnvironment)
  });
}

function normalizeBudgetConfig(value: unknown): BudgetPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entry = readObject(value, "budget");
  return removeUndefinedBudgetValues({
    maxTokens: readOptionalNumber(entry.maxTokens, "budget.maxTokens"),
    maxEstimatedUsd: readOptionalNumber(entry.maxEstimatedUsd, "budget.maxEstimatedUsd"),
    inputUsdPerMillionTokens: readOptionalNumber(
      entry.inputUsdPerMillionTokens,
      "budget.inputUsdPerMillionTokens"
    ),
    outputUsdPerMillionTokens: readOptionalNumber(
      entry.outputUsdPerMillionTokens,
      "budget.outputUsdPerMillionTokens"
    )
  });
}

function normalizeRetentionConfig(value: unknown): SessionRetentionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entry = readObject(value, "retention");
  return removeUndefinedRetentionValues({
    maxSessions: readOptionalInteger(entry.maxSessions, "retention.maxSessions"),
    maxAgeDays: readOptionalNumber(entry.maxAgeDays, "retention.maxAgeDays"),
    dryRun: readOptionalBoolean(entry.dryRun, "retention.dryRun")
  });
}

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${field} must be an array of non-empty strings.`);
  }
  return value.map((entry) => entry.trim());
}

function readOptionalRegexArray(value: unknown, field: string): string[] | undefined {
  const patterns = readOptionalStringArray(value, field);
  if (!patterns) {
    return undefined;
  }
  for (const pattern of patterns) {
    try {
      new RegExp(pattern, "g");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${field} contains an invalid regular expression: ${message}`);
    }
  }
  return patterns;
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function readOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return parsed;
}

function readOptionalInteger(value: unknown, field: string): number | undefined {
  const parsed = readOptionalNumber(value, field);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be a whole number.`);
  }
  return parsed;
}

function readOptionalMode(value: unknown): ApprovalMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "suggest" || value === "workspace-write" || value === "full-access") {
    return value;
  }
  throw new Error("policy.mode must be suggest, workspace-write, or full-access.");
}

function readOptionalApprovalMode(value: unknown): ProfileApprovalMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "auto" || value === "manual" || value === "deny") {
    return value;
  }
  throw new Error("approvalMode must be auto, manual, or deny.");
}

function readOptionalShellEnvironment(value: unknown): ShellEnvironmentMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "minimal" || value === "inherit") {
    return value;
  }
  throw new Error("policy.shellEnvironment must be minimal or inherit.");
}

function removeUndefinedConfigValues(config: WorkspaceConfig): WorkspaceConfig {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as WorkspaceConfig;
}

function removeUndefinedPolicyValues(policy: Partial<ApprovalPolicy>): Partial<ApprovalPolicy> | undefined {
  const clean = Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined));
  return Object.keys(clean).length > 0 ? (clean as Partial<ApprovalPolicy>) : undefined;
}

function removeUndefinedBudgetValues(policy: BudgetPolicy): BudgetPolicy | undefined {
  const clean = Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined));
  return Object.keys(clean).length > 0 ? (clean as BudgetPolicy) : undefined;
}

function removeUndefinedRetentionValues(policy: SessionRetentionPolicy): SessionRetentionPolicy | undefined {
  const clean = Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined));
  return Object.keys(clean).length > 0 ? (clean as SessionRetentionPolicy) : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
