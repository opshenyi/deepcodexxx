#!/usr/bin/env node
import "dotenv/config";
import chalk from "chalk";
import { Command } from "commander";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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
  createWorkspacePolicyBundle,
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
  PolicyBundleVerificationOptions,
  PolicyProfile,
  SessionRetentionPolicy,
  ShellEnvironmentMode,
  ShellExecutionMode,
  ToolAuditMetadata,
  SessionEventRecorder,
  ToolApprovalDecision,
  ToolApprovalRequest,
  WorkspaceContext,
  WorkspaceConfig,
  WorkspaceEvalTask
} from "@deepcodex/core";

const program = new Command();

type EvalTaskSource = "built-in" | "workspace";

type EvalTask = WorkspaceEvalTask & {
  source: EvalTaskSource;
};

type EvalScore = {
  matchedSignals: string[];
  missingSignals: string[];
  totalSignals: number;
  score: number;
  passed: boolean;
};

type EvalRunRecord = {
  id: string;
  evalId: string;
  source?: EvalTaskSource;
  label: string;
  workspace: string;
  model: string;
  sessionId: string;
  createdAt: string;
  prompt: string;
  expectedSignals: string[];
  score: EvalScore;
  scoreThreshold?: number;
  thresholdPassed: boolean;
  finalText: string;
};

type EvalRunComparison = {
  leftRunId: string;
  rightRunId: string;
  sameEval: boolean;
  evalId: string;
  rightEvalId: string;
  leftScore: number;
  rightScore: number;
  scoreDelta: number;
  leftPassed: boolean;
  rightPassed: boolean;
  thresholdStatusChanged: boolean;
  matchedSignalsAdded: string[];
  matchedSignalsRemoved: string[];
  missingSignalsAdded: string[];
  missingSignalsRemoved: string[];
  finalTextLengthDelta: number;
};

const builtInEvalTasks: EvalTask[] = [
  {
    source: "built-in",
    id: "repo-map",
    label: "Repository map",
    description: "Read-only inventory of package layout, clients, and core runtime boundaries.",
    prompt:
      "Inspect this repository in read-only mode. Summarize the package layout, clients, shared core, and runtime boundaries. Do not modify files.",
    profile: "inspection",
    maxSteps: 6,
    budget: { maxTokens: 60000 },
    expectedSignals: ["packages/core", "apps/web", "apps/desktop", "apps/cli", "apps/server"]
  },
  {
    source: "built-in",
    id: "safety-smoke",
    label: "Safety controls",
    description: "Read-only review of policy, approval, shell, DLP, and audit controls.",
    prompt:
      "Inspect this repository in read-only mode. Summarize the implemented safety controls and identify the highest-risk remaining safety gap. Do not modify files.",
    profile: "inspection",
    maxSteps: 8,
    budget: { maxTokens: 80000 },
    expectedSignals: ["approval", "DLP", "shell", "policy", "audit"]
  },
  {
    source: "built-in",
    id: "release-evidence",
    label: "Release evidence",
    description: "Read-only check of docs, scripts, and demo readiness evidence.",
    prompt:
      "Inspect this repository in read-only mode. Summarize the release and demo evidence available to an interviewer, including verification commands and documented limitations. Do not modify files.",
    profile: "inspection",
    maxSteps: 6,
    budget: { maxTokens: 60000 },
    expectedSignals: ["runbook", "release checklist", "product readiness", "security model"]
  }
];

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
  .option("--shell-execution-mode <mode>", "direct or workspace-copy")
  .option("--allow-network", "Allow shell commands that perform network access", false)
  .option("--allow-archive-listing", "Allow ZIP archive entry metadata listing without extraction", false)
  .option("--json", "Print newline-delimited JSON events", false)
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
        shellExecutionMode?: string;
        allowNetwork?: boolean;
        allowArchiveListing?: boolean;
        json?: boolean;
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
      if (options.json && approvalMode === "prompt") {
        throw new Error("ask --json cannot use prompt/manual approval mode.");
      }
      const rl = approvalMode === "prompt" ? createInterface({ input, output }) : undefined;
      try {
        const policy = createPolicy(
          options.mode,
          options.shellEnv,
          options.shellExecutionMode,
          options.allowNetwork,
          options.allowArchiveListing,
          profile,
          workspaceConfig.config
        );
        const workspace = await createWorkspaceContext(options.workspace, policy);
        const recorder = policy.allowStateWrite === false ? undefined : createSessionRecorder(workspace);
        const result = await runDeepCodexAgent({
          prompt: promptParts.join(" "),
          workspace: workspace.root,
          baseUrl: provider.baseUrl,
          model: provider.model,
          maxSteps: readOptionalInteger(options.maxSteps) ?? workspaceConfig.config.maxSteps ?? profile?.maxSteps ?? 12,
          policy,
          budget: createBudgetPolicy(options, profile?.budget, options.pricingProfile, workspaceConfig.config),
          requestToolApproval: createCliApprovalHandler(approvalMode, rl),
          onEvent: options.json ? createCliJsonEventHandler(recorder) : createCliEventHandler(recorder)
        });
        if (options.json) {
          console.log(JSON.stringify({ type: "result", sessionId: result.sessionId, finalText: result.finalText }));
        }
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
  .option("--shell-execution-mode <mode>", "direct or workspace-copy")
  .option("--allow-network", "Allow shell commands that perform network access", false)
  .option("--allow-archive-listing", "Allow ZIP archive entry metadata listing without extraction", false)
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
    shellExecutionMode?: string;
    allowNetwork?: boolean;
    allowArchiveListing?: boolean;
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
        const policy = createPolicy(
          options.mode,
          options.shellEnv,
          options.shellExecutionMode,
          options.allowNetwork,
          options.allowArchiveListing,
          profile,
          workspaceConfig.config
        );
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

const evals = program.command("evals").description("Run DeepCodex smoke evaluation tasks.");
const profiles = program.command("profiles").description("Inspect reusable DeepCodex policy profiles.");
const pricing = program.command("pricing").description("Inspect configured DeepCodex pricing profiles.");
const config = program.command("config").description("Inspect or create workspace-level DeepCodex defaults.");

evals
  .command("list")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (options: { workspace: string; json: boolean }) => {
    const workspaceConfig = await readWorkspaceConfig(options.workspace);
    const tasks = resolveEvalTasks(workspaceConfig.config);
    if (options.json) {
      console.log(JSON.stringify(tasks, null, 2));
      return;
    }
    for (const task of tasks) {
      console.log(`${task.id}  ${task.label}  ${task.source}  ${task.profile}  ${task.maxSteps} steps`);
      console.log(`  ${task.description}`);
    }
  });

