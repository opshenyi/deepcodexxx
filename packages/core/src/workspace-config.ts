import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { listPolicyProfiles } from "./policy-profile.js";
import {
  normalizeBaseUrl,
  normalizeDeepSeekThinking,
  normalizeModel,
  normalizeOptionalReasoningEffort
} from "./provider-policy.js";
import type { SessionRetentionPolicy } from "./session-store.js";
import type {
  ApprovalMode,
  ApprovalPolicy,
  BudgetPolicy,
  PolicyProfile,
  ProviderPolicy,
  ProfileApprovalMode,
  ShellEnvironmentMode,
  ShellExecutionMode
} from "./types.js";

export const WORKSPACE_CONFIG_RELATIVE_PATH = ".deepcodex/config.json";

export interface WorkspaceConfig {
  version?: number;
  model?: string;
  policyProfileId?: string;
  pricingProfileId?: string;
  provider?: ProviderPolicy;
  approvalMode?: ProfileApprovalMode;
  maxSteps?: number;
  policyProfiles?: PolicyProfile[];
  evals?: WorkspaceEvalTask[];
  budget?: BudgetPolicy;
  policy?: Partial<ApprovalPolicy>;
  retention?: SessionRetentionPolicy;
}

export interface WorkspaceEvalTask {
  id: string;
  label: string;
  description: string;
  prompt: string;
  profile: string;
  maxSteps: number;
  budget?: BudgetPolicy;
  expectedSignals: string[];
}

export interface WorkspaceConfigReadResult {
  path: string;
  exists: boolean;
  config: WorkspaceConfig;
  sha256?: string;
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
      config: normalizeWorkspaceConfig(JSON.parse(stripJsonBom(raw))),
      sha256: createSha256(raw)
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
  const raw = `${JSON.stringify(config, null, 2)}\n`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, raw, "utf8");
  return { path: filePath, exists: true, config, sha256: createSha256(raw) };
}

export function createWorkspaceConfigTemplate(): WorkspaceConfig {
  return {
    version: 1,
    model: "deepseek-v4-flash",
    provider: {
      baseUrl: "https://api.deepseek.com",
      fallbackModels: [],
      thinking: "disabled",
      allowedBaseUrls: ["https://api.deepseek.com"],
      allowedModels: ["deepseek-v4-flash"]
    },
    policyProfileId: "guarded-write",
    approvalMode: "manual",
    maxSteps: 12,
    pricingProfileId: "custom",
    evals: [
      {
        id: "workspace-release-smoke",
        label: "Workspace release smoke",
        description: "Team-owned read-only release evidence check for this repository.",
        prompt:
          "Inspect this repository in read-only mode. Summarize release evidence, verification commands, and remaining documented risks. Do not modify files.",
        profile: "inspection",
        maxSteps: 6,
        budget: {
          maxTokens: 60000
        },
        expectedSignals: ["release checklist", "runbook", "product readiness"]
      }
    ],
    policyProfiles: [
      {
        id: "team-review",
        label: "Team review",
        description: "Team-managed workspace-write profile with manual approvals and a tighter run budget.",
        approvalMode: "manual",
        maxSteps: 10,
        policy: {
          mode: "workspace-write",
          allowShell: true,
          allowFileWrite: true,
          allowNetwork: false,
          allowStateWrite: true,
          allowSecretWrites: false,
          allowArchiveListing: false,
          allowPdfTextExtraction: false,
          shellEnvironment: "minimal",
          shellExecutionMode: "direct",
          deniedShellCommands: ["\\bterraform\\s+apply\\b", "\\bkubectl\\s+delete\\b"]
        },
        budget: {
          maxTokens: 80000
        }
      }
    ],
    budget: {
      maxTokens: 120000
    },
    policy: {
      allowSecretWrites: false,
      allowArchiveListing: false,
      allowPdfTextExtraction: false,
      shellEnvironment: "minimal",
      shellExecutionMode: "direct",
      maxFileBytes: 512 * 1024,
      deniedPaths: ["secrets"],
      deniedFileExtensions: [".pem", ".sqlite"],
      redactionPatterns: ["ACME_[A-Z0-9]{16,}"],
      dlpPatterns: ["ACME_SECRET_[A-Z0-9]{16,}"],
      deniedShellCommands: ["\\bterraform\\s+apply\\b", "\\bkubectl\\s+delete\\b"]
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
    provider: normalizeProviderConfig(entry.provider),
    policyProfileId: readOptionalString(entry.policyProfileId, "policyProfileId"),
    pricingProfileId: readOptionalString(entry.pricingProfileId, "pricingProfileId"),
    approvalMode: readOptionalApprovalMode(entry.approvalMode),
    maxSteps: readOptionalInteger(entry.maxSteps, "maxSteps"),
    policyProfiles: normalizePolicyProfilesConfig(entry.policyProfiles),
    evals: normalizeWorkspaceEvalsConfig(entry.evals),
    budget: normalizeBudgetConfig(entry.budget),
    policy: normalizePolicyConfig(entry.policy),
    retention: normalizeRetentionConfig(entry.retention)
  });
}

