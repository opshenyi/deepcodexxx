#!/usr/bin/env node
import "dotenv/config";
import chalk from "chalk";
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createSessionRecorder,
  createWorkspaceContext,
  exportSessionHistory,
  applyPricingProfileToBudget,
  listSessionHistories,
  listPolicyProfiles,
  parseSessionExportFormat,
  parsePricingProfiles,
  pruneSessionHistories,
  readSessionHistory,
  readWorkspaceConfig,
  readWorkspaceMemory,
  resolvePricingProfile,
  resolvePolicyProfile,
  verifyWorkspacePolicyBundle,
  assertProviderAllowed,
  resolveProviderSelection,
  runDeepCodexAgent,
  writeWorkspaceConfigTemplate
} from "@deepcodex/core";
import type {
  AgentEvent,
  ApprovalPolicy,
  BudgetPolicy,
  BudgetSnapshot,
  FileAuditEntry,
  FileHashSnapshot,
  PolicyBundleVerificationResult,
  PolicyProfile,
  SessionRetentionPolicy,
  ShellEnvironmentMode,
  ToolAuditMetadata,
  SessionEventRecorder,
  ToolApprovalDecision,
  ToolApprovalRequest,
  WorkspaceConfig
} from "@deepcodex/core";

const program = new Command();

program
  .name("deepcodex")
  .description("DeepSeek-powered coding agent for local workspaces.")
  .version("0.1.0");

program
  .command("ask")
  .argument("<prompt...>", "Task for the coding agent")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--profile <profile>", "inspection, guarded-write, full-access-review, or custom")
  .option("--mode <mode>", "suggest, workspace-write, or full-access")
  .option("--approval <mode>", "auto, prompt/manual, or deny")
  .option("--max-steps <number>", "Maximum agent loop count")
  .option("--max-session-tokens <number>", "Stop when cumulative model tokens reach this session limit")
  .option("--max-session-usd <number>", "Stop when estimated model cost reaches this USD limit")
  .option("--input-usd-per-million-tokens <number>", "Input token price used for cost budget estimates")
  .option("--output-usd-per-million-tokens <number>", "Output token price used for cost budget estimates")
  .option("--pricing-profile <profile>", "Pricing profile id from DEEPCODEX_PRICING_PROFILES")
  .option("--shell-env <mode>", "minimal or inherit")
  .option("--allow-network", "Allow shell commands that perform network access", false)
  .action(
    async (
      promptParts: string[],
      options: {
        workspace: string;
        mode?: string;
        approval?: string;
        maxSteps?: string;
        profile?: string;
        maxSessionTokens?: string;
        maxSessionUsd?: string;
        inputUsdPerMillionTokens?: string;
        outputUsdPerMillionTokens?: string;
        pricingProfile?: string;
        shellEnv?: string;
        allowNetwork?: boolean;
      }
    ) => {
      const workspaceConfig = await readWorkspaceConfig(options.workspace);
      await assertSignedPolicyIfRequired(options.workspace);
      const profile = resolveCliProfile(options.profile, workspaceConfig.config);
      const provider = readProviderSelection(workspaceConfig.config);
      assertProviderAllowed(provider, workspaceConfig.config.provider);
      const approvalMode = parseCliApprovalMode(
        options.approval ?? workspaceConfig.config.approvalMode ?? profile?.approvalMode ?? "auto"
      );
      const rl = approvalMode === "prompt" ? createInterface({ input, output }) : undefined;
      try {
        const policy = createPolicy(options.mode, options.shellEnv, options.allowNetwork, profile, workspaceConfig.config);
        const workspace = await createWorkspaceContext(options.workspace, policy);
        const recorder = policy.allowStateWrite === false ? undefined : createSessionRecorder(workspace);
        await runDeepCodexAgent({
          prompt: promptParts.join(" "),
          workspace: workspace.root,
          baseUrl: provider.baseUrl,
          model: provider.model,
          maxSteps: readOptionalInteger(options.maxSteps) ?? workspaceConfig.config.maxSteps ?? profile?.maxSteps ?? 12,
          policy,
          budget: createBudgetPolicy(options, profile?.budget, options.pricingProfile, workspaceConfig.config),
          requestToolApproval: createCliApprovalHandler(approvalMode, rl),
          onEvent: createCliEventHandler(recorder)
        });
      } finally {
        rl?.close();
      }
    }
  );