evals
  .command("show")
  .argument("<eval>", "Eval id")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (evalId: string, options: { workspace: string; json: boolean }) => {
    const workspaceConfig = await readWorkspaceConfig(options.workspace);
    const task = resolveEvalTask(evalId, workspaceConfig.config);
    if (options.json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    printEvalTask(task);
  });

evals
  .command("run")
  .argument("<eval>", "Eval id")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print newline-delimited JSON events", false)
  .option("--max-steps <number>", "Override the eval maximum agent loop count")
  .option("--max-session-tokens <number>", "Stop when cumulative model tokens reach this session limit")
  .option("--max-session-usd <number>", "Stop when estimated model cost reaches this USD limit")
  .option("--input-usd-per-million-tokens <number>", "Input token price used for cost budget estimates")
  .option("--output-usd-per-million-tokens <number>", "Output token price used for cost budget estimates")
  .option("--pricing-profile <profile>", "Pricing profile id from DEEPCODEX_PRICING_PROFILES")
  .option("--min-score <number>", "Exit non-zero unless the eval score is at least this value from 0 to 1")
  .option("--require-pass", "Exit non-zero unless every expected signal is matched", false)
  .option("--record", "Persist the eval result under .deepcodex/state/evals", false)
  .action(
    async (
      evalId: string,
      options: {
        workspace: string;
        json: boolean;
        maxSteps?: string;
        maxSessionTokens?: string;
        maxSessionUsd?: string;
        inputUsdPerMillionTokens?: string;
        outputUsdPerMillionTokens?: string;
        pricingProfile?: string;
        minScore?: string;
        requirePass: boolean;
        record: boolean;
      }
    ) => {
      const workspaceConfig = await readWorkspaceConfig(options.workspace);
      const task = resolveEvalTask(evalId, workspaceConfig.config);
      await assertSignedPolicyIfRequired(options.workspace);
      const profile = resolveCliProfile(task.profile, workspaceConfig.config);
      const provider = readProviderSelection(workspaceConfig.config);
      assertProviderAllowed(provider, workspaceConfig.config.provider);
      const policy = createPolicy("suggest", undefined, undefined, false, false, profile, workspaceConfig.config);
      const workspace = await createWorkspaceContext(options.workspace, policy);
      const maxSteps = readOptionalInteger(options.maxSteps) ?? task.maxSteps;
      const scoreThreshold = options.requirePass ? 1 : readOptionalEvalScore(options.minScore);

      if (options.json) {
        console.log(
          JSON.stringify({
            type: "eval_started",
            eval: {
              id: task.id,
              label: task.label,
              source: task.source,
              profile: task.profile,
              maxSteps,
              expectedSignals: task.expectedSignals,
              scoreThreshold
            }
          })
        );
      } else {
        console.log(chalk.bold(`eval ${task.id}: ${task.label}`));
        console.log(chalk.gray(task.description));
        console.log(chalk.gray(`source ${task.source} / profile ${task.profile} / mode suggest / max steps ${maxSteps}`));
        if (scoreThreshold !== undefined) {
          console.log(chalk.gray(`score threshold ${scoreThreshold}`));
        }
      }

      const result = await runDeepCodexAgent({
        prompt: task.prompt,
        workspace: workspace.root,
        baseUrl: provider.baseUrl,
        model: provider.model,
        maxSteps,
        policy,
        budget: createBudgetPolicy(options, task.budget, options.pricingProfile, workspaceConfig.config),
        onEvent: options.json ? createCliJsonEventHandler() : createCliEventHandler()
      });
      const score = scoreEvalResult(task, result.finalText);
      const thresholdFailed = evalScoreFailed(score, scoreThreshold);
      const evalRecord =
        options.record
          ? await writeEvalRunRecord(
              workspace,
              createEvalRunRecord(task, {
                workspaceRoot: workspace.root,
                model: provider.model,
                sessionId: result.sessionId,
                finalText: result.finalText,
                score,
                scoreThreshold
              })
            )
          : undefined;

      if (options.json) {
        console.log(
          JSON.stringify({
            type: "eval_result",
            evalId: task.id,
            source: task.source,
            label: task.label,
            sessionId: result.sessionId,
            finalText: result.finalText,
            expectedSignals: task.expectedSignals,
            score,
            scoreThreshold,
            record: evalRecord
          })
        );
        if (thresholdFailed) {
          process.exitCode = 1;
        }
        return;
      }
      console.log(chalk.bold("\neval result"));
      console.log(`session ${result.sessionId}`);
      console.log(`expected signals ${task.expectedSignals.join(", ")}`);
      console.log(`score ${formatEvalScore(score)}`);
      if (score.missingSignals.length > 0) {
        console.log(`missing signals ${score.missingSignals.join(", ")}`);
      }
      if (evalRecord) {
        console.log(`record ${evalRecord.path}`);
      }
      if (thresholdFailed) {
        console.log(chalk.red("eval score threshold failed"));
        process.exitCode = 1;
      }
    }
  );

