import "dotenv/config";
import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import {
  DeepSeekClient,
  DeepSeekError,
  InvalidSessionIdError,
  SessionNotFoundError,
  appendWorkspaceMemory,
  compareEvalRunRecords,
  createDistributionPreflightReport,
  createReleaseEvidenceReport,
  createEvalRunReport,
  createDeepSeekModelCatalogSummary,
  createSessionRecorder,
  createWorkspaceContext,
  exportDistributionPreflightReport,
  exportSessionHistory,
  exportReleaseEvidenceReport,
  applyPricingProfileToBudget,
  listDeepSeekModelCatalog,
  listEvalRunRecords,
  listSessionHistories,
  listPolicyProfiles,
  parseSessionExportFormat,
  parsePricingProfiles,
  parseDistributionPreflightFormat,
  parseReleaseEvidenceFormat,
  pruneSessionHistories,
  readEvalRunRecord,
  readSessionHistory,
  readWorkspaceConfig,
  readWorkspaceMemory,
  resolveEvalTasks,
  resolvePricingProfile,
  resolvePolicyProfile,
  scanWorkspaceSensitiveText,
  assertProviderAllowed,
  resolveProviderSelection,
  runDeepCodexAgent,
  verifyWorkspacePolicyBundle
} from "@deepcodex/core";
import type {
  AgentEvent,
  ApprovalMode,
  ApprovalPolicy,
  ShellEnvironmentMode,
  ShellExecutionMode,
  ToolApprovalDecision,
  ToolApprovalRequest,
  PolicyBundleVerificationOptions,
  WorkspaceConfig
} from "@deepcodex/core";
import type { BudgetPolicy, SessionRetentionPolicy } from "@deepcodex/core";

const app = express();
const port = Number(process.env.DEEPCODEX_PORT ?? process.env.PORT ?? 17361);
const pendingApprovals = new Map<
  string,
  {
    request: ToolApprovalRequest;
    resolve: (decision: ToolApprovalDecision) => void;
    timeout: NodeJS.Timeout;
  }
>();

app.use(createCorsMiddleware());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "DeepCodex",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY)
  });
});

app.get("/api/memory", async (req, res, next) => {
  try {
    const workspacePath = readWorkspace(req.query.workspace);
    const workspace = await createWorkspaceContext(workspacePath);
    res.json({ memory: await readWorkspaceMemory(workspace), path: workspace.memoryPath });
  } catch (error) {
    next(error);
  }
});