program
  .command("chat")
  .description("Start an interactive DeepCodex session.")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--profile <profile>", "inspection, guarded-write, full-access-review, or custom")
  .option("--mode <mode>", "suggest, workspace-write, or full-access")
  .option("--approval <mode>", "auto, prompt/manual, or deny")
  .option("--max-session-tokens <number>", "Stop when cumulative model tokens reach this session limit")
  .option("--max-session-usd <number>", "Stop when estimated model cost reaches this USD limit")
  .option("--input-usd-per-million-tokens <number>", "Input token price used for cost budget estimates")
  .option("--output-usd-per-million-tokens <number>", "Output token price used for cost budget estimates")
  .option("--pricing-profile <profile>", "Pricing profile id from DEEPCODEX_PRICING_PROFILES")
  .option("--shell-env <mode>", "minimal or inherit")
  .option("--allow-network", "Allow shell commands that perform network access", false)
  .option("--max-steps <number>", "Maximum agent loop count")
  .action(async (options: {
    workspace: string;
    mode?: string;
    approval?: string;
    profile?: string;
    maxSessionTokens?: string;
    maxSessionUsd?: string;
    inputUsdPerMillionTokens?: string;
    outputUsdPerMillionTokens?: string;
    pricingProfile?: string;
    shellEnv?: string;
    allowNetwork?: boolean;
    maxSteps?: string;
  }) => {
    const rl = createInterface({ input, output });
    const workspaceConfig = await readWorkspaceConfig(options.workspace);
    await assertSignedPolicyIfRequired(options.workspace);
    const profile = resolveCliProfile(options.profile, workspaceConfig.config);
    const provider = readProviderSelection(workspaceConfig.config);
    assertProviderAllowed(provider, workspaceConfig.config.provider);
    const approvalMode = parseCliApprovalMode(
      options.approval ?? workspaceConfig.config.approvalMode ?? profile?.approvalMode ?? "auto"
    );
    console.log(chalk.gray("DeepCodex interactive session. Submit an empty line to exit."));
    try {
      while (true) {
        const prompt = (await rl.question(chalk.bold("task> "))).trim();
        if (!prompt) {
          break;
        }
        const policy = createPolicy(options.mode, options.shellEnv, options.allowNetwork, profile, workspaceConfig.config);
        const workspace = await createWorkspaceContext(options.workspace, policy);
        const recorder = policy.allowStateWrite === false ? undefined : createSessionRecorder(workspace);
        await runDeepCodexAgent({
          prompt,
          workspace: workspace.root,
          baseUrl: provider.baseUrl,
          model: provider.model,
          maxSteps: readOptionalInteger(options.maxSteps) ?? workspaceConfig.config.maxSteps ?? profile?.maxSteps ?? 12,
          policy,
          budget: createBudgetPolicy(options, profile?.budget, options.pricingProfile, workspaceConfig.config),
          requestToolApproval: createCliApprovalHandler(approvalMode, rl),
          onEvent: createCliEventHandler(recorder)
        });
      }
    } finally {
      rl.close();
    }
  });

program
  .command("memory")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .action(async (options: { workspace: string }) => {
    const workspace = await createWorkspaceContext(options.workspace);
    console.log(await readWorkspaceMemory(workspace));
  });

const sessions = program.command("sessions").description("Inspect persisted DeepCodex session history.");

const profiles = program.command("profiles").description("Inspect reusable DeepCodex policy profiles.");
const pricing = program.command("pricing").description("Inspect configured DeepCodex pricing profiles.");
const config = program.command("config").description("Inspect or create workspace-level DeepCodex defaults.");