function normalizeProviderConfig(value: unknown): ProviderPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entry = readObject(value, "provider");
  return removeUndefinedProviderValues({
    baseUrl: readOptionalBaseUrl(entry.baseUrl, "provider.baseUrl"),
    fallbackModels: readOptionalModelArray(entry.fallbackModels, "provider.fallbackModels"),
    thinking: readOptionalDeepSeekThinking(entry.thinking, "provider.thinking"),
    reasoningEffort: readOptionalReasoningEffort(entry.reasoningEffort, "provider.reasoningEffort"),
    allowedBaseUrls: readOptionalBaseUrlArray(entry.allowedBaseUrls, "provider.allowedBaseUrls"),
    allowedModels: readOptionalStringArray(entry.allowedModels, "provider.allowedModels")
  });
}

function normalizePolicyProfilesConfig(value: unknown): PolicyProfile[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("policyProfiles must be an array.");
  }

  const profiles = value.map((entry, index) => normalizePolicyProfileConfig(entry, `policyProfiles[${index}]`));
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (profile.id === "custom") {
      throw new Error("policyProfiles cannot use reserved id: custom");
    }
    if (seen.has(profile.id)) {
      throw new Error(`Duplicate policyProfiles id: ${profile.id}`);
    }
    seen.add(profile.id);
  }
  listPolicyProfiles(profiles);
  return profiles;
}