app.get("/api/policy-profiles", async (req, res, next) => {
  try {
    const workspaceConfig = await readWorkspaceConfig(readWorkspace(req.query.workspace));
    res.json({
      profiles: listPolicyProfiles(workspaceConfig.config.policyProfiles),
      defaultProfileId: process.env.DEEPCODEX_POLICY_PROFILE ?? workspaceConfig.config.policyProfileId ?? "custom"
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/pricing-profiles", (_req, res) => {
  res.json({
    profiles: readPricingProfilesFromEnv(),
    defaultProfileId: process.env.DEEPCODEX_PRICING_PROFILE ?? "custom"
  });
});

app.get("/api/provider/models", (_req, res) => {
  res.json({
    summary: createDeepSeekModelCatalogSummary(),
    models: listDeepSeekModelCatalog()
  });
});

app.get("/api/provider/ping", async (req, res) => {
  const live = req.query.live === "true";
  const mode = live ? "live" : "configuration";
  const workspacePath = readWorkspace(req.query.workspace);
  const deepSeekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);
  try {
    const workspaceConfig = await readWorkspaceConfig(workspacePath);
    const provider = readProviderSelection(undefined, workspaceConfig.config);
    assertProviderAllowed(provider, workspaceConfig.config.provider);
    const result = {
      ok: true,
      mode,
      workspace: workspacePath,
      configPath: workspaceConfig.path,
      configExists: workspaceConfig.exists,
      deepSeekConfigured,
      provider: {
        baseUrl: provider.baseUrl,
        model: provider.model,
        fallbackModels: provider.fallbackModels,
        thinking: provider.thinking,
        reasoningEffort: provider.reasoningEffort
      }
    };

    if (!live) {
      res.json(result);
      return;
    }
    if (!deepSeekConfigured) {
      res.json({ ...result, ok: false, error: "DEEPSEEK_API_KEY is not set." });
      return;
    }

    try {
      const client = new DeepSeekClient({
        baseUrl: provider.baseUrl,
        model: provider.model,
        fallbackModels: provider.fallbackModels,
        thinking: provider.thinking,
        reasoningEffort: provider.reasoningEffort
      });
      const response = await client.chat([{ role: "user", content: "Reply with ok." }]);
      res.json({ ...result, response: { id: response.id, model: client.lastModel ?? provider.model } });
    } catch (error) {
      if (error instanceof DeepSeekError) {
        res.json({
          ...result,
          ok: false,
          error: error.message,
          providerError: {
            kind: error.kind,
            status: error.status,
            retryable: error.retryable
          }
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      res.json({ ...result, ok: false, error: message });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.json({
      ok: false,
      mode,
      workspace: workspacePath,
      deepSeekConfigured,
      error: message
    });
  }
});

app.get("/api/workspace-config", async (req, res, next) => {
  try {
    res.json(await readWorkspaceConfig(readWorkspace(req.query.workspace)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/policy-bundle", async (req, res, next) => {
  try {
    res.json(await verifyWorkspacePolicyBundle(readWorkspace(req.query.workspace), await readPolicyBundleVerificationOptions()));
  } catch (error) {
    next(error);
  }
});

app.get("/api/security/scan", async (req, res, next) => {
  try {
    const workspacePath = readWorkspace(req.query.workspace);
    const workspaceConfig = await readWorkspaceConfig(workspacePath);
    const profile = readPolicyProfile(
      typeof req.query.profileId === "string" ? req.query.profileId : undefined,
      workspaceConfig.config
    );
    const policy = createRunPolicy("suggest", false, false, false, undefined, profile, workspaceConfig.config);
    const workspace = await createWorkspaceContext(workspacePath, policy);
    res.json({
      result: await scanWorkspaceSensitiveText(workspace, {
        maxFiles: readOptionalInteger(req.query.maxFiles),
        maxFindings: readOptionalInteger(req.query.maxFindings)
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/evals", async (req, res, next) => {
  try {
    const workspaceConfig = await readWorkspaceConfig(readWorkspace(req.query.workspace));
    res.json({ tasks: resolveEvalTasks(workspaceConfig.config) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/evals/report", async (req, res, next) => {
  try {
    const workspace = await createWorkspaceContext(readWorkspace(req.query.workspace), { mode: "suggest" });
    res.json({
      report: await createEvalRunReport(workspace, {
        recentLimit: readOptionalInteger(req.query.recentLimit)
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/evals/history", async (req, res, next) => {
  try {
    const workspace = await createWorkspaceContext(readWorkspace(req.query.workspace), { mode: "suggest" });
    res.json({ records: await listEvalRunRecords(workspace) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/evals/runs/:runId", async (req, res, next) => {
  try {
    const { runId } = req.params;
    if (!runId) {
      res.status(400).json({ error: "runId is required" });
      return;
    }
    const workspace = await createWorkspaceContext(readWorkspace(req.query.workspace), { mode: "suggest" });
    res.json({ record: await readEvalRunRecord(workspace, runId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/evals/compare", async (req, res, next) => {
  try {
    const leftRunId = readRequiredQueryString(req.query.leftRunId, "leftRunId");
    const rightRunId = readRequiredQueryString(req.query.rightRunId, "rightRunId");
    const workspace = await createWorkspaceContext(readWorkspace(req.query.workspace), { mode: "suggest" });
    const left = await readEvalRunRecord(workspace, leftRunId);
    const right = await readEvalRunRecord(workspace, rightRunId);
    res.json({ left, right, comparison: compareEvalRunRecords(left, right) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/release/evidence", async (req, res, next) => {
  try {
    const workspacePath = readWorkspace(req.query.workspace);
    const report = await createReleaseEvidenceReport(workspacePath, {
      policyBundleVerification: await readPolicyBundleVerificationOptions(),
      signedPolicyRequired: readRequireSignedPolicyFromEnv(),
      deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      evalReport: { recentLimit: readOptionalInteger(req.query.recentEvals) },
      recentSessionLimit: readOptionalInteger(req.query.recentSessions),
      securityScan: {
        maxFiles: readOptionalInteger(req.query.securityMaxFiles),
        maxFindings: readOptionalInteger(req.query.securityMaxFindings)
      }
    });
    const format = parseReleaseEvidenceFormat(req.query.format);
    if (format === "json") {
      res.json({ report });
      return;
    }
    res.type("text/markdown").send(exportReleaseEvidenceReport(report, "markdown"));
  } catch (error) {
    next(error);
  }
});

app.get("/api/release/preflight", async (req, res, next) => {
  try {
    const root = readWorkspace(req.query.root ?? req.query.workspace);
    const report = await createDistributionPreflightReport(root);
    const format = parseDistributionPreflightFormat(req.query.format);
    if (format === "json") {
      res.json({ report });
      return;
    }
    res.type("text/markdown").send(exportDistributionPreflightReport(report, "markdown"));
  } catch (error) {
    next(error);
  }
});

app.post("/api/memory", async (req, res, next) => {
  try {
    const workspacePath = readWorkspace(req.body.workspace);
    const workspace = await createWorkspaceContext(workspacePath);
    const memory = await appendWorkspaceMemory(workspace, String(req.body.note ?? ""));
    res.json({ memory, path: workspace.memoryPath });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions", async (req, res, next) => {
  try {
    const workspacePath = readWorkspace(req.query.workspace);
    const workspace = await createWorkspaceContext(workspacePath);
    res.json({ sessions: await listSessionHistories(workspace) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/prune", async (req, res, next) => {
  try {
    const workspacePath = readWorkspace(req.body?.workspace ?? req.query.workspace);
    const workspaceConfig = await readWorkspaceConfig(workspacePath);
    const workspace = await createWorkspaceContext(workspacePath);
    const result = await pruneSessionHistories(workspace, createRetentionPolicy(req.body, workspaceConfig.config));
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const workspacePath = readWorkspace(req.query.workspace);
    const workspace = await createWorkspaceContext(workspacePath);
    res.json({ session: await readSessionHistory(workspace, sessionId) });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }

    if (error instanceof InvalidSessionIdError) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (error instanceof Error && error.message === "format must be markdown or json") {
      res.status(400).json({ error: error.message });
      return;
    }

    next(error);
  }
});

app.get("/api/sessions/:sessionId/export", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const format = parseSessionExportFormat(req.query.format);
    const workspacePath = readWorkspace(req.query.workspace);
    const workspace = await createWorkspaceContext(workspacePath);
    const session = await readSessionHistory(workspace, sessionId);
    const exported = exportSessionHistory(session, format);
    if (format === "json") {
      res.type("application/json").send(exported);
      return;
    }
    res.type("text/markdown").send(exported);
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }

    if (error instanceof InvalidSessionIdError) {
      res.status(400).json({ error: error.message });
      return;
    }

    next(error);
  }
});

app.post("/api/approvals/:approvalId", (req, res) => {
  const { approvalId } = req.params;
  if (!approvalId) {
    res.status(400).json({ error: "approvalId is required" });
    return;
  }

  const pending = pendingApprovals.get(approvalId);
  if (!pending) {
    res.status(404).json({ error: "approval request not found or already resolved" });
    return;
  }

  pendingApprovals.delete(approvalId);
  clearTimeout(pending.timeout);
  const approved = Boolean(req.body?.approved);
  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim()
      : approved
        ? "Approved from DeepCodex client."
        : "Denied from DeepCodex client.";
  pending.resolve({ approved, reason, actor: readApprovalActor(req.body?.actor) });
  res.json({ ok: true, approvalId, approved });
});

app.post("/api/agent/run", async (req, res) => {
  const body = req.body as {
    prompt?: string;
    workspace?: string;
    mode?: ApprovalMode;
    approvalMode?: RunApprovalMode;
    maxSteps?: number;
    budget?: BudgetPolicy;
    profileId?: string;
    pricingProfileId?: string;
    model?: string;
    allowNetwork?: boolean;
    allowArchiveListing?: boolean;
    allowPdfTextExtraction?: boolean;
    shellExecutionMode?: unknown;
  };
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  const send = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  let recordEvent: ((event: AgentEvent) => Promise<void>) | undefined;

  try {
    const workspacePath = readWorkspace(body.workspace);
    const workspaceConfig = await readWorkspaceConfig(workspacePath);
    await assertSignedPolicyIfRequired(workspacePath);
    const profile = readPolicyProfile(body.profileId, workspaceConfig.config);
    const policy = createRunPolicy(
      body.mode,
      body.allowNetwork,
      body.allowArchiveListing,
      body.allowPdfTextExtraction,
      readShellExecutionModeFromRequest(body.shellExecutionMode),
      profile,
      workspaceConfig.config
    );
    const provider = readProviderSelection(body.model, workspaceConfig.config);
    assertProviderAllowed(provider, workspaceConfig.config.provider);
    const workspace = await createWorkspaceContext(workspacePath, policy);
    if (policy.allowStateWrite !== false) {
      const recorder = createSessionRecorder(workspace);
      recordEvent = async (event: AgentEvent) => {
        try {
          await recorder.record(event);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to persist DeepCodex session event: ${message}`);
        }
      };
    }

    await runDeepCodexAgent({
      prompt,
      workspace: workspace.root,
      baseUrl: provider.baseUrl,
      model: provider.model,
      fallbackModels: provider.fallbackModels,
      thinking: provider.thinking,
      reasoningEffort: provider.reasoningEffort,
      maxSteps: body.maxSteps ?? workspaceConfig.config.maxSteps ?? profile?.maxSteps,
      policy,
      budget: createBudgetPolicy(body.budget, profile?.budget, body.pricingProfileId, workspaceConfig.config),
      requestToolApproval: createToolApprovalHandler(
        resolveRunApprovalMode(body.approvalMode, profile, workspaceConfig.config)
      ),
      onEvent: async (event) => {
        send(event);
        await recordEvent?.(event);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const event: AgentEvent = { type: "error", message };
    send(event);
    await recordEvent?.(event);
  } finally {
    res.end();
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DeepSeekError) {
    res.status(502).json({
      error: message,
      providerError: {
        kind: error.kind,
        status: error.status,
        retryable: error.retryable
      }
    });
    return;
  }
  res.status(500).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`DeepCodex server listening on http://127.0.0.1:${port}`);
});

function readWorkspace(value: unknown): string {
  const input =
    typeof value === "string" && value.trim()
      ? value
      : process.env.DEEPCODEX_WORKSPACE || process.env.INIT_CWD || process.cwd();
  return input && input.trim() ? input : process.cwd();
}

function readRequiredQueryString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw new Error(`${field} is required.`);
}

function createCorsMiddleware() {
  const allowedOrigins = readCorsOriginsFromEnv();
  if (allowedOrigins.length === 0) {
    return cors();
  }
  return cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  });
}

function readCorsOriginsFromEnv(): string[] {
  const raw = process.env.DEEPCODEX_CORS_ORIGINS;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

type RunApprovalMode = "auto" | "manual" | "deny";

function readPolicyProfile(profileId?: string, config?: WorkspaceConfig) {
  return resolvePolicyProfile(
    profileId ?? process.env.DEEPCODEX_POLICY_PROFILE ?? config?.policyProfileId,
    config?.policyProfiles
  );
}

function createRunPolicy(
  mode: ApprovalMode | undefined,
  allowNetwork: boolean | undefined,
  allowArchiveListing: boolean | undefined,
  allowPdfTextExtraction: boolean | undefined,
  shellExecutionMode: ShellExecutionMode | undefined,
  profile: ReturnType<typeof readPolicyProfile>,
  config?: WorkspaceConfig
) {
  const configPolicy = config?.policy ?? {};
  const base: Partial<ApprovalPolicy> = { ...profile?.policy, ...configPolicy };
  const selected = mode ?? configPolicy.mode ?? profile?.policy.mode ?? "workspace-write";
  return {
    ...base,
    mode: selected,
    allowShell: selected !== "suggest" && (base.allowShell ?? true),
    allowFileWrite: selected !== "suggest" && (base.allowFileWrite ?? true),
    allowNetwork: selected !== "suggest" && resolveAllowNetworkPolicy(allowNetwork, base.allowNetwork),
    allowArchiveListing: resolveAllowArchiveListingPolicy(allowArchiveListing, base.allowArchiveListing),
    allowPdfTextExtraction: resolveAllowPdfTextExtractionPolicy(
      allowPdfTextExtraction,
      base.allowPdfTextExtraction
    ),
    allowStateWrite: selected !== "suggest" && (base.allowStateWrite ?? true),
    deniedPaths: mergeStringLists(base.deniedPaths, readDeniedPathsFromEnv()),
    deniedFileExtensions: mergeStringLists(base.deniedFileExtensions, readDeniedFileExtensionsFromEnv()),
    maxFileBytes: readMaxFileBytesFromEnv() ?? base.maxFileBytes,
    shellEnvironment: readShellEnvironmentModeFromEnv() ?? base.shellEnvironment,
    shellExecutionMode: shellExecutionMode ?? readShellExecutionModeFromEnv() ?? base.shellExecutionMode
  };
}

function readProviderSelection(model: string | undefined, config?: WorkspaceConfig) {
  return resolveProviderSelection({
    baseUrl: process.env.DEEPSEEK_BASE_URL || config?.provider?.baseUrl,
    model: model?.trim() || process.env.DEEPSEEK_MODEL || config?.model,
    fallbackModels: readProviderFallbackModelsFromEnv() ?? config?.provider?.fallbackModels,
    thinking: process.env.DEEPCODEX_PROVIDER_THINKING || config?.provider?.thinking,
    reasoningEffort: process.env.DEEPCODEX_PROVIDER_REASONING_EFFORT || config?.provider?.reasoningEffort
  });
}

function readProviderFallbackModelsFromEnv(): string[] | undefined {
  if (process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS === undefined) {
    return undefined;
  }
  return readCommaSeparatedEnv(process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS);
}

function resolveRunApprovalMode(
  mode: RunApprovalMode | undefined,
  profile: ReturnType<typeof readPolicyProfile>,
  config?: WorkspaceConfig
): RunApprovalMode {
  return mode ?? config?.approvalMode ?? profile?.approvalMode ?? "auto";
}

function readShellEnvironmentModeFromEnv(): ShellEnvironmentMode | undefined {
  const value = process.env.DEEPCODEX_SHELL_ENV;
  if (!value) {
    return undefined;
  }
  if (value === "minimal" || value === "inherit") {
    return value;
  }
  throw new Error("DEEPCODEX_SHELL_ENV must be minimal or inherit.");
}

function readShellExecutionModeFromEnv(): ShellExecutionMode | undefined {
  const value = process.env.DEEPCODEX_SHELL_EXECUTION_MODE;
  if (!value) {
    return undefined;
  }
  if (value === "direct" || value === "workspace-copy") {
    return value;
  }
  throw new Error("DEEPCODEX_SHELL_EXECUTION_MODE must be direct or workspace-copy.");
}

function readShellExecutionModeFromRequest(value: unknown): ShellExecutionMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "direct" || value === "workspace-copy") {
    return value;
  }
  throw new Error("shellExecutionMode must be direct or workspace-copy.");
}

async function readPolicyBundleVerificationOptions(): Promise<PolicyBundleVerificationOptions> {
  const publicKeys: string[] = [];
  for (const publicKeyPath of [
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

function readAllowNetworkFromEnv(): boolean | undefined {
  return readOptionalBooleanEnv(process.env.DEEPCODEX_ALLOW_NETWORK, "DEEPCODEX_ALLOW_NETWORK");
}

function resolveAllowNetworkPolicy(requestAllowNetwork: boolean | undefined, configuredAllowNetwork: boolean | undefined): boolean {
  if (requestAllowNetwork === true) {
    return true;
  }
  return readAllowNetworkFromEnv() ?? configuredAllowNetwork ?? false;
}

function readAllowArchiveListingFromEnv(): boolean | undefined {
  return readOptionalBooleanEnv(process.env.DEEPCODEX_ALLOW_ARCHIVE_LISTING, "DEEPCODEX_ALLOW_ARCHIVE_LISTING");
}

function resolveAllowArchiveListingPolicy(
  requestAllowArchiveListing: boolean | undefined,
  configuredAllowArchiveListing: boolean | undefined
): boolean {
  if (requestAllowArchiveListing === true) {
    return true;
  }
  return readAllowArchiveListingFromEnv() ?? configuredAllowArchiveListing ?? false;
}

function readAllowPdfTextExtractionFromEnv(): boolean | undefined {
  return readOptionalBooleanEnv(process.env.DEEPCODEX_ALLOW_PDF_TEXT_EXTRACTION, "DEEPCODEX_ALLOW_PDF_TEXT_EXTRACTION");
}

function resolveAllowPdfTextExtractionPolicy(
  requestAllowPdfTextExtraction: boolean | undefined,
  configuredAllowPdfTextExtraction: boolean | undefined
): boolean {
  if (requestAllowPdfTextExtraction === true) {
    return true;
  }
  return readAllowPdfTextExtractionFromEnv() ?? configuredAllowPdfTextExtraction ?? false;
}

function createRetentionPolicy(input?: {
  maxSessions?: unknown;
  maxAgeDays?: unknown;
  dryRun?: unknown;
}, config?: WorkspaceConfig): SessionRetentionPolicy {
  return removeUndefinedRetentionValues({
    ...config?.retention,
    ...removeUndefinedRetentionValues(readRetentionPolicyFromEnv()),
    ...removeUndefinedRetentionValues({
      maxSessions: readOptionalInteger(input?.maxSessions),
      maxAgeDays: readOptionalNumber(input?.maxAgeDays),
      dryRun: typeof input?.dryRun === "boolean" ? input.dryRun : undefined
    })
  });
}

function readRetentionPolicyFromEnv(): SessionRetentionPolicy {
  return {
    maxSessions: readOptionalInteger(process.env.DEEPCODEX_MAX_SESSIONS),
    maxAgeDays: readOptionalNumber(process.env.DEEPCODEX_SESSION_RETENTION_DAYS)
  };
}

function readOptionalInteger(value: unknown): number | undefined {
  const parsed = readOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error("Integer values must be whole numbers.");
  }
  return parsed;
}

function removeUndefinedRetentionValues(policy: SessionRetentionPolicy): SessionRetentionPolicy {
  return Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) as SessionRetentionPolicy;
}

function createBudgetPolicy(
  input?: BudgetPolicy,
  profileBudget?: BudgetPolicy,
  pricingProfileId?: string,
  config?: WorkspaceConfig
): BudgetPolicy | undefined {
  const pricingProfile = resolvePricingProfile(
    readPricingProfilesFromEnv(),
    pricingProfileId ?? process.env.DEEPCODEX_PRICING_PROFILE ?? config?.pricingProfileId
  );
  const merged = removeUndefinedBudgetValues({
    ...removeUndefinedBudgetValues(profileBudget ?? {}),
    ...removeUndefinedBudgetValues(config?.budget ?? {}),
    ...readBudgetPolicyFromEnv(),
    ...removeUndefinedBudgetValues(readBudgetPolicyFromInput(input))
  });
  const budget = removeUndefinedBudgetValues(applyPricingProfileToBudget(merged, pricingProfile) ?? {});
  return Object.values(budget).some((value) => value !== undefined) ? budget : undefined;
}

function readPricingProfilesFromEnv() {
  return parsePricingProfiles(process.env.DEEPCODEX_PRICING_PROFILES);
}

function readBudgetPolicyFromEnv(): BudgetPolicy {
  return {
    maxTokens: readOptionalNumber(process.env.DEEPCODEX_MAX_SESSION_TOKENS),
    maxEstimatedUsd: readOptionalNumber(process.env.DEEPCODEX_MAX_SESSION_USD),
    inputUsdPerMillionTokens: readOptionalNumber(process.env.DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS),
    outputUsdPerMillionTokens: readOptionalNumber(process.env.DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS)
  };
}

function readBudgetPolicyFromInput(input?: BudgetPolicy): BudgetPolicy {
  if (!input) {
    return {};
  }
  return {
    maxTokens: readOptionalNumber(input.maxTokens),
    maxEstimatedUsd: readOptionalNumber(input.maxEstimatedUsd),
    inputUsdPerMillionTokens: readOptionalNumber(input.inputUsdPerMillionTokens),
    outputUsdPerMillionTokens: readOptionalNumber(input.outputUsdPerMillionTokens)
  };
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

function removeUndefinedBudgetValues(policy: BudgetPolicy): BudgetPolicy {
  return Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) as BudgetPolicy;
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

function createToolApprovalHandler(mode: RunApprovalMode) {
  if (mode === "auto") {
    return undefined;
  }

  if (mode === "deny") {
    return async (request: ToolApprovalRequest): Promise<ToolApprovalDecision> => ({
      approved: false,
      reason: `Denied by run approval mode for ${request.name}.`,
      actor: "server-deny-policy"
    });
  }

  return async (request: ToolApprovalRequest): Promise<ToolApprovalDecision> => waitForApproval(request);
}

function waitForApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(request.approvalId);
      resolve({
        approved: false,
        reason: "Approval timed out after 10 minutes.",
        actor: "server-timeout"
      });
    }, 10 * 60 * 1000);

    pendingApprovals.set(request.approvalId, { request, resolve, timeout });
  });
}

function readApprovalActor(value: unknown): string {
  if (typeof value !== "string") {
    return "web-console";
  }
  const actor = value.trim();
  return actor ? actor.slice(0, 80) : "web-console";
}