config
  .command("show")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (options: { workspace: string; json: boolean }) => {
    const result = await readWorkspaceConfig(options.workspace);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Config path: ${result.path}`);
    console.log(`Config status: ${result.exists ? "present" : "missing"}`);
    console.log(`Config SHA-256: ${result.sha256 ? result.sha256.slice(0, 12) : "not available"}`);
    if (result.exists) {
      console.log(JSON.stringify(result.config, null, 2));
    }
  });

config
  .command("init")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--force", "Overwrite an existing workspace config", false)
  .action(async (options: { workspace: string; force: boolean }) => {
    const result = await writeWorkspaceConfigTemplate(options.workspace, { overwrite: options.force });
    console.log(`Created workspace config: ${result.path}`);
  });

config
  .command("verify-bundle")
  .description("Verify a signed workspace policy bundle against the active workspace config.")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--public-key <path>", "Trusted Ed25519 public key PEM path")
  .option("--json", "Print JSON output", false)
  .action(async (options: { workspace: string; publicKey?: string; json: boolean }) => {
    const publicKey = await readPolicyBundlePublicKey(options.publicKey);
    const result = await verifyWorkspacePolicyBundle(options.workspace, { publicKey });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printPolicyBundleVerification(result);
    if (!result.ok) {
      process.exitCode = 1;
    }
  });

profiles
  .command("list")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (options: { workspace: string; json: boolean }) => {
    const workspaceConfig = await readWorkspaceConfig(options.workspace);
    const entries = listPolicyProfiles(workspaceConfig.config.policyProfiles);
    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    for (const profile of entries) {
      console.log(`${profile.id}  ${profile.label}  ${profile.approvalMode}  ${profile.policy.mode}`);
      console.log(`  ${profile.description}`);
    }
  });

profiles
  .command("show")
  .argument("<profile>", "Profile id")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .action(async (profileId: string, options: { workspace: string }) => {
    const workspaceConfig = await readWorkspaceConfig(options.workspace);
    console.log(JSON.stringify(resolvePolicyProfile(profileId, workspaceConfig.config.policyProfiles), null, 2));
  });

pricing
  .command("list")
  .option("--json", "Print JSON output", false)
  .action((options: { json: boolean }) => {
    const entries = readPricingProfilesFromEnv();
    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      console.log("No pricing profiles configured.");
      return;
    }
    for (const profile of entries) {
      console.log(
        `${profile.id}  ${profile.label}  ${profile.inputUsdPerMillionTokens} input / ${profile.outputUsdPerMillionTokens} output USD per 1M tokens`
      );
      if (profile.description) {
        console.log(`  ${profile.description}`);
      }
    }
  });

pricing
  .command("show")
  .argument("<profile>", "Pricing profile id")
  .action((profileId: string) => {
    console.log(JSON.stringify(resolvePricingProfile(readPricingProfilesFromEnv(), profileId), null, 2));
  });

sessions
  .command("list")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (options: { workspace: string; json: boolean }) => {
    const workspace = await createWorkspaceContext(options.workspace);
    const histories = await listSessionHistories(workspace);
    if (options.json) {
      console.log(JSON.stringify(histories, null, 2));
      return;
    }
    if (histories.length === 0) {
      console.log("No sessions found.");
      return;
    }
    for (const session of histories) {
      console.log(
        `${session.sessionId}  ${session.status}  ${session.eventCount} events  ${
          session.tokenUsage?.totalTokens ?? 0
        } tokens  ${session.updatedAt}  ${session.lastEventType ?? "none"}`
      );
    }
  });

sessions
  .command("show")
  .argument("<sessionId>", "Session id")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (sessionId: string, options: { workspace: string; json: boolean }) => {
    const workspace = await createWorkspaceContext(options.workspace);
    const history = await readSessionHistory(workspace, sessionId);
    if (options.json) {
      console.log(JSON.stringify(history, null, 2));
      return;
    }
    console.log(`${history.sessionId}  ${history.status}  ${history.eventCount} events`);
    console.log(`workspace ${history.workspace}`);
    console.log(`updated ${history.updatedAt}`);
    console.log(`tokens ${history.tokenUsage?.totalTokens ?? 0}`);
    if (history.finalContent) {
      console.log("\nfinal");
      console.log(history.finalContent);
    }
    if (history.errorMessage) {
      console.log("\nerror");
      console.log(history.errorMessage);
    }
  });

sessions
  .command("export")
  .argument("<sessionId>", "Session id")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--format <format>", "markdown or json", "markdown")
  .action(async (sessionId: string, options: { workspace: string; format: string }) => {
    const workspace = await createWorkspaceContext(options.workspace);
    const history = await readSessionHistory(workspace, sessionId);
    output.write(exportSessionHistory(history, parseSessionExportFormat(options.format)));
  });

sessions
  .command("prune")
  .description("Prune persisted session history files by count or age.")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--max-sessions <number>", "Keep only the newest N sessions")
  .option("--max-age-days <number>", "Delete sessions older than this many days")
  .option("--dry-run", "Show what would be deleted without removing files", false)
  .action(
    async (options: { workspace: string; maxSessions?: string; maxAgeDays?: string; dryRun: boolean }) => {
      const workspaceConfig = await readWorkspaceConfig(options.workspace);
      const workspace = await createWorkspaceContext(options.workspace);
      const result = await pruneSessionHistories(workspace, createRetentionPolicy(options, workspaceConfig.config));
      console.log(
        `scanned ${result.scanned} sessions, retained ${result.retained}, ${
          result.dryRun ? "would delete" : "deleted"
        } ${result.deleted.length}`
      );
      for (const sessionId of result.deleted) {
        console.log(sessionId);
      }
    }
  );

program
  .command("doctor")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .action(async (options: { workspace: string }) => {
    const workspaceConfig = await readWorkspaceConfig(options.workspace);
    const profile = resolveCliProfile(undefined, workspaceConfig.config);
    const basePolicy: Partial<ApprovalPolicy> = { ...profile?.policy, ...(workspaceConfig.config.policy ?? {}) };
    const provider = readProviderSelection(workspaceConfig.config);
    const policyBundleStatus = await readPolicyBundleStatus(options.workspace);
    console.log(`DeepSeek API key: ${process.env.DEEPSEEK_API_KEY ? "configured" : "missing"}`);
    console.log(`DeepSeek base URL: ${provider.baseUrl}`);
    console.log(`DeepSeek model: ${provider.model}`);
    console.log(`Provider max retries: ${process.env.DEEPCODEX_PROVIDER_MAX_RETRIES ?? "2"}`);
    console.log(`Provider retry base delay ms: ${process.env.DEEPCODEX_PROVIDER_RETRY_BASE_MS ?? "500"}`);
    console.log(`Allowed provider base URLs: ${workspaceConfig.config.provider?.allowedBaseUrls?.length ?? 0}`);
    console.log(`Allowed provider models: ${workspaceConfig.config.provider?.allowedModels?.length ?? 0}`);
    console.log(`Max session tokens: ${process.env.DEEPCODEX_MAX_SESSION_TOKENS ?? "not set"}`);
    console.log(`Max session USD: ${process.env.DEEPCODEX_MAX_SESSION_USD ?? "not set"}`);
    console.log(
      `Input USD per million tokens: ${process.env.DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS ?? "not set"}`
    );
    console.log(
      `Output USD per million tokens: ${process.env.DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS ?? "not set"}`
    );
    console.log(`Policy profile: ${process.env.DEEPCODEX_POLICY_PROFILE ?? workspaceConfig.config.policyProfileId ?? "custom"}`);
    console.log(`Workspace policy profiles: ${workspaceConfig.config.policyProfiles?.length ?? 0}`);
    console.log(`Approval mode: ${workspaceConfig.config.approvalMode ?? "profile/default"}`);
    console.log(`Pricing profile: ${process.env.DEEPCODEX_PRICING_PROFILE ?? workspaceConfig.config.pricingProfileId ?? "custom"}`);
    console.log(`Configured pricing profiles: ${readPricingProfilesFromEnv().length}`);
    console.log(`Shell environment: ${process.env.DEEPCODEX_SHELL_ENV ?? basePolicy.shellEnvironment ?? "minimal"}`);
    console.log(`Shell network access: ${resolveAllowNetworkPolicy(false, basePolicy.allowNetwork) ? "allowed" : "blocked"}`);
    console.log(`Workspace config: ${workspaceConfig.exists ? workspaceConfig.path : "missing"}`);
    console.log(`Workspace config SHA-256: ${workspaceConfig.sha256 ? workspaceConfig.sha256.slice(0, 12) : "not available"}`);
    console.log(`Policy bundle: ${policyBundleStatus}`);
    console.log(`Signed policy required: ${readRequireSignedPolicyFromEnv() ? "yes" : "no"}`);
    console.log(`Workspace max steps: ${workspaceConfig.config.maxSteps ?? "profile/default"}`);
    console.log(`Node: ${process.version}`);
  });

try {
  await program.parseAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(message));
  process.exitCode = 1;
}

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "session_started":
      console.log(chalk.gray(`session ${event.sessionId}`));
      console.log(chalk.gray(`workspace ${event.workspace}`));
      console.log(chalk.gray(`model ${event.model}`));
      break;
    case "model_usage":
      console.log(
        chalk.gray(
          `usage ${event.totalTokens} tokens (${event.promptTokens} prompt / ${event.completionTokens} completion)`
        )
      );
      break;
    case "budget_updated":
      console.log(chalk.gray(formatBudgetLine(event.budget)));
      break;
    case "budget_exceeded":
      console.log(chalk.red(event.message));
      break;
    case "step":
      console.log(chalk.gray(`step ${event.index}/${event.maxSteps}`));
      break;
    case "assistant_message":
      console.log(event.content);
      break;
    case "tool_approval_requested":
      console.log(chalk.yellow(`approval requested ${event.name} (${event.risk}) at ${event.requestedAt}`));
      console.log(event.reason);
      break;
    case "tool_approval_resolved":
      console.log(
        event.approved
          ? chalk.green(`approval granted ${event.name} by ${event.actor ?? "unknown"} in ${event.decisionLatencyMs}ms`)
          : chalk.red(
              `approval denied ${event.name} by ${event.actor ?? "unknown"} in ${event.decisionLatencyMs}ms: ${
                event.reason ?? "No reason provided."
              }`
            )
      );
      break;
    case "tool_started":
      console.log(chalk.cyan(`tool ${event.name}`));
      break;
    case "tool_finished":
      console.log(event.ok ? chalk.green(formatToolOutput(event.output, event.audit)) : chalk.red(formatToolOutput(event.output, event.audit)));
      break;
    case "final":
      console.log(chalk.bold("\nfinal"));
      console.log(event.content);
      break;
    case "error":
      console.error(chalk.red(event.message));
      break;
  }
}

function parseMode(value: string): "suggest" | "workspace-write" | "full-access" {
  if (value === "suggest" || value === "workspace-write" || value === "full-access") {
    return value;
  }
  throw new Error("mode must be suggest, workspace-write, or full-access");
}

function resolveCliProfile(profileId?: string, config?: WorkspaceConfig): PolicyProfile | undefined {
  return resolvePolicyProfile(
    profileId ?? process.env.DEEPCODEX_POLICY_PROFILE ?? config?.policyProfileId,
    config?.policyProfiles
  );
}

function createPolicy(
  mode: string | undefined,
  shellEnv: string | undefined,
  allowNetwork: boolean | undefined,
  profile?: PolicyProfile,
  config?: WorkspaceConfig
): ApprovalPolicy {
  const configPolicy = config?.policy ?? {};
  const base: Partial<ApprovalPolicy> = { ...profile?.policy, ...configPolicy };
  const selectedMode = mode ? parseMode(mode) : (configPolicy.mode ?? profile?.policy.mode ?? "workspace-write");
  const selectedShellEnv =
    shellEnv ?? process.env.DEEPCODEX_SHELL_ENV ?? base.shellEnvironment ?? "minimal";
  return {
    ...base,
    mode: selectedMode,
    allowFileWrite: selectedMode !== "suggest" && (base.allowFileWrite ?? true),
    allowShell: selectedMode !== "suggest" && (base.allowShell ?? true),
    allowNetwork: selectedMode !== "suggest" && resolveAllowNetworkPolicy(allowNetwork, base.allowNetwork),
    allowStateWrite: selectedMode !== "suggest" && (base.allowStateWrite ?? true),
    deniedPaths: mergeStringLists(base.deniedPaths, readDeniedPathsFromEnv()),
    deniedFileExtensions: mergeStringLists(base.deniedFileExtensions, readDeniedFileExtensionsFromEnv()),
    maxFileBytes: readMaxFileBytesFromEnv() ?? base.maxFileBytes,
    shellEnvironment: parseShellEnvironmentMode(selectedShellEnv)
  };
}

function readAllowNetworkFromEnv(): boolean | undefined {
  return readOptionalBooleanEnv(process.env.DEEPCODEX_ALLOW_NETWORK, "DEEPCODEX_ALLOW_NETWORK");
}

function resolveAllowNetworkPolicy(cliAllowNetwork: boolean | undefined, configuredAllowNetwork: boolean | undefined): boolean {
  if (cliAllowNetwork === true) {
    return true;
  }
  return readAllowNetworkFromEnv() ?? configuredAllowNetwork ?? false;
}

function readProviderSelection(config?: WorkspaceConfig) {
  return resolveProviderSelection({
    baseUrl: process.env.DEEPSEEK_BASE_URL || config?.provider?.baseUrl,
    model: process.env.DEEPSEEK_MODEL || config?.model
  });
}

async function readPolicyBundlePublicKey(publicKeyPath?: string): Promise<string | undefined> {
  const selectedPath = publicKeyPath || process.env.DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE;
  if (selectedPath) {
    return readFile(selectedPath, "utf8");
  }
  return process.env.DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY;
}

async function readPolicyBundleStatus(workspace: string): Promise<string> {
  try {
    const result = await verifyWorkspacePolicyBundle(workspace, { publicKey: await readPolicyBundlePublicKey() });
    if (!result.exists) {
      return "missing";
    }
    if (result.ok) {
      return `trusted ${result.bundleSha256?.slice(0, 12) ?? "unknown"}`;
    }
    if (result.signatureVerified) {
      return `untrusted ${result.bundleSha256?.slice(0, 12) ?? "unknown"}`;
    }
    return `failed ${result.reason}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `failed ${message}`;
  }
}