function normalizeWorkspaceEvalsConfig(value: unknown): WorkspaceEvalTask[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("evals must be an array.");
  }

  const tasks = value.map((entry, index) => normalizeWorkspaceEvalConfig(entry, `evals[${index}]`));
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate evals id: ${task.id}`);
    }
    seen.add(task.id);
  }
  return tasks;
}

function normalizeWorkspaceEvalConfig(value: unknown, field: string): WorkspaceEvalTask {
  const entry = readObject(value, field);
  return {
    id: readRequiredEvalId(entry.id, `${field}.id`),
    label: readRequiredString(entry.label, `${field}.label`),
    description: readRequiredString(entry.description, `${field}.description`),
    prompt: readRequiredString(entry.prompt, `${field}.prompt`),
    profile: readRequiredString(entry.profile, `${field}.profile`),
    maxSteps: readRequiredInteger(entry.maxSteps, `${field}.maxSteps`),
    budget: normalizeBudgetConfig(entry.budget),
    expectedSignals: readRequiredStringArray(entry.expectedSignals, `${field}.expectedSignals`)
  };
}

function normalizePolicyProfileConfig(value: unknown, field: string): PolicyProfile {
  const entry = readObject(value, field);
  const policy = normalizePolicyConfig(entry.policy);
  if (!policy?.mode) {
    throw new Error(`${field}.policy.mode is required.`);
  }
  return {
    id: readRequiredString(entry.id, `${field}.id`),
    label: readRequiredString(entry.label, `${field}.label`),
    description: readRequiredString(entry.description, `${field}.description`),
    approvalMode: readOptionalApprovalMode(entry.approvalMode) ?? "manual",
    maxSteps: readOptionalInteger(entry.maxSteps, `${field}.maxSteps`),
    policy: {
      ...policy,
      mode: policy.mode
    },
    budget: normalizeBudgetConfig(entry.budget)
  };
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
    allowSecretWrites: readOptionalBoolean(entry.allowSecretWrites, "policy.allowSecretWrites"),
    allowArchiveListing: readOptionalBoolean(entry.allowArchiveListing, "policy.allowArchiveListing"),
    allowPdfTextExtraction: readOptionalBoolean(entry.allowPdfTextExtraction, "policy.allowPdfTextExtraction"),
    deniedPaths: readOptionalStringArray(entry.deniedPaths, "policy.deniedPaths"),
    deniedFileExtensions: readOptionalStringArray(entry.deniedFileExtensions, "policy.deniedFileExtensions"),
    redactionPatterns: readOptionalRegexArray(entry.redactionPatterns, "policy.redactionPatterns"),
    dlpPatterns: readOptionalRegexArray(entry.dlpPatterns, "policy.dlpPatterns"),
    maxFileBytes: readOptionalNumber(entry.maxFileBytes, "policy.maxFileBytes"),
    shellEnvironment: readOptionalShellEnvironment(entry.shellEnvironment),
    shellExecutionMode: readOptionalShellExecutionMode(entry.shellExecutionMode),
    allowedShellCommands: readOptionalRegexArray(entry.allowedShellCommands, "policy.allowedShellCommands"),
    deniedShellCommands: readOptionalRegexArray(entry.deniedShellCommands, "policy.deniedShellCommands")
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

function readRequiredString(value: unknown, field: string): string {
  const parsed = readOptionalString(value, field);
  if (!parsed) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return parsed;
}

function readRequiredEvalId(value: unknown, field: string): string {
  const parsed = readRequiredString(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(parsed)) {
    throw new Error(`${field} must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.`);
  }
  return parsed;
}

function readRequiredStringArray(value: unknown, field: string): string[] {
  const parsed = readOptionalStringArray(value, field);
  if (!parsed || parsed.length === 0) {
    throw new Error(`${field} must be a non-empty array of strings.`);
  }
  return parsed;
}

function readRequiredInteger(value: unknown, field: string): number {
  const parsed = readOptionalInteger(value, field);
  if (parsed === undefined || parsed < 1) {
    throw new Error(`${field} must be a positive whole number.`);
  }
  return parsed;
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

function readOptionalBaseUrl(value: unknown, field: string): string | undefined {
  const url = readOptionalString(value, field);
  if (!url) {
    return undefined;
  }
  try {
    return normalizeBaseUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${field} is invalid: ${message}`);
  }
}

function readOptionalBaseUrlArray(value: unknown, field: string): string[] | undefined {
  const urls = readOptionalStringArray(value, field);
  return urls?.map((url) => {
    try {
      return normalizeBaseUrl(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${field} contains an invalid URL: ${message}`);
    }
  });
}

function readOptionalModelArray(value: unknown, field: string): string[] | undefined {
  const models = readOptionalStringArray(value, field);
  return models?.map((model) => {
    try {
      return normalizeModel(model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${field} contains an invalid model: ${message}`);
    }
  });
}

function readOptionalDeepSeekThinking(value: unknown, field: string): ProviderPolicy["thinking"] {
  const raw = readOptionalString(value, field);
  if (!raw) {
    return undefined;
  }
  try {
    return normalizeDeepSeekThinking(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${field} is invalid: ${message}`);
  }
}

function readOptionalReasoningEffort(value: unknown, field: string): ProviderPolicy["reasoningEffort"] {
  const raw = readOptionalString(value, field);
  try {
    return normalizeOptionalReasoningEffort(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${field} is invalid: ${message}`);
  }
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

function readOptionalShellExecutionMode(value: unknown): ShellExecutionMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "direct" || value === "workspace-copy") {
    return value;
  }
  throw new Error("policy.shellExecutionMode must be direct or workspace-copy.");
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

function removeUndefinedProviderValues(policy: ProviderPolicy): ProviderPolicy | undefined {
  const clean = Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined));
  return Object.keys(clean).length > 0 ? (clean as ProviderPolicy) : undefined;
}

function removeUndefinedRetentionValues(policy: SessionRetentionPolicy): SessionRetentionPolicy | undefined {
  const clean = Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined));
  return Object.keys(clean).length > 0 ? (clean as SessionRetentionPolicy) : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function createSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stripJsonBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