evals
  .command("history")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (options: { workspace: string; json: boolean }) => {
    const workspace = await createWorkspaceContext(options.workspace, { mode: "suggest" });
    const records = await listEvalRunRecords(workspace);
    if (options.json) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }
    if (records.length === 0) {
      console.log("No eval runs recorded.");
      return;
    }
    for (const record of records) {
      console.log(
        `${record.id}  ${record.evalId}  score ${formatEvalScore(record.score)}  ${record.createdAt}  ${record.thresholdPassed ? "threshold passed" : "threshold failed"}`
      );
    }
  });

evals
  .command("show-run")
  .argument("<runId>", "Recorded eval run id")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (runId: string, options: { workspace: string; json: boolean }) => {
    const workspace = await createWorkspaceContext(options.workspace, { mode: "suggest" });
    const record = await readEvalRunRecord(workspace, runId);
    if (options.json) {
      console.log(JSON.stringify(record, null, 2));
      return;
    }
    printEvalRunRecord(record);
  });

evals
  .command("compare")
  .argument("<leftRunId>", "Baseline recorded eval run id")
  .argument("<rightRunId>", "Candidate recorded eval run id")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--json", "Print JSON output", false)
  .action(async (leftRunId: string, rightRunId: string, options: { workspace: string; json: boolean }) => {
    const workspace = await createWorkspaceContext(options.workspace, { mode: "suggest" });
    const left = await readEvalRunRecord(workspace, leftRunId);
    const right = await readEvalRunRecord(workspace, rightRunId);
    const comparison = compareEvalRunRecords(left, right);
    if (options.json) {
      console.log(JSON.stringify({ left, right, comparison }, null, 2));
      return;
    }
    printEvalRunComparison(comparison);
  });

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
  .command("generate-keypair")
  .description("Generate an Ed25519 keypair for signing DeepCodex policy bundles.")
  .requiredOption("--private-key <path>", "Private key PEM output path")
  .requiredOption("--public-key <path>", "Public key PEM output path")
  .option("--force", "Overwrite existing key files", false)
  .option("--json", "Print JSON output", false)
  .action(
    async (options: { privateKey: string; publicKey: string; force: boolean; json: boolean }) => {
      const privateKeyPath = path.resolve(options.privateKey);
      const publicKeyPath = path.resolve(options.publicKey);
      if (privateKeyPath === publicKeyPath) {
        throw new Error("Private key and public key paths must be different.");
      }
      if (!options.force) {
        await assertOutputFileAvailable(privateKeyPath);
        await assertOutputFileAvailable(publicKeyPath);
      }

      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
      await writePemFile(privateKeyPath, privateKeyPem, 0o600);
      await writePemFile(publicKeyPath, publicKeyPem, 0o644);

      const result = {
        privateKeyPath,
        publicKeyPath,
        publicKeySha256: createSha256(publicKeyPem.trim())
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Private key written: ${result.privateKeyPath}`);
      console.log(`Public key written: ${result.publicKeyPath}`);
      console.log(`Public key SHA-256: ${result.publicKeySha256}`);
      console.log("Keep the private key outside workspaces, repository files, environment files, memory, and session history.");
    }
  );

config
  .command("sign-bundle")
  .description("Sign the active workspace config into .deepcodex/policy-bundle.json.")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .requiredOption("--private-key <path>", "Ed25519 private key PEM path used for signing")
  .requiredOption("--issuer <name>", "Issuer name recorded in the policy bundle")
  .option("--issued-at <date>", "Issued-at timestamp. Defaults to now.")
  .option("--expires-at <date>", "Optional expiry timestamp.")
  .option("--public-key <path>", "Optional public key PEM path to embed as bundle metadata")
  .option("--embed-public-key", "Embed a public key derived from the private key", false)
  .option("--force", "Overwrite an existing policy bundle", false)
  .option("--json", "Print JSON output", false)
  .action(
    async (options: {
      workspace: string;
      privateKey: string;
      issuer: string;
      issuedAt?: string;
      expiresAt?: string;
      publicKey?: string;
      embedPublicKey: boolean;
      force: boolean;
      json: boolean;
    }) => {
      const privateKey = await readFile(options.privateKey, "utf8");
      const publicKey = options.publicKey ? await readFile(options.publicKey, "utf8") : undefined;
      const result = await createWorkspacePolicyBundle(options.workspace, {
        privateKey,
        issuer: options.issuer,
        issuedAt: options.issuedAt,
        expiresAt: options.expiresAt,
        publicKey,
        embedPublicKey: options.embedPublicKey,
        overwrite: options.force
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Policy bundle written: ${result.path}`);
      console.log(`Issuer: ${result.issuer}`);
      console.log(`Issued at: ${result.issuedAt}`);
      console.log(`Expires at: ${result.expiresAt ?? "not set"}`);
      console.log(`Config SHA-256: ${result.configSha256}`);
      console.log(`Bundle SHA-256: ${result.bundleSha256}`);
      console.log(`Embedded public key SHA-256: ${result.publicKeySha256 ?? "not embedded"}`);
      console.log("Trusted enforcement still requires a trusted public key through verify-bundle or environment policy.");
    }
  );