async function assertSignedPolicyIfRequired(workspace: string): Promise<void> {
  if (!readRequireSignedPolicyFromEnv()) {
    return;
  }
  const result = await verifyWorkspacePolicyBundle(workspace, { publicKey: await readPolicyBundlePublicKey() });
  if (!result.ok) {
    throw new Error(`Signed policy is required but policy bundle verification failed: ${result.reason}`);
  }
}

function readRequireSignedPolicyFromEnv(): boolean {
  return readOptionalBooleanEnv(process.env.DEEPCODEX_REQUIRE_SIGNED_POLICY, "DEEPCODEX_REQUIRE_SIGNED_POLICY") ?? false;
}

function printPolicyBundleVerification(result: PolicyBundleVerificationResult): void {
  console.log(`Policy bundle: ${result.exists ? result.path : "missing"}`);
  console.log(`Status: ${result.ok ? "trusted" : result.signatureVerified ? "untrusted" : "failed"}`);
  console.log(`Signature verified: ${result.signatureVerified ? "yes" : "no"}`);
  console.log(`Trusted key: ${result.trusted ? "yes" : "no"}`);
  console.log(`Reason: ${result.reason}`);
  if (result.issuer) {
    console.log(`Issuer: ${result.issuer}`);
  }
  if (result.configSha256) {
    console.log(`Config SHA-256: ${result.configSha256}`);
  }
  if (result.bundleSha256) {
    console.log(`Bundle SHA-256: ${result.bundleSha256}`);
  }
  if (result.publicKeySha256) {
    console.log(`Public key SHA-256: ${result.publicKeySha256}`);
  }
}

function parseShellEnvironmentMode(value: string): ShellEnvironmentMode {
  if (value === "minimal" || value === "inherit") {
    return value;
  }
  throw new Error("shell-env must be minimal or inherit");
}

function createRetentionPolicy(options: {
  maxSessions?: string;
  maxAgeDays?: string;
  dryRun?: boolean;
}, config?: WorkspaceConfig): SessionRetentionPolicy {
  const merged: SessionRetentionPolicy = {
    ...config?.retention,
    ...removeUndefinedRetentionValues({
      maxSessions: readOptionalInteger(process.env.DEEPCODEX_MAX_SESSIONS),
      maxAgeDays: readOptionalNumber(process.env.DEEPCODEX_SESSION_RETENTION_DAYS)
    })
  };
  const cliPolicy = removeUndefinedRetentionValues({
    maxSessions: readOptionalInteger(options.maxSessions),
    maxAgeDays: readOptionalNumber(options.maxAgeDays),
    dryRun: options.dryRun
  });
  return removeUndefinedRetentionValues({ ...merged, ...cliPolicy });
}

function createBudgetPolicy(options: {
  maxSessionTokens?: string;
  maxSessionUsd?: string;
  inputUsdPerMillionTokens?: string;
  outputUsdPerMillionTokens?: string;
}, profileBudget?: BudgetPolicy, pricingProfileId?: string, config?: WorkspaceConfig): BudgetPolicy | undefined {
  const pricingProfile = resolvePricingProfile(
    readPricingProfilesFromEnv(),
    pricingProfileId ?? process.env.DEEPCODEX_PRICING_PROFILE ?? config?.pricingProfileId
  );
  const merged: BudgetPolicy = {
    ...removeUndefinedBudgetValues(profileBudget ?? {}),
    ...removeUndefinedBudgetValues(config?.budget ?? {}),
    ...removeUndefinedBudgetValues({
    maxTokens: readOptionalNumber(process.env.DEEPCODEX_MAX_SESSION_TOKENS),
    maxEstimatedUsd: readOptionalNumber(process.env.DEEPCODEX_MAX_SESSION_USD),
    inputUsdPerMillionTokens: readOptionalNumber(process.env.DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS),
    outputUsdPerMillionTokens: readOptionalNumber(process.env.DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS)
    })
  };

  const cliBudget: BudgetPolicy = {
    maxTokens: readOptionalNumber(options.maxSessionTokens),
    maxEstimatedUsd: readOptionalNumber(options.maxSessionUsd),
    inputUsdPerMillionTokens: readOptionalNumber(options.inputUsdPerMillionTokens),
    outputUsdPerMillionTokens: readOptionalNumber(options.outputUsdPerMillionTokens)
  };

  const budget = { ...merged, ...removeUndefinedBudgetValues(cliBudget) };
  const withPricing = removeUndefinedBudgetValues(applyPricingProfileToBudget(budget, pricingProfile) ?? {});
  return Object.values(withPricing).some((value) => value !== undefined) ? withPricing : undefined;
}