config
  .command("verify-bundle")
  .description("Verify a signed workspace policy bundle against the active workspace config.")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--public-key <path...>", "Trusted Ed25519 public key PEM path(s)")
  .option("--json", "Print JSON output", false)
  .action(async (options: { workspace: string; publicKey?: string[]; json: boolean }) => {
    const result = await verifyWorkspacePolicyBundle(
      options.workspace,
      await readPolicyBundleVerificationOptions(options.publicKey)
    );
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
  .option("--json", "Print JSON output", false)
  .option("--require-api-key", "Exit non-zero when DEEPSEEK_API_KEY is missing", false)
  .option("--require-workspace-config", "Exit non-zero when .deepcodex/config.json is missing", false)
  .option("--require-trusted-policy-bundle", "Exit non-zero unless the policy bundle verifies with a trusted key", false)
  .action(async (options: {
    workspace: string;
    json: boolean;
    requireApiKey: boolean;
    requireWorkspaceConfig: boolean;
    requireTrustedPolicyBundle: boolean;
  }) => {
    const workspaceConfig = await readWorkspaceConfig(options.workspace);
    const profile = resolveCliProfile(undefined, workspaceConfig.config);
    const basePolicy: Partial<ApprovalPolicy> = { ...profile?.policy, ...(workspaceConfig.config.policy ?? {}) };
    const provider = readProviderSelection(workspaceConfig.config);
    const policyBundleVerification = await readPolicyBundleVerificationForDoctor(options.workspace);
    const policyBundleStatus = formatPolicyBundleStatusForDoctor(policyBundleVerification);
    const deepSeekApiKey = process.env.DEEPSEEK_API_KEY ? "configured" : "missing";
    const requirementFailures = createDoctorRequirementFailures({
      deepSeekApiKey,
      workspaceConfigPresent: workspaceConfig.exists,
      policyBundleVerification,
      requireApiKey: options.requireApiKey,
      requireWorkspaceConfig: options.requireWorkspaceConfig,
      requireTrustedPolicyBundle: options.requireTrustedPolicyBundle
    });
    const diagnostics = {
      ok: requirementFailures.length === 0,
      requirementFailures,
      deepSeekApiKey,
      deepSeekBaseUrl: provider.baseUrl,
      deepSeekModel: provider.model,
      providerMaxRetries: process.env.DEEPCODEX_PROVIDER_MAX_RETRIES ?? "2",
      providerRetryBaseDelayMs: process.env.DEEPCODEX_PROVIDER_RETRY_BASE_MS ?? "500",
      allowedProviderBaseUrls: workspaceConfig.config.provider?.allowedBaseUrls?.length ?? 0,
      allowedProviderModels: workspaceConfig.config.provider?.allowedModels?.length ?? 0,
      maxSessionTokens: process.env.DEEPCODEX_MAX_SESSION_TOKENS ?? "not set",
      maxSessionUsd: process.env.DEEPCODEX_MAX_SESSION_USD ?? "not set",
      inputUsdPerMillionTokens: process.env.DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS ?? "not set",
      outputUsdPerMillionTokens: process.env.DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS ?? "not set",
      policyProfile: process.env.DEEPCODEX_POLICY_PROFILE ?? workspaceConfig.config.policyProfileId ?? "custom",
      workspacePolicyProfiles: workspaceConfig.config.policyProfiles?.length ?? 0,
      approvalMode: workspaceConfig.config.approvalMode ?? "profile/default",
      pricingProfile: process.env.DEEPCODEX_PRICING_PROFILE ?? workspaceConfig.config.pricingProfileId ?? "custom",
      configuredPricingProfiles: readPricingProfilesFromEnv().length,
      shellEnvironment: process.env.DEEPCODEX_SHELL_ENV ?? basePolicy.shellEnvironment ?? "minimal",
      shellExecutionMode: parseShellExecutionMode(
        process.env.DEEPCODEX_SHELL_EXECUTION_MODE ?? basePolicy.shellExecutionMode ?? "direct"
      ),
      shellNetworkAccess: resolveAllowNetworkPolicy(false, basePolicy.allowNetwork) ? "allowed" : "blocked",
      archiveListing: resolveAllowArchiveListingPolicy(false, basePolicy.allowArchiveListing) ? "allowed" : "blocked",
      workspaceConfig: {
        status: workspaceConfig.exists ? "present" : "missing",
        path: workspaceConfig.exists ? workspaceConfig.path : undefined,
        sha256: workspaceConfig.sha256
      },
      policyBundle: policyBundleStatus,
      policyBundleVerification,
      signedPolicyRequired: readRequireSignedPolicyFromEnv(),
      workspaceMaxSteps: workspaceConfig.config.maxSteps ?? "profile/default",
      node: process.version
    };
    if (options.json) {
      console.log(JSON.stringify(diagnostics, null, 2));
      if (requirementFailures.length > 0) {
        process.exitCode = 1;
      }
      return;
    }
    console.log(`DeepSeek API key: ${diagnostics.deepSeekApiKey}`);
    console.log(`DeepSeek base URL: ${diagnostics.deepSeekBaseUrl}`);
    console.log(`DeepSeek model: ${diagnostics.deepSeekModel}`);
    console.log(`Provider max retries: ${diagnostics.providerMaxRetries}`);
    console.log(`Provider retry base delay ms: ${diagnostics.providerRetryBaseDelayMs}`);
    console.log(`Allowed provider base URLs: ${diagnostics.allowedProviderBaseUrls}`);
    console.log(`Allowed provider models: ${diagnostics.allowedProviderModels}`);
    console.log(`Max session tokens: ${diagnostics.maxSessionTokens}`);
    console.log(`Max session USD: ${diagnostics.maxSessionUsd}`);
    console.log(`Input USD per million tokens: ${diagnostics.inputUsdPerMillionTokens}`);
    console.log(`Output USD per million tokens: ${diagnostics.outputUsdPerMillionTokens}`);
    console.log(`Policy profile: ${diagnostics.policyProfile}`);
    console.log(`Workspace policy profiles: ${diagnostics.workspacePolicyProfiles}`);
    console.log(`Approval mode: ${diagnostics.approvalMode}`);
    console.log(`Pricing profile: ${diagnostics.pricingProfile}`);
    console.log(`Configured pricing profiles: ${diagnostics.configuredPricingProfiles}`);
    console.log(`Shell environment: ${diagnostics.shellEnvironment}`);
    console.log(`Shell execution mode: ${diagnostics.shellExecutionMode}`);
    console.log(`Shell network access: ${diagnostics.shellNetworkAccess}`);
    console.log(`Archive listing: ${diagnostics.archiveListing}`);
    console.log(`Workspace config: ${diagnostics.workspaceConfig.status === "present" ? diagnostics.workspaceConfig.path : "missing"}`);
    console.log(
      `Workspace config SHA-256: ${diagnostics.workspaceConfig.sha256 ? diagnostics.workspaceConfig.sha256.slice(0, 12) : "not available"}`
    );
    console.log(`Policy bundle: ${diagnostics.policyBundle}`);
    console.log(`Signed policy required: ${diagnostics.signedPolicyRequired ? "yes" : "no"}`);
    console.log(`Workspace max steps: ${diagnostics.workspaceMaxSteps}`);
    console.log(`Node: ${diagnostics.node}`);
    if (requirementFailures.length > 0) {
      console.log(chalk.red("Doctor requirements failed:"));
      for (const failure of requirementFailures) {
        console.log(chalk.red(`- ${failure}`));
      }
      process.exitCode = 1;
    }
  });

try {
  await program.parseAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(message));
  process.exitCode = 1;
}

function resolveEvalTasks(config?: WorkspaceConfig): EvalTask[] {
  const builtInIds = new Set(builtInEvalTasks.map((task) => task.id));
  const workspaceTasks = (config?.evals ?? []).map((task): EvalTask => ({ ...task, source: "workspace" }));
  for (const task of workspaceTasks) {
    if (builtInIds.has(task.id)) {
      throw new Error(`Workspace eval '${task.id}' cannot replace a built-in eval.`);
    }
  }
  return [...builtInEvalTasks, ...workspaceTasks];
}

function resolveEvalTask(evalId: string, config?: WorkspaceConfig): EvalTask {
  const task = resolveEvalTasks(config).find((entry) => entry.id === evalId);
  if (!task) {
    throw new Error(`Unknown eval '${evalId}'. Run 'deepcodex evals list --workspace <path>' to see available evals.`);
  }
  return task;
}

function printEvalTask(task: EvalTask): void {
  console.log(`${task.id}  ${task.label}`);
  console.log(`Source: ${task.source}`);
  console.log(task.description);
  console.log(`Profile: ${task.profile}`);
  console.log(`Max steps: ${task.maxSteps}`);
  console.log(`Budget max tokens: ${task.budget?.maxTokens ?? "not set"}`);
  console.log(`Expected signals: ${task.expectedSignals.join(", ")}`);
  console.log("\nPrompt");
  console.log(task.prompt);
}

function scoreEvalResult(task: EvalTask, finalText: string): EvalScore {
  const normalizedFinalText = normalizeEvalText(finalText);
  const matchedSignals = task.expectedSignals.filter((signal) => normalizedFinalText.includes(normalizeEvalText(signal)));
  const missingSignals = task.expectedSignals.filter((signal) => !matchedSignals.includes(signal));
  const totalSignals = task.expectedSignals.length;
  const score = totalSignals === 0 ? 1 : matchedSignals.length / totalSignals;
  return {
    matchedSignals,
    missingSignals,
    totalSignals,
    score,
    passed: missingSignals.length === 0
  };
}

function normalizeEvalText(value: string): string {
  return value.toLocaleLowerCase();
}

function evalScoreFailed(score: EvalScore, scoreThreshold: number | undefined): boolean {
  return scoreThreshold !== undefined && score.score < scoreThreshold;
}

function formatEvalScore(score: EvalScore): string {
  return `${score.matchedSignals.length}/${score.totalSignals} (${score.score.toFixed(2)}) ${
    score.passed ? "passed" : "not passed"
  }`;
}

function createEvalRunRecord(
  task: EvalTask,
  input: {
    workspaceRoot: string;
    model: string;
    sessionId: string;
    finalText: string;
    score: EvalScore;
    scoreThreshold?: number;
  }
): EvalRunRecord {
  const createdAt = new Date().toISOString();
  return {
    id: createEvalRunId(task.id, input.sessionId, createdAt),
    evalId: task.id,
    source: task.source,
    label: task.label,
    workspace: input.workspaceRoot,
    model: input.model,
    sessionId: input.sessionId,
    createdAt,
    prompt: task.prompt,
    expectedSignals: task.expectedSignals,
    score: input.score,
    scoreThreshold: input.scoreThreshold,
    thresholdPassed: !evalScoreFailed(input.score, input.scoreThreshold),
    finalText: input.finalText
  };
}

async function writeEvalRunRecord(
  workspace: WorkspaceContext,
  record: EvalRunRecord
): Promise<{ path: string; record: EvalRunRecord }> {
  const filePath = evalRunFilePath(workspace, record.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { path: filePath, record };
}

async function listEvalRunRecords(workspace: WorkspaceContext): Promise<EvalRunRecord[]> {
  const directory = evalRunDirectory(workspace);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry): Promise<EvalRunRecord | undefined> => {
        try {
          return await readEvalRunRecord(workspace, entry.name.slice(0, -".json".length));
        } catch {
          return undefined;
        }
      })
  );
  return records
    .filter((record): record is EvalRunRecord => Boolean(record))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function readEvalRunRecord(workspace: WorkspaceContext, runId: string): Promise<EvalRunRecord> {
  const filePath = evalRunFilePath(workspace, runId);
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Eval run not found: ${runId}`);
    }
    throw error;
  });
  return parseEvalRunRecord(raw, filePath);
}

function parseEvalRunRecord(raw: string, filePath: string): EvalRunRecord {
  const parsed = JSON.parse(raw) as Partial<EvalRunRecord>;
  if (
    !parsed.id ||
    !parsed.evalId ||
    !parsed.sessionId ||
    !parsed.createdAt ||
    !Array.isArray(parsed.expectedSignals) ||
    !parsed.score
  ) {
    throw new Error(`Invalid eval run record: ${filePath}`);
  }
  return parsed as EvalRunRecord;
}

function printEvalRunRecord(record: EvalRunRecord): void {
  console.log(`${record.id}  ${record.evalId}  ${record.label}`);
  console.log(`Source: ${record.source ?? "not recorded"}`);
  console.log(`Workspace: ${record.workspace}`);
  console.log(`Model: ${record.model}`);
  console.log(`Session: ${record.sessionId}`);
  console.log(`Created: ${record.createdAt}`);
  console.log(`Score: ${formatEvalScore(record.score)}`);
  console.log(`Threshold: ${record.scoreThreshold ?? "not set"} (${record.thresholdPassed ? "passed" : "failed"})`);
  if (record.score.missingSignals.length > 0) {
    console.log(`Missing signals: ${record.score.missingSignals.join(", ")}`);
  }
  console.log("\nFinal");
  console.log(record.finalText);
}

function compareEvalRunRecords(left: EvalRunRecord, right: EvalRunRecord): EvalRunComparison {
  return {
    leftRunId: left.id,
    rightRunId: right.id,
    sameEval: left.evalId === right.evalId,
    evalId: left.evalId,
    rightEvalId: right.evalId,
    leftScore: left.score.score,
    rightScore: right.score.score,
    scoreDelta: right.score.score - left.score.score,
    leftPassed: left.score.passed,
    rightPassed: right.score.passed,
    thresholdStatusChanged: left.thresholdPassed !== right.thresholdPassed,
    matchedSignalsAdded: listAdded(left.score.matchedSignals, right.score.matchedSignals),
    matchedSignalsRemoved: listRemoved(left.score.matchedSignals, right.score.matchedSignals),
    missingSignalsAdded: listAdded(left.score.missingSignals, right.score.missingSignals),
    missingSignalsRemoved: listRemoved(left.score.missingSignals, right.score.missingSignals),
    finalTextLengthDelta: right.finalText.length - left.finalText.length
  };
}

function printEvalRunComparison(comparison: EvalRunComparison): void {
  console.log(`${comparison.leftRunId} -> ${comparison.rightRunId}`);
  console.log(`Eval: ${comparison.evalId}${comparison.sameEval ? "" : ` -> ${comparison.rightEvalId}`}`);
  console.log(`Score: ${comparison.leftScore.toFixed(2)} -> ${comparison.rightScore.toFixed(2)} (${formatSignedNumber(comparison.scoreDelta, 2)})`);
  console.log(`Pass: ${comparison.leftPassed ? "yes" : "no"} -> ${comparison.rightPassed ? "yes" : "no"}`);
  console.log(`Threshold changed: ${comparison.thresholdStatusChanged ? "yes" : "no"}`);
  console.log(`Final length delta: ${formatSignedNumber(comparison.finalTextLengthDelta)}`);
  printSignalDelta("Matched added", comparison.matchedSignalsAdded);
  printSignalDelta("Matched removed", comparison.matchedSignalsRemoved);
  printSignalDelta("Missing added", comparison.missingSignalsAdded);
  printSignalDelta("Missing removed", comparison.missingSignalsRemoved);
}

function printSignalDelta(label: string, signals: string[]): void {
  console.log(`${label}: ${signals.length > 0 ? signals.join(", ") : "none"}`);
}

function listAdded(left: string[], right: string[]): string[] {
  const leftSet = new Set(left);
  return right.filter((value) => !leftSet.has(value));
}

function listRemoved(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function formatSignedNumber(value: number, fractionDigits?: number): string {
  const text = fractionDigits === undefined ? String(value) : value.toFixed(fractionDigits);
  return value > 0 ? `+${text}` : text;
}

function evalRunDirectory(workspace: WorkspaceContext): string {
  return path.join(workspace.root, ".deepcodex", "state", "evals");
}

function evalRunFilePath(workspace: WorkspaceContext, runId: string): string {
  assertValidEvalRunId(runId);
  return path.join(evalRunDirectory(workspace), `${runId}.json`);
}

function createEvalRunId(evalId: string, sessionId: string, createdAt: string): string {
  const timestamp = createdAt.replace(/[^0-9A-Za-z]/g, "");
  return `${timestamp}-${evalId}-${sessionId.slice(0, 8)}`;
}

function assertValidEvalRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(`Invalid eval run id: ${runId}`);
  }
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
  shellExecutionMode: string | undefined,
  allowNetwork: boolean | undefined,
  allowArchiveListing: boolean | undefined,
  profile?: PolicyProfile,
  config?: WorkspaceConfig
): ApprovalPolicy {
  const configPolicy = config?.policy ?? {};
  const base: Partial<ApprovalPolicy> = { ...profile?.policy, ...configPolicy };
  const selectedMode = mode ? parseMode(mode) : (configPolicy.mode ?? profile?.policy.mode ?? "workspace-write");
  const selectedShellEnv =
    shellEnv ?? process.env.DEEPCODEX_SHELL_ENV ?? base.shellEnvironment ?? "minimal";
  const selectedShellExecutionMode =
    shellExecutionMode ?? process.env.DEEPCODEX_SHELL_EXECUTION_MODE ?? base.shellExecutionMode ?? "direct";
  return {
    ...base,
    mode: selectedMode,
    allowFileWrite: selectedMode !== "suggest" && (base.allowFileWrite ?? true),
    allowShell: selectedMode !== "suggest" && (base.allowShell ?? true),
    allowNetwork: selectedMode !== "suggest" && resolveAllowNetworkPolicy(allowNetwork, base.allowNetwork),
    allowArchiveListing: resolveAllowArchiveListingPolicy(allowArchiveListing, base.allowArchiveListing),
    allowStateWrite: selectedMode !== "suggest" && (base.allowStateWrite ?? true),
    deniedPaths: mergeStringLists(base.deniedPaths, readDeniedPathsFromEnv()),
    deniedFileExtensions: mergeStringLists(base.deniedFileExtensions, readDeniedFileExtensionsFromEnv()),
    maxFileBytes: readMaxFileBytesFromEnv() ?? base.maxFileBytes,
    shellEnvironment: parseShellEnvironmentMode(selectedShellEnv),
    shellExecutionMode: parseShellExecutionMode(selectedShellExecutionMode)
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

function readAllowArchiveListingFromEnv(): boolean | undefined {
  return readOptionalBooleanEnv(process.env.DEEPCODEX_ALLOW_ARCHIVE_LISTING, "DEEPCODEX_ALLOW_ARCHIVE_LISTING");
}

function resolveAllowArchiveListingPolicy(
  cliAllowArchiveListing: boolean | undefined,
  configuredAllowArchiveListing: boolean | undefined
): boolean {
  if (cliAllowArchiveListing === true) {
    return true;
  }
  return readAllowArchiveListingFromEnv() ?? configuredAllowArchiveListing ?? false;
}

function readProviderSelection(config?: WorkspaceConfig) {
  return resolveProviderSelection({
    baseUrl: process.env.DEEPSEEK_BASE_URL || config?.provider?.baseUrl,
    model: process.env.DEEPSEEK_MODEL || config?.model
  });
}

async function readPolicyBundleVerificationOptions(publicKeyPaths: string[] = []): Promise<PolicyBundleVerificationOptions> {
  const publicKeys: string[] = [];
  for (const publicKeyPath of [
    ...publicKeyPaths,
    ...readCommaSeparatedEnv(process.env.DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILES),
    ...readCommaSeparatedEnv(process.env.DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE)
  ]) {
    publicKeys.push(await readFile(publicKeyPath, "utf8"));
  }
  if (process.env.DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY) {
    publicKeys.push(process.env.DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY);
  }
  return {
    publicKeys,
    revokedBundleSha256: readCommaSeparatedEnv(process.env.DEEPCODEX_REVOKED_POLICY_BUNDLES),
    revokedPublicKeySha256: readCommaSeparatedEnv(process.env.DEEPCODEX_REVOKED_POLICY_KEYS),
    trustedIssuers: readCommaSeparatedEnv(process.env.DEEPCODEX_POLICY_BUNDLE_TRUSTED_ISSUERS)
  };
}

async function readPolicyBundleVerificationForDoctor(workspace: string): Promise<PolicyBundleVerificationResult> {
  try {
    return await verifyWorkspacePolicyBundle(workspace, await readPolicyBundleVerificationOptions());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      path: path.join(path.resolve(workspace), ".deepcodex/policy-bundle.json"),
      exists: false,
      ok: false,
      signatureVerified: false,
      trusted: false,
      reason: message
    };
  }
}

function formatPolicyBundleStatusForDoctor(result: PolicyBundleVerificationResult): string {
  if (!result.exists && result.reason === "Policy bundle is missing.") {
    return "missing";
  }
  if (result.ok) {
    return `trusted ${result.bundleSha256?.slice(0, 12) ?? "unknown"}`;
  }
  if (result.signatureVerified) {
    return `untrusted ${result.bundleSha256?.slice(0, 12) ?? "unknown"}`;
  }
  return `failed ${result.reason}`;
}

function createDoctorRequirementFailures(input: {
  deepSeekApiKey: "configured" | "missing";
  workspaceConfigPresent: boolean;
  policyBundleVerification: PolicyBundleVerificationResult;
  requireApiKey: boolean;
  requireWorkspaceConfig: boolean;
  requireTrustedPolicyBundle: boolean;
}): string[] {
  const failures: string[] = [];
  if (input.requireApiKey && input.deepSeekApiKey !== "configured") {
    failures.push("DEEPSEEK_API_KEY is missing.");
  }
  if (input.requireWorkspaceConfig && !input.workspaceConfigPresent) {
    failures.push(".deepcodex/config.json is missing.");
  }
  if (input.requireTrustedPolicyBundle && !input.policyBundleVerification.ok) {
    failures.push(`Policy bundle is not trusted: ${input.policyBundleVerification.reason}`);
  }
  return failures;
}

async function assertSignedPolicyIfRequired(workspace: string): Promise<void> {
  if (!readRequireSignedPolicyFromEnv()) {
    return;
  }
  const result = await verifyWorkspacePolicyBundle(workspace, await readPolicyBundleVerificationOptions());
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

function parseShellExecutionMode(value: string): ShellExecutionMode {
  if (value === "direct" || value === "workspace-copy") {
    return value;
  }
  throw new Error("shell-execution-mode must be direct or workspace-copy");
}

async function assertOutputFileAvailable(filePath: string): Promise<void> {
  const exists = await stat(filePath)
    .then(() => true)
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    });
  if (exists) {
    throw new Error(`Output file already exists: ${filePath}. Use --force to overwrite it.`);
  }
}

async function writePemFile(filePath: string, content: string, mode: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { encoding: "utf8", mode });
}

function createSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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

function readOptionalEvalScore(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("Eval score threshold must be between 0 and 1.");
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

function readCommaSeparatedEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  const shellAudit = formatShellAudit(audit?.shell);
  return [
    outputValue,
    fileAudit ? `File audit\n${fileAudit}` : "",
    shellAudit ? `Shell audit\n${shellAudit}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
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

function formatShellAudit(shellAudit?: ToolAuditMetadata["shell"]): string {
  if (!shellAudit) {
    return "";
  }
  return [
    `mode: ${shellAudit.executionMode}`,
    shellAudit.copiedFiles !== undefined ? `copiedFiles: ${shellAudit.copiedFiles}` : "",
    shellAudit.copiedBytes !== undefined ? `copiedBytes: ${shellAudit.copiedBytes}` : "",
    shellAudit.skippedEntries !== undefined ? `skippedEntries: ${shellAudit.skippedEntries}` : "",
    shellAudit.maxFiles !== undefined ? `maxFiles: ${shellAudit.maxFiles}` : "",
    shellAudit.maxBytes !== undefined ? `maxBytes: ${shellAudit.maxBytes}` : "",
    shellAudit.workspaceCopyRemoved !== undefined ? `workspaceCopyRemoved: ${shellAudit.workspaceCopyRemoved}` : ""
  ]
    .filter(Boolean)
    .join("\n");
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

function createCliJsonEventHandler(recorder?: SessionEventRecorder) {
  return async (event: AgentEvent) => {
    console.log(JSON.stringify({ type: "event", event }));
    if (!recorder) {
      return;
    }
    try {
      await recorder.record(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ type: "warning", message: `session audit skipped: ${message}` }));
    }
  };
}