function readPricingProfilesFromEnv() {
  return parsePricingProfiles(process.env.DEEPCODEX_PRICING_PROFILES);
}

function removeUndefinedBudgetValues(policy: BudgetPolicy): BudgetPolicy {
  return Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) as BudgetPolicy;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Budget values must be non-negative numbers.");
  }
  return parsed;
}

function readOptionalInteger(value: unknown): number | undefined {
  const parsed = readOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error("Retention integer values must be whole numbers.");
  }
  return parsed;
}

function removeUndefinedRetentionValues(policy: SessionRetentionPolicy): SessionRetentionPolicy {
  return Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) as SessionRetentionPolicy;
}

function formatBudgetLine(budget: BudgetSnapshot): string {
  const tokenBudget =
    budget.maxTokens !== undefined
      ? `budget ${budget.totalTokens}/${budget.maxTokens} tokens (${budget.remainingTokens ?? 0} remaining)`
      : `budget ${budget.totalTokens} tokens`;
  const cost =
    budget.estimatedUsd !== undefined
      ? ` / estimated ${formatUsd(budget.estimatedUsd)}${
          budget.maxEstimatedUsd !== undefined ? ` of ${formatUsd(budget.maxEstimatedUsd)}` : ""
        }`
      : "";
  return `${tokenBudget}${cost}`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function readDeniedPathsFromEnv(): string[] | undefined {
  const raw = process.env.DEEPCODEX_DENIED_PATHS;
  if (!raw) {
    return undefined;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readDeniedFileExtensionsFromEnv(): string[] | undefined {
  const raw = process.env.DEEPCODEX_DENIED_EXTENSIONS;
  if (!raw) {
    return undefined;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readMaxFileBytesFromEnv(): number | undefined {
  const raw = process.env.DEEPCODEX_MAX_FILE_BYTES;
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readOptionalBooleanEnv(value: string | undefined, name: string): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

function mergeStringLists(...lists: Array<string[] | undefined>): string[] | undefined {
  const merged = lists.flatMap((list) => list ?? []).map((entry) => entry.trim()).filter(Boolean);
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

type CliApprovalMode = "auto" | "prompt" | "deny";

function parseCliApprovalMode(value: string): CliApprovalMode {
  if (value === "manual") {
    return "prompt";
  }
  if (value === "auto" || value === "prompt" || value === "deny") {
    return value;
  }
  throw new Error("approval must be auto, prompt/manual, or deny");
}

function createCliApprovalHandler(
  mode: CliApprovalMode,
  rl?: ReturnType<typeof createInterface>
): ((request: ToolApprovalRequest) => Promise<ToolApprovalDecision>) | undefined {
  if (mode === "auto") {
    return undefined;
  }

  if (mode === "deny") {
    return async (request) => ({
      approved: false,
      reason: `Denied by CLI approval mode for ${request.name}.`,
      actor: "cli-deny-policy"
    });
  }

  return async (request) => {
    if (!rl) {
      return { approved: false, reason: "No interactive prompt is available.", actor: "cli-unavailable" };
    }
    console.log(chalk.yellow("\nTool approval required"));
    console.log(`${request.name} (${request.risk})`);
    console.log(request.reason);
    console.log(formatApprovalInput(request.input, request.fileAudits));
    const answer = (await rl.question("Approve this tool call? [y/N] ")).trim().toLowerCase();
    const approved = answer === "y" || answer === "yes";
    return {
      approved,
      reason: approved ? "Approved in CLI." : "Denied in CLI.",
      actor: "cli-prompt"
    };
  };
}

function formatApprovalInput(inputValue: unknown, fileAudits?: FileAuditEntry[]): string {
  const audit = formatFileAudits(fileAudits);
  const inputText = formatValue(inputValue);
  return audit ? `${inputText}\n\nFile audit\n${audit}` : inputText;
}

function formatToolOutput(outputValue: string, audit?: ToolAuditMetadata): string {
  const fileAudit = formatFileAudits(audit?.files);
  return fileAudit ? `${outputValue}\n\nFile audit\n${fileAudit}` : outputValue;
}

function formatValue(inputValue: unknown): string {
  if (typeof inputValue === "string") {
    return inputValue;
  }
  const serialized = JSON.stringify(inputValue, null, 2);
  return serialized ?? String(inputValue);
}

function formatFileAudits(fileAudits?: FileAuditEntry[]): string {
  if (!fileAudits || fileAudits.length === 0) {
    return "";
  }
  return fileAudits
    .map((entry) => {
      const status = entry.applied === undefined ? "" : entry.applied ? "applied" : "preview";
      return [
        `${entry.path}${entry.operation ? ` (${entry.operation})` : ""}${status ? ` ${status}` : ""}`,
        `before: ${formatFileSnapshot(entry.before)}`,
        entry.after ? `after: ${formatFileSnapshot(entry.after)}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function formatFileSnapshot(snapshot?: FileHashSnapshot): string {
  if (!snapshot) {
    return "not captured";
  }
  if (snapshot.error) {
    return snapshot.error;
  }
  if (!snapshot.exists) {
    return "missing";
  }
  return `sha256:${snapshot.sha256?.slice(0, 12) ?? "unknown"} bytes:${snapshot.bytes ?? 0}`;
}

function createCliEventHandler(recorder?: SessionEventRecorder) {
  return async (event: AgentEvent) => {
    printEvent(event);
    if (!recorder) {
      return;
    }
    try {
      await recorder.record(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.gray(`session audit skipped: ${message}`));
    }
  };
}
