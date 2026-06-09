import React, { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./styles.css";

type ApprovalMode = "suggest" | "workspace-write" | "full-access";
type ToolApprovalMode = "auto" | "manual" | "deny";
type ShellExecutionMode = "direct" | "workspace-copy";
type DiffViewMode = "unified" | "split";

type AgentEvent =
  | { type: "session_started"; sessionId: string; workspace: string; model: string }
  | { type: "model_usage"; model: string; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: "budget_updated"; budget: BudgetSnapshot }
  | { type: "budget_exceeded"; reason: "tokens" | "cost"; message: string; budget: BudgetSnapshot }
  | { type: "assistant_message"; content: string }
  | {
      type: "tool_approval_requested";
      approvalId: string;
      name: string;
      input: unknown;
      risk: "workspace-write" | "shell" | "memory";
      reason: string;
      requestedAt: string;
      fileAudits?: FileAuditEntry[];
    }
  | {
      type: "tool_approval_resolved";
      approvalId: string;
      name: string;
      approved: boolean;
      reason?: string;
      requestedAt: string;
      resolvedAt: string;
      decisionLatencyMs: number;
      actor?: string;
      fileAudits?: FileAuditEntry[];
    }
  | { type: "tool_started"; name: string; input: unknown }
  | { type: "tool_finished"; name: string; output: string; ok: boolean; audit?: ToolAuditMetadata }
  | { type: "step"; index: number; maxSteps: number }
  | { type: "final"; content: string }
  | { type: "error"; message: string };

type LogKind = "Session" | "Step" | "Usage" | "Budget" | "Assistant" | "Approval" | "Tool" | "Final" | "Error";
type LogTone = "plain" | "muted" | "good" | "bad" | "accent";
type MemoryState = "idle" | "loading" | "ready" | "error";
type LoadState = "idle" | "loading" | "ready" | "error";

type LogItem = {
  id: string;
  tone: LogTone;
  kind: LogKind;
  title: string;
  meta?: string;
  body?: string;
  timestamp: string;
  tokens?: number;
};

type RichTextBlock =
  | { type: "text"; value: string }
  | { type: "diff"; header: string; lines: string[] };

type SplitDiffLine = {
  kind: "add" | "remove" | "context" | "empty";
  marker: string;
  text: string;
};

type SplitDiffRow =
  | { type: "meta"; text: string }
  | { type: "pair"; left: SplitDiffLine; right: SplitDiffLine };

type TokenUsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type BudgetPolicy = {
  maxTokens?: number;
  maxEstimatedUsd?: number;
  inputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens?: number;
};

type ServerPolicyProfile = {
  id: string;
  label: string;
  description: string;
  approvalMode: ToolApprovalMode;
  maxSteps?: number;
  policy: {
    mode: ApprovalMode;
    allowShell?: boolean;
    allowNetwork?: boolean;
    allowFileWrite?: boolean;
    allowStateWrite?: boolean;
    allowSecretWrites?: boolean;
    allowArchiveListing?: boolean;
    allowPdfTextExtraction?: boolean;
    deniedPaths?: string[];
    deniedFileExtensions?: string[];
    redactionPatterns?: string[];
    dlpPatterns?: string[];
    maxFileBytes?: number;
    shellEnvironment?: "minimal" | "inherit";
    shellExecutionMode?: "direct" | "workspace-copy";
    allowedShellCommands?: string[];
    deniedShellCommands?: string[];
  };
  budget?: BudgetPolicy;
};

type WorkspaceConfig = {
  version?: number;
  model?: string;
  provider?: {
    baseUrl?: string;
    allowedBaseUrls?: string[];
    allowedModels?: string[];
  };
  evals?: Array<{
    id: string;
    label: string;
    description: string;
    prompt: string;
    profile: string;
    maxSteps: number;
    budget?: BudgetPolicy;
    expectedSignals: string[];
  }>;
  policyProfileId?: string;
  pricingProfileId?: string;
  approvalMode?: ToolApprovalMode;
  maxSteps?: number;
  policyProfiles?: ServerPolicyProfile[];
  budget?: BudgetPolicy;
  policy?: {
    mode?: ApprovalMode;
    allowShell?: boolean;
    allowNetwork?: boolean;
    allowFileWrite?: boolean;
    allowStateWrite?: boolean;
    allowSecretWrites?: boolean;
    allowArchiveListing?: boolean;
    allowPdfTextExtraction?: boolean;
    deniedPaths?: string[];
    deniedFileExtensions?: string[];
    redactionPatterns?: string[];
    dlpPatterns?: string[];
    maxFileBytes?: number;
    shellEnvironment?: "minimal" | "inherit";
    shellExecutionMode?: "direct" | "workspace-copy";
    allowedShellCommands?: string[];
    deniedShellCommands?: string[];
  };
  retention?: {
    maxSessions?: number;
    maxAgeDays?: number;
    dryRun?: boolean;
  };
};

type WorkspaceConfigResult = {
  path: string;
  exists: boolean;
  config: WorkspaceConfig;
  sha256?: string;
};

type PolicyBundleVerificationResult = {
  path: string;
  exists: boolean;
  ok: boolean;
  signatureVerified: boolean;
  trusted: boolean;
  reason: string;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
  configSha256?: string;
  bundleSha256?: string;
  publicKeySha256?: string;
};

type PricingProfile = {
  id: string;
  label: string;
  description?: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

type BudgetSnapshot = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  maxTokens?: number;
  remainingTokens?: number;
  estimatedUsd?: number;
  maxEstimatedUsd?: number;
  remainingUsd?: number;
};

type FileHashSnapshot = {
  exists: boolean;
  sha256?: string;
  bytes?: number;
  error?: string;
};

type FileAuditEntry = {
  path: string;
  operation?: "write" | "edit";
  before?: FileHashSnapshot;
  after?: FileHashSnapshot;
  applied?: boolean;
};

type ToolAuditMetadata = {
  files?: FileAuditEntry[];
  shell?: ShellAuditEntry;
};

type ShellAuditEntry = {
  executionMode: "direct" | "workspace-copy";
  copiedFiles?: number;
  copiedBytes?: number;
  skippedEntries?: number;
  maxFiles?: number;
  maxBytes?: number;
  workspaceCopyRemoved?: boolean;
};

type SessionSummary = {
  sessionId: string;
  workspace: string;
  model?: string;
  status: "running" | "completed" | "errored";
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  lastEventType?: AgentEvent["type"];
  tokenUsage?: TokenUsageSummary;
  budget?: BudgetSnapshot;
  finalContent?: string;
  errorMessage?: string;
};

type SessionEventRecord = {
  sequence: number;
  timestamp: string;
  event: AgentEvent;
};

type SessionHistory = SessionSummary & {
  events: SessionEventRecord[];
};

type SessionRetentionResult = {
  scanned: number;
  retained: number;
  deleted: string[];
  dryRun: boolean;
};

type SecurityScanFinding = {
  path: string;
  line: number;
  type: string;
  label: string;
};

type SecurityScanResult = {
  scannedFiles: number;
  filesWithFindings: number;
  findings: SecurityScanFinding[];
  maxFiles: number;
  maxFindings: number;
  truncated: boolean;
  skipped: {
    denied: number;
    oversized: number;
    binary: number;
    unreadable: number;
  };
};

type EvalScore = {
  matchedSignals: string[];
  missingSignals: string[];
  totalSignals: number;
  score: number;
  passed: boolean;
};

type EvalRunSummary = {
  id: string;
  evalId: string;
  source?: "built-in" | "workspace";
  label: string;
  model: string;
  sessionId: string;
  createdAt: string;
  expectedSignals: string[];
  score: EvalScore;
  scoreThreshold?: number;
  thresholdPassed: boolean;
  finalTextLength: number;
};

type EvalTaskReport = {
  evalId: string;
  label: string;
  source?: "built-in" | "workspace";
  totalRuns: number;
  averageScore: number;
  bestScore: number;
  worstScore: number;
  latestRunId?: string;
  latestCreatedAt?: string;
  latestScore?: number;
  latestPassed?: boolean;
  latestThresholdPassed?: boolean;
  previousRunId?: string;
  scoreDeltaFromPrevious?: number;
  passChangedFromPrevious?: boolean;
  thresholdStatusChangedFromPrevious?: boolean;
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

type EvalRunReport = {
  workspace: string;
  generatedAt: string;
  totalRuns: number;
  averageScore: number;
  passRate: number;
  thresholdPassRate: number;
  recentRuns: EvalRunSummary[];
  byEval: EvalTaskReport[];
  latestComparison?: EvalRunComparison;
};

type ReleaseEvidenceCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
};

type ReleaseEvidenceReport = {
  generatedAt: string;
  workspace: string;
  signedPolicyRequired: boolean;
  workspaceConfig: {
    path: string;
    exists: boolean;
    sha256?: string;
  };
  policyBundle: PolicyBundleVerificationResult;
  evals: EvalRunReport;
  securityScan: SecurityScanResult;
  sessions: {
    total: number;
    recent: SessionSummary[];
  };
  checks: ReleaseEvidenceCheck[];
  summary: {
    ready: boolean;
    pass: number;
    warn: number;
    fail: number;
    info: number;
  };
};

type DistributionPreflightCheck = {
  id: string;
  area: "scripts" | "client" | "desktop" | "artifacts" | "docs" | "safety";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

type DistributionPreflightReport = {
  generatedAt: string;
  root: string;
  checks: DistributionPreflightCheck[];
  summary: {
    ready: boolean;
    pass: number;
    warn: number;
    fail: number;
  };
};

type PolicyProfileOption = {
  id: string;
  label: string;
  detail: string;
  mode?: ApprovalMode;
  approvalMode?: ToolApprovalMode;
  maxSteps?: number;
};

type WorkspaceProfile = {
  id: string;
  label: string;
  workspace: string;
  serverUrl: string;
  policyProfileId: string;
  shellExecutionMode: ShellExecutionMode;
  allowPdfTextExtraction?: boolean;
  maxSteps: string;
  updatedAt: string;
};

type PendingApproval = {
  approvalId: string;
  name: string;
  input: unknown;
  risk: "workspace-write" | "shell" | "memory";
  reason: string;
  requestedAt: string;
  fileAudits?: FileAuditEntry[];
};

const workspaceProfilesStorageKey = "deepcodex.workspaceProfiles";
const defaultWorkspace = localStorage.getItem("deepcodex.workspace") ?? "";
const defaultMaxSessionTokens = localStorage.getItem("deepcodex.maxSessionTokens") ?? "";
const defaultMaxSessionUsd = localStorage.getItem("deepcodex.maxSessionUsd") ?? "";
const defaultInputUsdPerMillionTokens = localStorage.getItem("deepcodex.inputUsdPerMillionTokens") ?? "";
const defaultOutputUsdPerMillionTokens = localStorage.getItem("deepcodex.outputUsdPerMillionTokens") ?? "";
const defaultMaxSteps = localStorage.getItem("deepcodex.maxSteps") ?? "12";
const defaultRetentionMaxSessions = localStorage.getItem("deepcodex.retentionMaxSessions") ?? "";
const defaultRetentionMaxAgeDays = localStorage.getItem("deepcodex.retentionMaxAgeDays") ?? "";
const defaultPolicyProfile =
  localStorage.getItem("deepcodex.policyProfile") ?? "custom";
const defaultPricingProfile = localStorage.getItem("deepcodex.pricingProfile") ?? "custom";
const defaultShellExecutionMode =
  (localStorage.getItem("deepcodex.shellExecutionMode") as ShellExecutionMode | null) ?? "direct";
const defaultAllowPdfTextExtraction = localStorage.getItem("deepcodex.allowPdfTextExtraction") === "true";
const defaultDiffViewMode = localStorage.getItem("deepcodex.diffViewMode") === "split" ? "split" : "unified";
const configuredServerUrl = normalizeServerUrl(import.meta.env.VITE_DEEPCODEX_SERVER_URL ?? "http://127.0.0.1:17361");
const defaultServerUrl = localStorage.getItem("deepcodex.serverUrl") ?? configuredServerUrl;
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

const modeOptions: Array<{ value: ApprovalMode; label: string; detail: string }> = [
  { value: "suggest", label: "Suggest", detail: "Read-only planning and recommendations" },
  { value: "workspace-write", label: "Workspace write", detail: "Edits and commands inside the workspace" },
  { value: "full-access", label: "Full access", detail: "Unrestricted local execution for trusted runs" }
];

const approvalOptions: Array<{ value: ToolApprovalMode; label: string; detail: string }> = [
  { value: "auto", label: "Auto", detail: "Run requested tools after mode checks" },
  { value: "manual", label: "Manual", detail: "Pause write, shell, and memory tools for review" },
  { value: "deny", label: "Deny", detail: "Reject mutating tool calls for dry runs" }
];

const shellExecutionOptions: Array<{ value: ShellExecutionMode; label: string }> = [
  { value: "direct", label: "Direct workspace" },
  { value: "workspace-copy", label: "Temporary copy" }
];

const basePolicyProfileOptions: PolicyProfileOption[] = [
  {
    id: "custom",
    label: "Custom controls",
    detail: "Use the sidebar settings exactly as configured."
  },
  {
    id: "inspection",
    label: "Inspection",
    detail: "Read-only planning without shell, writes, memory writes, or session state.",
    mode: "suggest",
    approvalMode: "deny",
    maxSteps: 8
  },
  {
    id: "guarded-write",
    label: "Guarded write",
    detail: "Workspace-scoped edits with manual review and shell network blocked by default.",
    mode: "workspace-write",
    approvalMode: "manual",
    maxSteps: 12
  },
  {
    id: "full-access-review",
    label: "Full access review",
    detail: "Full-access command policy with manual review and shell network blocked by default.",
    mode: "full-access",
    approvalMode: "manual",
    maxSteps: 12
  }
];

const taskPresets = [
  {
    label: "Review the current app",
    detail: "Find the highest-risk gaps and next fixes.",
    prompt: "Inspect this repository and identify the highest-risk implementation gaps with concrete next steps."
  },
  {
    label: "Plan a focused change",
    detail: "Turn a feature idea into an implementation plan.",
    prompt: "Inspect the codebase and propose a focused implementation plan for the next useful feature."
  },
  {
    label: "Verify recent work",
    detail: "Run the smallest relevant checks and summarize risk.",
    prompt: "Inspect the repository, run the relevant checks, and summarize what is verified and what remains risky."
  }
];

const memoryStateLabels: Record<MemoryState, string> = {
  idle: "Idle",
  loading: "Loading",
  ready: "Ready",
  error: "Error"
};

function App() {
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [serverUrl, setServerUrl] = useState(normalizeServerUrl(defaultServerUrl) || configuredServerUrl);
  const [serverUrlDraft, setServerUrlDraft] = useState(defaultServerUrl);
  const [serverMessage, setServerMessage] = useState("");
  const [prompt, setPrompt] = useState("Inspect this repository and propose the safest next implementation step.");
  const [policyProfileId, setPolicyProfileId] = useState<PolicyProfileOption["id"]>(defaultPolicyProfile);
  const [mode, setMode] = useState<ApprovalMode>("workspace-write");
  const [approvalMode, setApprovalMode] = useState<ToolApprovalMode>("manual");
  const [shellExecutionMode, setShellExecutionMode] = useState<ShellExecutionMode>(
    defaultShellExecutionMode === "workspace-copy" ? "workspace-copy" : "direct"
  );
  const [allowPdfTextExtraction, setAllowPdfTextExtraction] = useState(defaultAllowPdfTextExtraction);
  const [maxSteps, setMaxSteps] = useState(defaultMaxSteps);
  const [maxSessionTokens, setMaxSessionTokens] = useState(defaultMaxSessionTokens);
  const [maxSessionUsd, setMaxSessionUsd] = useState(defaultMaxSessionUsd);
  const [inputUsdPerMillionTokens, setInputUsdPerMillionTokens] = useState(defaultInputUsdPerMillionTokens);
  const [outputUsdPerMillionTokens, setOutputUsdPerMillionTokens] = useState(defaultOutputUsdPerMillionTokens);
  const [budgetSnapshot, setBudgetSnapshot] = useState<BudgetSnapshot | null>(null);
  const [pricingProfileId, setPricingProfileId] = useState(defaultPricingProfile);
  const [pricingProfiles, setPricingProfiles] = useState<PricingProfile[]>([]);
  const [policyProfileOptions, setPolicyProfileOptions] = useState<PolicyProfileOption[]>(basePolicyProfileOptions);
  const [retentionMaxSessions, setRetentionMaxSessions] = useState(defaultRetentionMaxSessions);
  const [retentionMaxAgeDays, setRetentionMaxAgeDays] = useState(defaultRetentionMaxAgeDays);
  const [retentionState, setRetentionState] = useState<LoadState>("idle");
  const [securityScanState, setSecurityScanState] = useState<LoadState>("idle");
  const [securityScan, setSecurityScan] = useState<SecurityScanResult | null>(null);
  const [securityScanMessage, setSecurityScanMessage] = useState("");
  const [evalReportState, setEvalReportState] = useState<LoadState>("idle");
  const [evalReport, setEvalReport] = useState<EvalRunReport | null>(null);
  const [evalReportMessage, setEvalReportMessage] = useState("");
  const [releaseEvidenceState, setReleaseEvidenceState] = useState<LoadState>("idle");
  const [releaseEvidence, setReleaseEvidence] = useState<ReleaseEvidenceReport | null>(null);
  const [releaseEvidenceMessage, setReleaseEvidenceMessage] = useState("");
  const [releaseEvidenceExportState, setReleaseEvidenceExportState] = useState<LoadState>("idle");
  const [distributionPreflightState, setDistributionPreflightState] = useState<LoadState>("idle");
  const [distributionPreflight, setDistributionPreflight] = useState<DistributionPreflightReport | null>(null);
  const [distributionPreflightMessage, setDistributionPreflightMessage] = useState("");
  const [distributionPreflightExportState, setDistributionPreflightExportState] = useState<LoadState>("idle");
  const [configState, setConfigState] = useState<LoadState>("idle");
  const [workspaceConfigResult, setWorkspaceConfigResult] = useState<WorkspaceConfigResult | null>(null);
  const [configMessage, setConfigMessage] = useState("");
  const [policyBundleState, setPolicyBundleState] = useState<LoadState>("idle");
  const [policyBundle, setPolicyBundle] = useState<PolicyBundleVerificationResult | null>(null);
  const [policyBundleMessage, setPolicyBundleMessage] = useState("");
  const [workspaceProfiles, setWorkspaceProfiles] = useState<WorkspaceProfile[]>(readStoredWorkspaceProfiles);
  const [selectedWorkspaceProfileId, setSelectedWorkspaceProfileId] = useState("");
  const [workspaceProfileName, setWorkspaceProfileName] = useState("");
  const [workspaceProfileMessage, setWorkspaceProfileMessage] = useState("");
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>(defaultDiffViewMode);
  const [isRunning, setIsRunning] = useState(false);
  const [items, setItems] = useState<LogItem[]>([]);
  const [finalText, setFinalText] = useState("");
  const [memory, setMemory] = useState("");
  const [memoryPath, setMemoryPath] = useState("");
  const [memoryState, setMemoryState] = useState<MemoryState>("idle");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionState, setSessionState] = useState<LoadState>("idle");
  const [selectedSession, setSelectedSession] = useState<SessionHistory | null>(null);
  const [replayState, setReplayState] = useState<LoadState>("idle");
  const [replayError, setReplayError] = useState("");
  const [loadingReplaySessionId, setLoadingReplaySessionId] = useState("");
  const [exportingSessionId, setExportingSessionId] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  const status = useMemo(() => {
    if (isRunning) {
      return "Running";
    }
    if (finalText) {
      return "Ready";
    }
    return "Idle";
  }, [finalText, isRunning]);

  const counts = useMemo(
    () => ({
      errors: items.filter((item) => item.kind === "Error" || item.tone === "bad").length,
      finals: items.filter((item) => item.kind === "Final").length,
      tools: items.filter((item) => item.kind === "Tool").length,
      tokens: items.reduce((sum, item) => sum + (item.tokens ?? 0), 0)
    }),
    [items]
  );

  const latestItem = items.length > 0 ? items[items.length - 1] : undefined;
  const canRun = prompt.trim().length > 0 && !isRunning;
  const serverStatus = serverUrl === configuredServerUrl ? "Default" : "Custom";
  const serverDraftChanged = normalizeServerUrl(serverUrlDraft) !== serverUrl;
  const statusTone = isRunning ? "running" : finalText ? "ready" : "idle";
  const policyBundleStatus = formatPolicyBundleStatus(policyBundle, policyBundleState);
  const policyBundleTone = formatPolicyBundleTone(policyBundle, policyBundleState);
  const workspaceConfigStatus = formatWorkspaceConfigStatus(workspaceConfigResult, configState);
  const workspaceConfigTone = formatWorkspaceConfigTone(workspaceConfigResult, configState);
  const securityScanStatus = formatSecurityScanStatus(securityScan, securityScanState);
  const securityScanTone = formatSecurityScanTone(securityScan, securityScanState);
  const evalReportStatus = formatEvalReportStatus(evalReport, evalReportState);
  const evalReportTone = formatEvalReportTone(evalReport, evalReportState);
  const releaseEvidenceStatus = formatReleaseEvidenceStatus(releaseEvidence, releaseEvidenceState);
  const releaseEvidenceTone = formatReleaseEvidenceTone(releaseEvidence, releaseEvidenceState);
  const distributionPreflightStatus = formatDistributionPreflightStatus(
    distributionPreflight,
    distributionPreflightState
  );
  const distributionPreflightTone = formatDistributionPreflightTone(distributionPreflight, distributionPreflightState);
  const selectedWorkspaceProfile = workspaceProfiles.find((profile) => profile.id === selectedWorkspaceProfileId);
  const memoryLabel = memoryStateLabels[memoryState];
  const replayItems = useMemo(
    () =>
      selectedSession?.events.map((record) =>
        createLogItemFromEvent(
          record.event,
          formatStoredTime(record.timestamp),
          `${selectedSession.sessionId}-${record.sequence}`
        )
      ) ?? [],
    [selectedSession]
  );

  useEffect(() => {
    void loadPricingProfiles();
    void loadPolicyProfiles();
  }, [serverUrl]);

  useEffect(() => {
    setPolicyBundle(null);
    setPolicyBundleState("idle");
    setPolicyBundleMessage("");
    setSecurityScan(null);
    setSecurityScanState("idle");
    setSecurityScanMessage("");
    setEvalReport(null);
    setEvalReportState("idle");
    setEvalReportMessage("");
    setReleaseEvidence(null);
    setReleaseEvidenceState("idle");
    setReleaseEvidenceMessage("");
    setReleaseEvidenceExportState("idle");
    setDistributionPreflight(null);
    setDistributionPreflightState("idle");
    setDistributionPreflightMessage("");
    setDistributionPreflightExportState("idle");
    setWorkspaceConfigResult(null);
    setConfigState("idle");
    setConfigMessage("");
  }, [workspace, serverUrl]);

  async function runAgent() {
    if (!prompt.trim()) {
      return;
    }

    setIsRunning(true);
    setFinalText("");
    setItems([]);
    setBudgetSnapshot(null);
    setPendingApprovals([]);
    localStorage.setItem("deepcodex.workspace", workspace);
    localStorage.setItem("deepcodex.policyProfile", policyProfileId);
    localStorage.setItem("deepcodex.shellExecutionMode", shellExecutionMode);
    localStorage.setItem("deepcodex.allowPdfTextExtraction", String(allowPdfTextExtraction));
    localStorage.setItem("deepcodex.maxSteps", maxSteps);
    localStorage.setItem("deepcodex.maxSessionTokens", maxSessionTokens);
    localStorage.setItem("deepcodex.maxSessionUsd", maxSessionUsd);
    localStorage.setItem("deepcodex.inputUsdPerMillionTokens", inputUsdPerMillionTokens);
    localStorage.setItem("deepcodex.outputUsdPerMillionTokens", outputUsdPerMillionTokens);
    localStorage.setItem("deepcodex.pricingProfile", pricingProfileId);

    try {
      const budget = createBudgetPayload({
        maxSessionTokens,
        maxSessionUsd,
        inputUsdPerMillionTokens,
        outputUsdPerMillionTokens
      });
      const response = await fetch(`${serverUrl}/api/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          workspace,
          profileId: policyProfileId === "custom" ? undefined : policyProfileId,
          mode,
          approvalMode,
          shellExecutionMode,
          allowPdfTextExtraction,
          maxSteps: readOptionalRunInteger(maxSteps, "Max steps") ?? selectedPolicyProfile()?.maxSteps ?? 12,
          pricingProfileId: pricingProfileId === "custom" ? undefined : pricingProfileId,
          budget
        })
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      if (!response.body) {
        throw new Error("The server did not return a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          applyEventChunk(chunk);
        }
      }

      if (buffer.trim()) {
        applyEventChunk(buffer);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushItem({ kind: "Error", tone: "bad", title: "Run failed", meta: "Client", body: message });
    } finally {
      setIsRunning(false);
    }
  }

  async function loadMemory() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    setMemoryState("loading");
    try {
      const response = await fetch(`${serverUrl}/api/memory?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { memory: string; path?: string };
      setMemory(body.memory);
      setMemoryPath(body.path ?? "");
      setMemoryState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemory(message);
      setMemoryPath("");
      setMemoryState("error");
    }
  }

  function saveServerUrl() {
    const normalized = normalizeServerUrl(serverUrlDraft) || configuredServerUrl;
    setServerUrlDraft(normalized);
    setServerUrl(normalized);
    localStorage.setItem("deepcodex.serverUrl", normalized);
    setServerMessage(`Using ${normalized}`);
    if (normalized === serverUrl) {
      void loadPricingProfiles(normalized);
      void loadPolicyProfiles(workspace, normalized);
    }
  }

  async function loadPricingProfiles(baseUrl = serverUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/pricing-profiles`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { profiles: PricingProfile[]; defaultProfileId?: string };
      setPricingProfiles(body.profiles);
      const defaultProfile = body.defaultProfileId && body.defaultProfileId !== "custom" ? body.defaultProfileId : "";
      if (defaultProfile && !localStorage.getItem("deepcodex.pricingProfile")) {
        setPricingProfileId(defaultProfile);
      }
    } catch {
      setPricingProfiles([]);
    }
  }

  async function loadPolicyProfiles(workspaceOverride = workspace, baseUrl = serverUrl) {
    const params = new URLSearchParams();
    if (workspaceOverride) {
      params.set("workspace", workspaceOverride);
    }
    try {
      const response = await fetch(`${baseUrl}/api/policy-profiles?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { profiles: ServerPolicyProfile[]; defaultProfileId?: string };
      const nextProfiles = toPolicyProfileOptions(body.profiles);
      setPolicyProfileOptions(nextProfiles);
      if (body.defaultProfileId && body.defaultProfileId !== "custom" && !localStorage.getItem("deepcodex.policyProfile")) {
        applyPolicyProfile(body.defaultProfileId, nextProfiles);
      }
    } catch {
      setPolicyProfileOptions(basePolicyProfileOptions);
    }
  }

  async function loadWorkspaceConfig() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    setConfigState("loading");
    setConfigMessage("");
    try {
      const response = await fetch(`${serverUrl}/api/workspace-config?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const result = (await response.json()) as WorkspaceConfigResult;
      setWorkspaceConfigResult(result);
      if (result.exists) {
        const nextProfiles = mergePolicyProfileOptions(result.config.policyProfiles);
        setPolicyProfileOptions(nextProfiles);
        applyWorkspaceConfig(result.config, nextProfiles);
        setConfigMessage(`Loaded ${result.path}${result.sha256 ? ` sha256:${result.sha256.slice(0, 12)}` : ""}`);
      } else {
        setConfigMessage(`No config at ${result.path}`);
      }
      setConfigState("ready");
      void loadPolicyBundle(workspace, serverUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceConfigResult(null);
      setConfigMessage(message);
      setConfigState("error");
    }
  }

  async function loadPolicyBundle(workspaceOverride = workspace, baseUrl = serverUrl) {
    const params = new URLSearchParams();
    if (workspaceOverride) {
      params.set("workspace", workspaceOverride);
    }
    setPolicyBundleState("loading");
    setPolicyBundleMessage("");
    try {
      const response = await fetch(`${baseUrl}/api/policy-bundle?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const result = (await response.json()) as PolicyBundleVerificationResult;
      setPolicyBundle(result);
      setPolicyBundleMessage(result.reason);
      setPolicyBundleState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPolicyBundle(null);
      setPolicyBundleMessage(message);
      setPolicyBundleState("error");
    }
  }

  async function loadSecurityScan() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    if (policyProfileId !== "custom") {
      params.set("profileId", policyProfileId);
    }
    params.set("maxFiles", "500");
    params.set("maxFindings", "200");
    setSecurityScanState("loading");
    setSecurityScanMessage("");
    try {
      const response = await fetch(`${serverUrl}/api/security/scan?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { result: SecurityScanResult };
      setSecurityScan(body.result);
      setSecurityScanMessage(formatSecurityScanMessage(body.result));
      setSecurityScanState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSecurityScan(null);
      setSecurityScanMessage(message);
      setSecurityScanState("error");
    }
  }

  async function loadEvalReport() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    params.set("recentLimit", "8");
    setEvalReportState("loading");
    setEvalReportMessage("");
    try {
      const response = await fetch(`${serverUrl}/api/evals/report?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { report: EvalRunReport };
      setEvalReport(body.report);
      setEvalReportMessage(formatEvalReportMessage(body.report));
      setEvalReportState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEvalReport(null);
      setEvalReportMessage(message);
      setEvalReportState("error");
    }
  }

  async function loadReleaseEvidence() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    params.set("format", "json");
    params.set("recentEvals", "8");
    params.set("recentSessions", "8");
    params.set("securityMaxFiles", "500");
    params.set("securityMaxFindings", "200");
    setReleaseEvidenceState("loading");
    setReleaseEvidenceMessage("");
    try {
      const response = await fetch(`${serverUrl}/api/release/evidence?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { report: ReleaseEvidenceReport };
      setReleaseEvidence(body.report);
      setReleaseEvidenceMessage(formatReleaseEvidenceMessage(body.report));
      setReleaseEvidenceState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setReleaseEvidence(null);
      setReleaseEvidenceMessage(message);
      setReleaseEvidenceState("error");
    }
  }

  async function exportReleaseEvidenceMarkdown() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    params.set("format", "markdown");
    params.set("recentEvals", "8");
    params.set("recentSessions", "8");
    params.set("securityMaxFiles", "500");
    params.set("securityMaxFindings", "200");
    setReleaseEvidenceExportState("loading");
    try {
      const response = await fetch(`${serverUrl}/api/release/evidence?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      downloadTextFile(await response.text(), "deepcodex-release-evidence.md", "text/markdown;charset=utf-8");
      pushItem({
        kind: "Session",
        tone: "good",
        title: "Release evidence export ready",
        meta: "Markdown",
        body: "Downloaded release evidence report."
      });
      setReleaseEvidenceExportState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushItem({ kind: "Error", tone: "bad", title: "Release evidence export failed", meta: "Markdown", body: message });
      setReleaseEvidenceExportState("error");
    }
  }

  async function loadDistributionPreflight() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("root", workspace);
    }
    params.set("format", "json");
    setDistributionPreflightState("loading");
    setDistributionPreflightMessage("");
    try {
      const response = await fetch(`${serverUrl}/api/release/preflight?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { report: DistributionPreflightReport };
      setDistributionPreflight(body.report);
      setDistributionPreflightMessage(formatDistributionPreflightMessage(body.report));
      setDistributionPreflightState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDistributionPreflight(null);
      setDistributionPreflightMessage(message);
      setDistributionPreflightState("error");
    }
  }

  async function exportDistributionPreflightMarkdown() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("root", workspace);
    }
    params.set("format", "markdown");
    setDistributionPreflightExportState("loading");
    try {
      const response = await fetch(`${serverUrl}/api/release/preflight?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      downloadTextFile(await response.text(), "deepcodex-distribution-preflight.md", "text/markdown;charset=utf-8");
      pushItem({
        kind: "Session",
        tone: "good",
        title: "Distribution preflight export ready",
        meta: "Markdown",
        body: "Downloaded distribution preflight report."
      });
      setDistributionPreflightExportState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushItem({ kind: "Error", tone: "bad", title: "Distribution preflight export failed", meta: "Markdown", body: message });
      setDistributionPreflightExportState("error");
    }
  }

  async function loadSessions() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    setSessionState("loading");
    setSelectedSession(null);
    setReplayState("idle");
    setReplayError("");
    setLoadingReplaySessionId("");
    setExportingSessionId("");
    try {
      const response = await fetch(`${serverUrl}/api/sessions?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { sessions: SessionSummary[] };
      setSessions(body.sessions);
      setSessionState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessions([
        {
          sessionId: "load-error",
          workspace: workspace || "default",
          status: "errored",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          eventCount: 0,
          errorMessage: message
        }
      ]);
      setSessionState("error");
    }
  }

  async function loadSessionReplay(sessionId: string) {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    setReplayState("loading");
    setReplayError("");
    setLoadingReplaySessionId(sessionId);
    try {
      const response = await fetch(`${serverUrl}/api/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { session: SessionHistory };
      setSelectedSession(body.session);
      setReplayState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSelectedSession(null);
      setReplayError(message);
      setReplayState("error");
    } finally {
      setLoadingReplaySessionId("");
    }
  }

  async function exportSession(sessionId: string) {
    const params = new URLSearchParams({ format: "markdown" });
    if (workspace) {
      params.set("workspace", workspace);
    }
    setExportingSessionId(sessionId);
    try {
      const response = await fetch(`${serverUrl}/api/sessions/${encodeURIComponent(sessionId)}/export?${params}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      downloadTextFile(await response.text(), `deepcodex-session-${sessionId}.md`, "text/markdown;charset=utf-8");
      pushItem({
        kind: "Session",
        tone: "good",
        title: "Audit export ready",
        meta: sessionId.slice(0, 8),
        body: `Downloaded Markdown export for ${sessionId}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushItem({ kind: "Error", tone: "bad", title: "Audit export failed", meta: sessionId.slice(0, 8), body: message });
    } finally {
      setExportingSessionId("");
    }
  }

  async function pruneSessions(dryRun: boolean) {
    setRetentionState("loading");
    localStorage.setItem("deepcodex.retentionMaxSessions", retentionMaxSessions);
    localStorage.setItem("deepcodex.retentionMaxAgeDays", retentionMaxAgeDays);
    try {
      const retention = createRetentionPayload({ retentionMaxSessions, retentionMaxAgeDays });
      const response = await fetch(`${serverUrl}/api/sessions/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, dryRun, ...retention })
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { result: SessionRetentionResult };
      const mode = body.result.dryRun ? "Retention dry run" : "Retention prune complete";
      pushItem({
        kind: "Session",
        tone: body.result.deleted.length > 0 ? "good" : "muted",
        title: mode,
        meta: `${body.result.deleted.length} sessions`,
        body: formatRetentionResult(body.result)
      });
      setRetentionState("ready");
      if (!body.result.dryRun) {
        await loadSessions();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRetentionState("error");
      pushItem({ kind: "Error", tone: "bad", title: "Retention prune failed", meta: "Audit", body: message });
    }
  }

  async function resolveApproval(approvalId: string, approved: boolean) {
    try {
      const response = await fetch(`${serverUrl}/api/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved,
          reason: approved ? "Approved in Web console." : "Denied in Web console.",
          actor: "web-console"
        })
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      setPendingApprovals((current) => current.filter((approval) => approval.approvalId !== approvalId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushItem({ kind: "Error", tone: "bad", title: "Approval response failed", meta: approvalId, body: message });
    }
  }

  function applyEventChunk(chunk: string) {
    const dataLines = chunk.split("\n").filter((entry) => entry.startsWith("data: "));
    for (const line of dataLines) {
      try {
        applyEvent(JSON.parse(line.slice(6)) as AgentEvent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushItem({ kind: "Error", tone: "bad", title: "Malformed stream event", meta: "Parser", body: message });
      }
    }
  }

  function applyEvent(event: AgentEvent) {
    switch (event.type) {
      case "tool_approval_requested":
        setPendingApprovals((current) => [
          ...current,
          {
            approvalId: event.approvalId,
            name: event.name,
            input: event.input,
            risk: event.risk,
            reason: event.reason,
            requestedAt: formatStoredTime(event.requestedAt),
            fileAudits: event.fileAudits
          }
        ]);
        break;
      case "tool_approval_resolved":
        setPendingApprovals((current) => current.filter((approval) => approval.approvalId !== event.approvalId));
        break;
      case "budget_updated":
      case "budget_exceeded":
        setBudgetSnapshot(event.budget);
        break;
      case "final":
        setFinalText(event.content);
        break;
    }
    pushLogItem(createLogItemFromEvent(event, formatTimestamp(), crypto.randomUUID()));
  }

  function pushLogItem(item: LogItem) {
    setItems((current) => [...current, item]);
  }

  function pushItem(item: Omit<LogItem, "id" | "timestamp">) {
    pushLogItem({ ...item, id: crypto.randomUUID(), timestamp: formatTimestamp() });
  }

  function applyPolicyProfile(profileId: string, options = policyProfileOptions) {
    setPolicyProfileId(profileId);
    const profile = options.find((entry) => entry.id === profileId);
    if (profile?.mode) {
      setMode(profile.mode);
    }
    if (profile?.approvalMode) {
      setApprovalMode(profile.approvalMode);
    }
    if (profile?.maxSteps) {
      setMaxSteps(String(profile.maxSteps));
    }
  }

  function selectedPolicyProfile() {
    return policyProfileOptions.find((entry) => entry.id === policyProfileId);
  }

  function applyWorkspaceConfig(config: WorkspaceConfig, options = policyProfileOptions) {
    const configuredProfileId = toPolicyProfileOptionId(config.policyProfileId, options);
    if (configuredProfileId) {
      applyPolicyProfile(configuredProfileId, options);
    }
    if (config.policy?.mode) {
      setMode(config.policy.mode);
    }
    if (config.approvalMode) {
      setApprovalMode(config.approvalMode);
    }
    if (config.policy?.shellExecutionMode) {
      setShellExecutionMode(config.policy.shellExecutionMode);
    }
    if (config.policy?.allowPdfTextExtraction !== undefined) {
      setAllowPdfTextExtraction(config.policy.allowPdfTextExtraction);
    }
    if (config.maxSteps !== undefined) {
      setMaxSteps(String(config.maxSteps));
    }
    if (config.pricingProfileId) {
      setPricingProfileId(config.pricingProfileId);
    }
    applyBudgetConfig(config.budget);
    if (config.retention?.maxSessions !== undefined) {
      setRetentionMaxSessions(String(config.retention.maxSessions));
    }
    if (config.retention?.maxAgeDays !== undefined) {
      setRetentionMaxAgeDays(String(config.retention.maxAgeDays));
    }
  }

  function applyBudgetConfig(budget?: BudgetPolicy) {
    if (!budget) {
      return;
    }
    if (budget.maxTokens !== undefined) {
      setMaxSessionTokens(String(budget.maxTokens));
    }
    if (budget.maxEstimatedUsd !== undefined) {
      setMaxSessionUsd(String(budget.maxEstimatedUsd));
    }
    if (budget.inputUsdPerMillionTokens !== undefined) {
      setInputUsdPerMillionTokens(String(budget.inputUsdPerMillionTokens));
    }
    if (budget.outputUsdPerMillionTokens !== undefined) {
      setOutputUsdPerMillionTokens(String(budget.outputUsdPerMillionTokens));
    }
  }

  function updateDiffViewMode(nextMode: DiffViewMode) {
    setDiffViewMode(nextMode);
    localStorage.setItem("deepcodex.diffViewMode", nextMode);
  }

  function selectWorkspaceProfile(profileId: string) {
    const profile = workspaceProfiles.find((entry) => entry.id === profileId);
    setSelectedWorkspaceProfileId(profileId);
    setWorkspaceProfileName(profile?.label ?? "");
    setWorkspaceProfileMessage("");
  }

  function saveWorkspaceProfile() {
    const label = workspaceProfileName.trim() || workspace.trim() || "Local workspace";
    const existing = selectedWorkspaceProfile;
    const profile: WorkspaceProfile = {
      id: existing?.id ?? createWorkspaceProfileId(label),
      label,
      workspace,
      serverUrl,
      policyProfileId,
      shellExecutionMode,
      allowPdfTextExtraction,
      maxSteps,
      updatedAt: new Date().toISOString()
    };
    const nextProfiles = existing
      ? workspaceProfiles.map((entry) => (entry.id === existing.id ? profile : entry))
      : [profile, ...workspaceProfiles].slice(0, 12);
    setWorkspaceProfiles(nextProfiles);
    writeStoredWorkspaceProfiles(nextProfiles);
    setSelectedWorkspaceProfileId(profile.id);
    setWorkspaceProfileName(profile.label);
    setWorkspaceProfileMessage(`Saved ${profile.label}.`);
  }

  function applyWorkspaceProfile() {
    if (!selectedWorkspaceProfile) {
      setWorkspaceProfileMessage("No profile selected.");
      return;
    }
    const normalizedServerUrl = normalizeServerUrl(selectedWorkspaceProfile.serverUrl) || configuredServerUrl;
    setWorkspace(selectedWorkspaceProfile.workspace);
    setServerUrl(normalizedServerUrl);
    setServerUrlDraft(normalizedServerUrl);
    setPolicyProfileId(toPolicyProfileOptionId(selectedWorkspaceProfile.policyProfileId) ?? "custom");
    setShellExecutionMode(selectedWorkspaceProfile.shellExecutionMode);
    setAllowPdfTextExtraction(selectedWorkspaceProfile.allowPdfTextExtraction === true);
    setMaxSteps(selectedWorkspaceProfile.maxSteps || defaultMaxSteps);
    setWorkspaceProfileName(selectedWorkspaceProfile.label);
    localStorage.setItem("deepcodex.workspace", selectedWorkspaceProfile.workspace);
    localStorage.setItem("deepcodex.serverUrl", normalizedServerUrl);
    localStorage.setItem("deepcodex.policyProfile", selectedWorkspaceProfile.policyProfileId);
    localStorage.setItem("deepcodex.shellExecutionMode", selectedWorkspaceProfile.shellExecutionMode);
    localStorage.setItem("deepcodex.allowPdfTextExtraction", String(selectedWorkspaceProfile.allowPdfTextExtraction === true));
    localStorage.setItem("deepcodex.maxSteps", selectedWorkspaceProfile.maxSteps || defaultMaxSteps);
    setWorkspaceProfileMessage(`Applied ${selectedWorkspaceProfile.label}.`);
  }

  function removeWorkspaceProfile() {
    if (!selectedWorkspaceProfile) {
      setWorkspaceProfileMessage("No profile selected.");
      return;
    }
    const nextProfiles = workspaceProfiles.filter((profile) => profile.id !== selectedWorkspaceProfile.id);
    setWorkspaceProfiles(nextProfiles);
    writeStoredWorkspaceProfiles(nextProfiles);
    setSelectedWorkspaceProfileId("");
    setWorkspaceProfileName("");
    setWorkspaceProfileMessage(`Removed ${selectedWorkspaceProfile.label}.`);
  }

  function toPolicyProfileOptionId(value?: string, options = policyProfileOptions): string | undefined {
    if (!value) {
      return undefined;
    }
    return options.some((profile) => profile.id === value) ? value : "custom";
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Agent controls">
        <div className="brand">
          <div>
            <div className="brandName">DeepCodex</div>
            <div className="brandMeta">Agent control console</div>
          </div>
        </div>

        <section className="panel">
          <div className="panelHeading">
            <label htmlFor="workspace">Workspace</label>
            <span className="fieldStatus">{workspace.trim() ? "Set" : "Default"}</span>
          </div>
          <input
            id="workspace"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="D:\\Coding\\DeepCodex"
            spellCheck={false}
          />
          <div className="panelActions">
            <button type="button" className="secondary" onClick={loadWorkspaceConfig} disabled={configState === "loading"}>
              {configState === "loading" ? "Loading config" : "Load config"}
            </button>
            <span className={`fieldStatus ${configState}`}>{configState === "idle" ? "Optional" : configState}</span>
          </div>
          {configMessage ? <p className="fieldHelp">{configMessage}</p> : null}
        </section>

        <section className="panel">
          <div className="panelHeading">
            <label htmlFor="server-url">Server</label>
            <span className="fieldStatus">{serverStatus}</span>
          </div>
          <input
            id="server-url"
            value={serverUrlDraft}
            onChange={(event) => {
              setServerUrlDraft(event.target.value);
              setServerMessage("");
            }}
            placeholder={configuredServerUrl}
            spellCheck={false}
          />
          <div className="panelActions">
            <button type="button" className="secondary" onClick={saveServerUrl}>
              Save server
            </button>
            <span className="fieldStatus">{serverDraftChanged ? "Unsaved" : "Active"}</span>
          </div>
          {serverMessage ? <p className="fieldHelp">{serverMessage}</p> : null}
        </section>

        <section className="panel">
          <div className="panelHeading">
            <label htmlFor="workspace-profile">Workspace profile</label>
            <span className="fieldStatus">{workspaceProfiles.length} saved</span>
          </div>
          <select
            id="workspace-profile"
            value={selectedWorkspaceProfileId}
            onChange={(event) => selectWorkspaceProfile(event.target.value)}
          >
            <option value="">No saved profile</option>
            {workspaceProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
          <label className="singleField" htmlFor="workspace-profile-name">
            <span>Name</span>
            <input
              id="workspace-profile-name"
              value={workspaceProfileName}
              onChange={(event) => {
                setWorkspaceProfileName(event.target.value);
                setWorkspaceProfileMessage("");
              }}
              placeholder={workspace.trim() || "Local workspace"}
            />
          </label>
          <div className="panelActions profileActions">
            <button type="button" className="secondary" onClick={applyWorkspaceProfile} disabled={!selectedWorkspaceProfile}>
              Apply
            </button>
            <button type="button" onClick={saveWorkspaceProfile}>
              Save
            </button>
            <button type="button" className="secondary" onClick={removeWorkspaceProfile} disabled={!selectedWorkspaceProfile}>
              Remove
            </button>
          </div>
          {workspaceProfileMessage ? <p className="fieldHelp">{workspaceProfileMessage}</p> : null}
        </section>

        <section className="panel">
          <div className="panelHeading">
            <label htmlFor="policy-profile">Policy profile</label>
            <span className="fieldStatus">{selectedPolicyProfile()?.label ?? "Custom controls"}</span>
          </div>
          <select
            id="policy-profile"
            value={policyProfileId}
            onChange={(event) => applyPolicyProfile(event.target.value)}
          >
            {policyProfileOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
          <p className="fieldHelp">{selectedPolicyProfile()?.detail}</p>
        </section>

        <section className="panel">
          <div className="panelHeading">
            <label>Execution</label>
            <span className="fieldStatus">{mode}</span>
          </div>
          <div className="segmented" role="group" aria-label="Execution mode">
            {modeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`modeOption ${mode === option.value ? "active" : ""}`}
                onClick={() => setMode(option.value)}
                aria-pressed={mode === option.value}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
          <label className="singleField" htmlFor="max-steps">
            <span>Max steps</span>
            <input
              id="max-steps"
              type="number"
              min="1"
              inputMode="numeric"
              value={maxSteps}
              onChange={(event) => setMaxSteps(event.target.value)}
              placeholder="12"
            />
          </label>
          <label className="singleField" htmlFor="shell-execution-mode">
            <span>Shell execution</span>
            <select
              id="shell-execution-mode"
              value={shellExecutionMode}
              onChange={(event) => setShellExecutionMode(event.target.value as ShellExecutionMode)}
            >
              {shellExecutionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="toggleField" htmlFor="pdf-text-extraction">
            <span>PDF text extraction</span>
            <input
              id="pdf-text-extraction"
              type="checkbox"
              checked={allowPdfTextExtraction}
              onChange={(event) => setAllowPdfTextExtraction(event.target.checked)}
            />
          </label>
        </section>

        <section className="panel">
          <div className="panelHeading">
            <label>Tool approvals</label>
            <span className="fieldStatus">{approvalMode}</span>
          </div>
          <div className="segmented" role="group" aria-label="Tool approval mode">
            {approvalOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`modeOption ${approvalMode === option.value ? "active" : ""}`}
                onClick={() => setApprovalMode(option.value)}
                aria-pressed={approvalMode === option.value}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeading">
            <label>Budget</label>
            <span className="fieldStatus">{formatBudgetStatus(budgetSnapshot)}</span>
          </div>
          <div className="budgetFields">
            <label className="budgetField" htmlFor="max-session-tokens">
              <span>Token cap</span>
              <input
                id="max-session-tokens"
                type="number"
                min="0"
                inputMode="numeric"
                value={maxSessionTokens}
                onChange={(event) => setMaxSessionTokens(event.target.value)}
                placeholder="120000"
              />
            </label>
            <label className="budgetField" htmlFor="max-session-usd">
              <span>USD cap</span>
              <input
                id="max-session-usd"
                type="number"
                min="0"
                step="0.000001"
                inputMode="decimal"
                value={maxSessionUsd}
                onChange={(event) => setMaxSessionUsd(event.target.value)}
                placeholder="0.50"
              />
            </label>
            <label className="budgetField" htmlFor="input-usd-per-million-tokens">
              <span>Input USD / 1M</span>
              <input
                id="input-usd-per-million-tokens"
                type="number"
                min="0"
                step="0.000001"
                inputMode="decimal"
                value={inputUsdPerMillionTokens}
                onChange={(event) => setInputUsdPerMillionTokens(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="budgetField" htmlFor="output-usd-per-million-tokens">
              <span>Output USD / 1M</span>
              <input
                id="output-usd-per-million-tokens"
                type="number"
                min="0"
                step="0.000001"
                inputMode="decimal"
                value={outputUsdPerMillionTokens}
                onChange={(event) => setOutputUsdPerMillionTokens(event.target.value)}
                placeholder="0.00"
              />
            </label>
            {pricingProfiles.length > 0 ? (
              <label className="budgetField budgetFieldWide" htmlFor="pricing-profile">
                <span>Pricing profile</span>
                <select
                  id="pricing-profile"
                  value={pricingProfileId}
                  onChange={(event) => setPricingProfileId(event.target.value)}
                >
                  <option value="custom">Manual prices</option>
                  {pricingProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </section>

        <section className="panel metrics" aria-label="Session metrics">
          <div className="metric">
            <span>Status</span>
            <strong>{status}</strong>
          </div>
          <div className="metric">
            <span>Events</span>
            <strong>{items.length}</strong>
          </div>
          <div className="metric">
            <span>Tools</span>
            <strong>{counts.tools}</strong>
          </div>
          <div className="metric">
            <span>Tokens</span>
            <strong>{counts.tokens}</strong>
          </div>
          <div className="metric">
            <span>Budget</span>
            <strong>{formatTokenBudgetMetric(budgetSnapshot, maxSessionTokens)}</strong>
          </div>
          <div className="metric">
            <span>Cost</span>
            <strong>{formatCostMetric(budgetSnapshot)}</strong>
          </div>
          <div className="metric">
            <span>Errors</span>
            <strong>{counts.errors}</strong>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="titleBlock">
            <span className="eyebrow">Agent Session</span>
            <h1>DeepCodex Console</h1>
            <p>Plan, edit, run, and remember across local repositories.</p>
          </div>
          <div className="topActions">
            <div className={`runState ${statusTone}`} aria-live="polite">
              {status}
            </div>
            <button className="secondary" type="button" onClick={loadMemory} disabled={memoryState === "loading"}>
              {memoryState === "loading" ? "Loading memory" : "Load memory"}
            </button>
            <button className="secondary" type="button" onClick={loadSessions} disabled={sessionState === "loading"}>
              {sessionState === "loading" ? "Loading sessions" : "Load sessions"}
            </button>
          </div>
        </header>

        <section className="sessionBoard">
          <section className="streamSurface" aria-labelledby="stream-title">
            <div className="sectionHeader">
              <div>
                <span className="eyebrow">Live trace</span>
                <h2 id="stream-title">Event stream</h2>
              </div>
              <div className="streamMeta" aria-label="Event summary">
                <span>{items.length} events</span>
                <span>{counts.tools} tools</span>
                <span>{counts.tokens} tokens</span>
                <span>{counts.errors} errors</span>
                <div className="reviewSwitch" role="group" aria-label="Diff review mode">
                  <button
                    type="button"
                    className={diffViewMode === "unified" ? "active" : ""}
                    aria-pressed={diffViewMode === "unified"}
                    onClick={() => updateDiffViewMode("unified")}
                  >
                    Unified
                  </button>
                  <button
                    type="button"
                    className={diffViewMode === "split" ? "active" : ""}
                    aria-pressed={diffViewMode === "split"}
                    onClick={() => updateDiffViewMode("split")}
                  >
                    Split
                  </button>
                </div>
              </div>
            </div>

            <div className="conversation" aria-live="polite">
              {items.length === 0 ? (
                <div className="emptyState">
                  <div className="emptyText">
                    <span className="eyebrow">No events yet</span>
                    <h2>Ready for a focused repository task</h2>
                    <p>Scoped prompts, visible tool output, and final responses stay together in this workspace view.</p>
                  </div>
                  <div className="presetGrid" aria-label="Prompt presets">
                    {taskPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="presetButton"
                        onClick={() => setPrompt(preset.prompt)}
                      >
                        <span>{preset.label}</span>
                        <small>{preset.detail}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="eventList">
                  {items.map((item) => (
                    <article key={item.id} className={`event ${item.tone}`}>
                      <div className="eventHeader">
                        <div className="eventIdentity">
                          <span className="eventKind">{item.kind}</span>
                          <div className="eventTitle">{item.title}</div>
                        </div>
                        <div className="eventAside">
                          {item.meta ? <span>{item.meta}</span> : null}
                          <time>{item.timestamp}</time>
                        </div>
                      </div>
                      {item.body ? (
                        <RichTextBlockView className="eventBody" value={item.body} diffViewMode={diffViewMode} />
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="replaySurface" aria-labelledby="replay-title">
            <div className="sectionHeader">
              <div>
                <span className="eyebrow">Audit replay</span>
                <h2 id="replay-title">Session replay</h2>
              </div>
              <div className="streamMeta" aria-label="Replay summary">
                <span>{selectedSession ? selectedSession.status : replayState === "idle" ? "No session" : replayState}</span>
                <span>{selectedSession ? `${selectedSession.eventCount} events` : "0 events"}</span>
                <span>{selectedSession?.model ?? "No model"}</span>
              </div>
            </div>

            {replayState === "error" ? (
              <div className="replayEmpty">
                <span className="eyebrow">Replay error</span>
                <p>{replayError || "The selected session could not be loaded."}</p>
              </div>
            ) : selectedSession ? (
              <div className="replayLayout">
                <aside className="replaySummary" aria-label="Selected session summary">
                  <div>
                    <span className="eyebrow">Session</span>
                    <strong>{selectedSession.sessionId}</strong>
                  </div>
                  <div className="replayStats">
                    <div>
                      <span>Status</span>
                      <strong>{selectedSession.status}</strong>
                    </div>
                    <div>
                      <span>Events</span>
                      <strong>{selectedSession.eventCount}</strong>
                    </div>
                    <div>
                      <span>Tokens</span>
                      <strong>{selectedSession.tokenUsage?.totalTokens ?? 0}</strong>
                    </div>
                    <div>
                      <span>Cost</span>
                      <strong>{formatCostMetric(selectedSession.budget ?? null)}</strong>
                    </div>
                    <div>
                      <span>Created</span>
                      <strong>{formatStoredDateTime(selectedSession.createdAt)}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{formatStoredDateTime(selectedSession.updatedAt)}</strong>
                    </div>
                  </div>
                  <div className="replayWorkspace">
                    <span className="eyebrow">Workspace</span>
                    <p>{selectedSession.workspace}</p>
                  </div>
                  {selectedSession.errorMessage ? (
                    <div className="replayNote bad">
                      <span className="eyebrow">Error</span>
                      <p>{selectedSession.errorMessage}</p>
                    </div>
                  ) : selectedSession.finalContent ? (
                    <div className="replayNote">
                      <span className="eyebrow">Final</span>
                      <p>{selectedSession.finalContent}</p>
                    </div>
                  ) : null}
                </aside>
                <div className="replayTimeline" aria-label="Replay event timeline">
                  {replayItems.map((item) => (
                    <article key={item.id} className={`event ${item.tone}`}>
                      <div className="eventHeader">
                        <div className="eventIdentity">
                          <span className="eventKind">{item.kind}</span>
                          <div className="eventTitle">{item.title}</div>
                        </div>
                        <div className="eventAside">
                          {item.meta ? <span>{item.meta}</span> : null}
                          <time>{item.timestamp}</time>
                        </div>
                      </div>
                      {item.body ? (
                        <RichTextBlockView className="eventBody" value={item.body} diffViewMode={diffViewMode} />
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="replayEmpty">
                <span className="eyebrow">No replay selected</span>
                <p>Load recent sessions, then choose Replay on a session to inspect the saved audit trail.</p>
              </div>
            )}
          </section>
        </section>

        <footer className="composer">
          <div className="composerField">
            <label htmlFor="prompt">Task prompt</label>
            <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
          </div>
          <div className="composerActions">
            <div className="promptMeta">
              {prompt.trim().length} chars
              {latestItem ? ` / latest: ${latestItem.kind}` : ""}
            </div>
            <button type="button" onClick={runAgent} disabled={!canRun}>
              {isRunning ? "Running" : "Run agent"}
            </button>
          </div>
        </footer>
      </section>

      <aside className="rightRail" aria-label="Memory and final output">
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Approval queue</span>
              <h2>Pending tools</h2>
            </div>
            <span className={`outputStatus ${pendingApprovals.length > 0 ? "loading" : "idle"}`}>
              {pendingApprovals.length}
            </span>
          </div>
          <div className="approvalList">
            {pendingApprovals.length === 0 ? (
              <p className="sessionEmpty">No pending approvals.</p>
            ) : (
              pendingApprovals.map((approval) => (
                <article key={approval.approvalId} className={`approvalRow ${approval.risk}`}>
                  <div className="sessionRowHead">
                    <strong>{approval.name}</strong>
                    <span>{approval.risk}</span>
                  </div>
                  <div className="sessionRowMeta">{approval.requestedAt}</div>
                  <p className="approvalReason">{approval.reason}</p>
                  <RichTextBlockView
                    className="approvalInput"
                    value={formatApprovalDetails(approval.input, approval.fileAudits)}
                    diffViewMode={diffViewMode}
                  />
                  <div className="approvalActions">
                    <button type="button" onClick={() => resolveApproval(approval.approvalId, true)}>
                      Approve
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => resolveApproval(approval.approvalId, false)}
                    >
                      Deny
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
        <section className="railPanel finalPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Final output</span>
              <h2>Response</h2>
            </div>
            <span className={`outputStatus ${finalText ? "ready" : ""}`}>{finalText ? "Ready" : "Waiting"}</span>
          </div>
          <pre className={finalText ? "railText outputText" : "railText placeholderText"}>
            {finalText || "No final response yet."}
          </pre>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Workspace policy</span>
              <h2>Config summary</h2>
            </div>
            <span className={`outputStatus ${workspaceConfigTone}`}>{workspaceConfigStatus}</span>
          </div>
          <div className="policyBundleBody">
            <p className={configState === "error" ? "policyBundleReason bad" : "policyBundleReason"}>
              {formatWorkspaceConfigMessage(workspaceConfigResult, configMessage)}
            </p>
            {workspaceConfigResult ? (
              <dl className="policyBundleFacts">
                <div>
                  <dt>Config</dt>
                  <dd>{workspaceConfigResult.sha256 ? shortFingerprint(workspaceConfigResult.sha256) : "missing"}</dd>
                </div>
                <div>
                  <dt>Profile</dt>
                  <dd>{workspaceConfigResult.config.policyProfileId ?? "custom"}</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd>{formatProviderPolicySummary(workspaceConfigResult.config)}</dd>
                </div>
                <div>
                  <dt>Profiles</dt>
                  <dd>{workspaceConfigResult.config.policyProfiles?.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Evals</dt>
                  <dd>{workspaceConfigResult.config.evals?.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Shell</dt>
                  <dd>{formatShellPolicySummary(workspaceConfigResult.config)}</dd>
                </div>
                <div>
                  <dt>Shell rules</dt>
                  <dd>{formatShellCommandPatternSummary(workspaceConfigResult.config)}</dd>
                </div>
                <div>
                  <dt>DLP</dt>
                  <dd>{formatDlpPolicySummary(workspaceConfigResult.config)}</dd>
                </div>
                <div>
                  <dt>Artifacts</dt>
                  <dd>{formatArtifactPolicySummary(workspaceConfigResult.config)}</dd>
                </div>
                <div>
                  <dt>Retention</dt>
                  <dd>{formatRetentionPolicySummary(workspaceConfigResult.config)}</dd>
                </div>
                <div>
                  <dt>Path</dt>
                  <dd>{workspaceConfigResult.path}</dd>
                </div>
              </dl>
            ) : null}
            <button
              type="button"
              className="secondary policyBundleButton"
              onClick={loadWorkspaceConfig}
              disabled={configState === "loading"}
            >
              {configState === "loading" ? "Loading config" : "Load config"}
            </button>
          </div>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Release evidence</span>
              <h2>Readiness report</h2>
            </div>
            <span className={`outputStatus ${releaseEvidenceTone}`}>{releaseEvidenceStatus}</span>
          </div>
          <div className="releaseEvidenceBody">
            <p className={releaseEvidenceState === "error" ? "policyBundleReason bad" : "policyBundleReason"}>
              {releaseEvidenceMessage || "No release evidence loaded."}
            </p>
            {releaseEvidence ? (
              <>
                <dl className="policyBundleFacts">
                  <div>
                    <dt>Checks</dt>
                    <dd>
                      {releaseEvidence.summary.pass}/{releaseEvidence.checks.length} pass
                    </dd>
                  </div>
                  <div>
                    <dt>Evals</dt>
                    <dd>{releaseEvidence.evals.totalRuns}</dd>
                  </div>
                  <div>
                    <dt>Findings</dt>
                    <dd>{releaseEvidence.securityScan.findings.length}</dd>
                  </div>
                </dl>
                <div className="releaseCheckList">
                  {releaseEvidence.checks.map((check) => (
                    <article key={check.id} className="releaseCheck">
                      <div className="releaseCheckHeader">
                        <strong>{check.label}</strong>
                        <span className={`releaseCheckStatus ${check.status}`}>{check.status}</span>
                      </div>
                      <p>{check.detail}</p>
                    </article>
                  ))}
                </div>
                <dl className="policyBundleFacts">
                  <div>
                    <dt>Config</dt>
                    <dd>{releaseEvidence.workspaceConfig.sha256 ? shortFingerprint(releaseEvidence.workspaceConfig.sha256) : "missing"}</dd>
                  </div>
                  <div>
                    <dt>Sessions</dt>
                    <dd>{releaseEvidence.sessions.total}</dd>
                  </div>
                  <div>
                    <dt>Generated</dt>
                    <dd>{formatStoredDateTime(releaseEvidence.generatedAt)}</dd>
                  </div>
                </dl>
              </>
            ) : null}
            <div className="railButtonRow">
              <button
                type="button"
                className="secondary policyBundleButton"
                onClick={loadReleaseEvidence}
                disabled={releaseEvidenceState === "loading"}
              >
                {releaseEvidenceState === "loading" ? "Loading" : "Load evidence"}
              </button>
              <button
                type="button"
                className="secondary policyBundleButton"
                onClick={exportReleaseEvidenceMarkdown}
                disabled={releaseEvidenceExportState === "loading"}
              >
                {releaseEvidenceExportState === "loading" ? "Downloading" : "Download"}
              </button>
            </div>
          </div>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Distribution preflight</span>
              <h2>Delivery checks</h2>
            </div>
            <span className={`outputStatus ${distributionPreflightTone}`}>{distributionPreflightStatus}</span>
          </div>
          <div className="releaseEvidenceBody">
            <p className={distributionPreflightState === "error" ? "policyBundleReason bad" : "policyBundleReason"}>
              {distributionPreflightMessage || "No distribution preflight loaded."}
            </p>
            {distributionPreflight ? (
              <>
                <dl className="policyBundleFacts">
                  <div>
                    <dt>Pass</dt>
                    <dd>{distributionPreflight.summary.pass}</dd>
                  </div>
                  <div>
                    <dt>Warn</dt>
                    <dd>{distributionPreflight.summary.warn}</dd>
                  </div>
                  <div>
                    <dt>Fail</dt>
                    <dd>{distributionPreflight.summary.fail}</dd>
                  </div>
                </dl>
                <div className="releaseCheckList">
                  {distributionPreflight.checks.map((check) => (
                    <article key={check.id} className="releaseCheck">
                      <div className="releaseCheckHeader">
                        <strong>{check.label}</strong>
                        <span className={`releaseCheckStatus ${check.status}`}>{check.status}</span>
                      </div>
                      <p>
                        {check.area} / {check.detail}
                      </p>
                    </article>
                  ))}
                </div>
                <dl className="policyBundleFacts">
                  <div>
                    <dt>Root</dt>
                    <dd>{distributionPreflight.root}</dd>
                  </div>
                  <div>
                    <dt>Generated</dt>
                    <dd>{formatStoredDateTime(distributionPreflight.generatedAt)}</dd>
                  </div>
                </dl>
              </>
            ) : null}
            <div className="railButtonRow">
              <button
                type="button"
                className="secondary policyBundleButton"
                onClick={loadDistributionPreflight}
                disabled={distributionPreflightState === "loading"}
              >
                {distributionPreflightState === "loading" ? "Checking" : "Run preflight"}
              </button>
              <button
                type="button"
                className="secondary policyBundleButton"
                onClick={exportDistributionPreflightMarkdown}
                disabled={distributionPreflightExportState === "loading"}
              >
                {distributionPreflightExportState === "loading" ? "Downloading" : "Download"}
              </button>
            </div>
          </div>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Policy bundle</span>
              <h2>Config trust</h2>
            </div>
            <span className={`outputStatus ${policyBundleTone}`}>{policyBundleStatus}</span>
          </div>
          <div className="policyBundleBody">
            {policyBundle ? (
              <>
                <p className="policyBundleReason">{policyBundleMessage || policyBundle.reason}</p>
                <dl className="policyBundleFacts">
                  <div>
                    <dt>Signature</dt>
                    <dd>{policyBundle.signatureVerified ? "Verified" : "Not verified"}</dd>
                  </div>
                  <div>
                    <dt>Trust</dt>
                    <dd>{policyBundle.trusted ? "Trusted key" : "No trusted key"}</dd>
                  </div>
                  {policyBundle.issuer ? (
                    <div>
                      <dt>Issuer</dt>
                      <dd>{policyBundle.issuer}</dd>
                    </div>
                  ) : null}
                  {policyBundle.issuedAt ? (
                    <div>
                      <dt>Issued</dt>
                      <dd>{formatStoredDateTime(policyBundle.issuedAt)}</dd>
                    </div>
                  ) : null}
                  {policyBundle.expiresAt ? (
                    <div>
                      <dt>Expires</dt>
                      <dd>{formatStoredDateTime(policyBundle.expiresAt)}</dd>
                    </div>
                  ) : null}
                  {policyBundle.configSha256 ? (
                    <div>
                      <dt>Config hash</dt>
                      <dd>{shortFingerprint(policyBundle.configSha256)}</dd>
                    </div>
                  ) : null}
                  {policyBundle.bundleSha256 ? (
                    <div>
                      <dt>Bundle hash</dt>
                      <dd>{shortFingerprint(policyBundle.bundleSha256)}</dd>
                    </div>
                  ) : null}
                  {policyBundle.publicKeySha256 ? (
                    <div>
                      <dt>Key hash</dt>
                      <dd>{shortFingerprint(policyBundle.publicKeySha256)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Path</dt>
                    <dd>{policyBundle.path}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className={policyBundleMessage ? "policyBundleReason bad" : "sessionEmpty"}>
                {policyBundleMessage || "No policy bundle check loaded."}
              </p>
            )}
            <button
              type="button"
              className="secondary policyBundleButton"
              onClick={() => loadPolicyBundle()}
              disabled={policyBundleState === "loading"}
            >
              {policyBundleState === "loading" ? "Checking bundle" : "Check bundle"}
            </button>
          </div>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Security scan</span>
              <h2>DLP findings</h2>
            </div>
            <span className={`outputStatus ${securityScanTone}`}>{securityScanStatus}</span>
          </div>
          <div className="securityScanBody">
            <p className={securityScanState === "error" ? "policyBundleReason bad" : "policyBundleReason"}>
              {securityScanMessage || "No scan loaded."}
            </p>
            {securityScan ? (
              <dl className="policyBundleFacts">
                <div>
                  <dt>Scanned</dt>
                  <dd>{securityScan.scannedFiles}</dd>
                </div>
                <div>
                  <dt>Skipped</dt>
                  <dd>
                    {securityScan.skipped.denied + securityScan.skipped.oversized + securityScan.skipped.binary + securityScan.skipped.unreadable}
                  </dd>
                </div>
                <div>
                  <dt>Truncated</dt>
                  <dd>{securityScan.truncated ? "Yes" : "No"}</dd>
                </div>
              </dl>
            ) : null}
            {securityScan?.findings.length ? (
              <div className="securityFindingList">
                {securityScan.findings.slice(0, 12).map((finding, index) => (
                  <article key={`${finding.path}-${finding.line}-${finding.type}-${index}`} className="securityFinding">
                    <strong>{finding.path}</strong>
                    <span>
                      line {finding.line} / {finding.type}:{finding.label}
                    </span>
                  </article>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="secondary policyBundleButton"
              onClick={loadSecurityScan}
              disabled={securityScanState === "loading"}
            >
              {securityScanState === "loading" ? "Scanning" : "Run scan"}
            </button>
          </div>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Eval evidence</span>
              <h2>Release report</h2>
            </div>
            <span className={`outputStatus ${evalReportTone}`}>{evalReportStatus}</span>
          </div>
          <div className="evalReportBody">
            <p className={evalReportState === "error" ? "policyBundleReason bad" : "policyBundleReason"}>
              {evalReportMessage || "No eval report loaded."}
            </p>
            {evalReport ? (
              <dl className="policyBundleFacts">
                <div>
                  <dt>Runs</dt>
                  <dd>{evalReport.totalRuns}</dd>
                </div>
                <div>
                  <dt>Average</dt>
                  <dd>{formatScoreValue(evalReport.averageScore)}</dd>
                </div>
                <div>
                  <dt>Pass rate</dt>
                  <dd>{formatPercent(evalReport.passRate)}</dd>
                </div>
              </dl>
            ) : null}
            {evalReport?.byEval.length ? (
              <div className="evalTaskList">
                {evalReport.byEval.slice(0, 6).map((entry) => (
                  <article key={entry.evalId} className="evalTaskReport">
                    <div className="evalTaskHeader">
                      <strong>{entry.evalId}</strong>
                      <span>{entry.totalRuns} runs</span>
                    </div>
                    <div className="scoreMeter" aria-label={`Latest score ${formatScoreValue(entry.latestScore ?? 0)}`}>
                      <span style={{ width: formatMeterWidth(entry.latestScore ?? 0) }} />
                    </div>
                    <p>
                      latest {formatScoreValue(entry.latestScore ?? 0)} / avg {formatScoreValue(entry.averageScore)} /
                      delta {formatOptionalDelta(entry.scoreDeltaFromPrevious)}
                    </p>
                  </article>
                ))}
              </div>
            ) : null}
            {evalReport?.recentRuns.length ? (
              <div className="evalRunList">
                {evalReport.recentRuns.slice(0, 4).map((run) => (
                  <article key={run.id} className="evalRunSummary">
                    <strong>{run.evalId}</strong>
                    <span>
                      {formatStoredDateTime(run.createdAt)} / {formatEvalRunScore(run.score)}
                    </span>
                  </article>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="secondary policyBundleButton"
              onClick={loadEvalReport}
              disabled={evalReportState === "loading"}
            >
              {evalReportState === "loading" ? "Loading report" : "Load report"}
            </button>
          </div>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Workspace memory</span>
              <h2>Memory</h2>
            </div>
            <span className={`outputStatus ${memoryState}`}>{memoryLabel}</span>
          </div>
          <pre className={memory ? "railText" : "railText placeholderText"}>{memory || "No memory loaded."}</pre>
          {memoryPath ? <div className="railFoot">{memoryPath}</div> : null}
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Audit trail</span>
              <h2>Recent sessions</h2>
            </div>
            <span className={`outputStatus ${sessionState}`}>{sessionState === "idle" ? "Idle" : sessionState}</span>
          </div>
          <div className="retentionControls" aria-label="Session retention controls">
            <label className="retentionField" htmlFor="retention-max-sessions">
              <span>Max sessions</span>
              <input
                id="retention-max-sessions"
                type="number"
                min="0"
                inputMode="numeric"
                value={retentionMaxSessions}
                onChange={(event) => setRetentionMaxSessions(event.target.value)}
                placeholder="100"
              />
            </label>
            <label className="retentionField" htmlFor="retention-max-age-days">
              <span>Max age days</span>
              <input
                id="retention-max-age-days"
                type="number"
                min="0"
                step="0.25"
                inputMode="decimal"
                value={retentionMaxAgeDays}
                onChange={(event) => setRetentionMaxAgeDays(event.target.value)}
                placeholder="30"
              />
            </label>
            <div className="retentionActions">
              <button
                className="secondary"
                type="button"
                onClick={() => pruneSessions(true)}
                disabled={retentionState === "loading"}
              >
                Dry run
              </button>
              <button type="button" onClick={() => pruneSessions(false)} disabled={retentionState === "loading"}>
                Prune
              </button>
            </div>
          </div>
          <div className="sessionList">
            {sessions.length === 0 ? (
              <p className="sessionEmpty">No sessions loaded.</p>
            ) : (
              sessions.slice(0, 8).map((session) => (
                <article
                  key={session.sessionId}
                  className={`sessionRow ${session.status} ${
                    selectedSession?.sessionId === session.sessionId ? "selected" : ""
                  }`}
                >
                  <div className="sessionRowHead">
                    <strong>{session.sessionId.slice(0, 8)}</strong>
                    <span>{session.status}</span>
                  </div>
                  <div className="sessionRowMeta">
                    {session.eventCount} events / {session.tokenUsage?.totalTokens ?? 0} tokens /{" "}
                    {session.lastEventType ?? "none"}
                  </div>
                  <div className="sessionRowText">{session.errorMessage ?? session.finalContent ?? session.workspace}</div>
                  <div className="sessionRowActions">
                    <button
                      className="secondary sessionReplayButton"
                      type="button"
                      onClick={() => loadSessionReplay(session.sessionId)}
                      disabled={loadingReplaySessionId === session.sessionId}
                    >
                      {loadingReplaySessionId === session.sessionId ? "Loading replay" : "Replay"}
                    </button>
                    <button
                      className="secondary sessionReplayButton"
                      type="button"
                      onClick={() => exportSession(session.sessionId)}
                      disabled={exportingSessionId === session.sessionId}
                    >
                      {exportingSessionId === session.sessionId ? "Exporting" : "Export"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}

function createBudgetPayload(input: {
  maxSessionTokens: string;
  maxSessionUsd: string;
  inputUsdPerMillionTokens: string;
  outputUsdPerMillionTokens: string;
}): BudgetPolicy | undefined {
  const budget: BudgetPolicy = {
    maxTokens: readOptionalBudgetNumber(input.maxSessionTokens, "Token cap"),
    maxEstimatedUsd: readOptionalBudgetNumber(input.maxSessionUsd, "USD cap"),
    inputUsdPerMillionTokens: readOptionalBudgetNumber(input.inputUsdPerMillionTokens, "Input USD / 1M"),
    outputUsdPerMillionTokens: readOptionalBudgetNumber(input.outputUsdPerMillionTokens, "Output USD / 1M")
  };
  const enabled = Object.values(budget).some((value) => value !== undefined);
  if (!enabled) {
    return undefined;
  }
  if (
    budget.maxEstimatedUsd !== undefined &&
    (budget.inputUsdPerMillionTokens === undefined || budget.outputUsdPerMillionTokens === undefined)
  ) {
    throw new Error("USD cap requires both input and output token prices.");
  }
  return budget;
}

function toPolicyProfileOptions(profiles: ServerPolicyProfile[]): PolicyProfileOption[] {
  const customControl = basePolicyProfileOptions[0]!;
  return [
    customControl,
    ...profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      detail: profile.description,
      mode: profile.policy.mode,
      approvalMode: profile.approvalMode,
      maxSteps: profile.maxSteps
    }))
  ];
}

function mergePolicyProfileOptions(customProfiles: ServerPolicyProfile[] | undefined): PolicyProfileOption[] {
  if (!customProfiles || customProfiles.length === 0) {
    return basePolicyProfileOptions;
  }
  const customOptions = customProfiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    detail: profile.description,
    mode: profile.policy.mode,
    approvalMode: profile.approvalMode,
    maxSteps: profile.maxSteps
  }));
  const seen = new Set<string>();
  return [...basePolicyProfileOptions, ...customOptions].filter((profile) => {
    if (seen.has(profile.id)) {
      return false;
    }
    seen.add(profile.id);
    return true;
  });
}

function createRetentionPayload(input: {
  retentionMaxSessions: string;
  retentionMaxAgeDays: string;
}): { maxSessions?: number; maxAgeDays?: number } {
  return {
    maxSessions: readOptionalRetentionInteger(input.retentionMaxSessions, "Max sessions"),
    maxAgeDays: readOptionalBudgetNumber(input.retentionMaxAgeDays, "Max age days")
  };
}

function readOptionalBudgetNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

function readOptionalRetentionInteger(value: string, label: string): number | undefined {
  const parsed = readOptionalBudgetNumber(value, label);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be a whole number.`);
  }
  return parsed;
}

function readOptionalRunInteger(value: string, label: string): number | undefined {
  const parsed = readOptionalBudgetNumber(value, label);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
}

async function readResponseError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? fallback;
  }
  const text = await response.text();
  return text || fallback;
}

function downloadTextFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withProtocol).toString().replace(/\/+$/, "");
  } catch {
    return withProtocol.replace(/\/+$/, "");
  }
}

function formatBody(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

function readStoredWorkspaceProfiles(): WorkspaceProfile[] {
  const raw = localStorage.getItem(workspaceProfilesStorageKey);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isWorkspaceProfile).slice(0, 12);
  } catch {
    return [];
  }
}

function writeStoredWorkspaceProfiles(profiles: WorkspaceProfile[]) {
  localStorage.setItem(workspaceProfilesStorageKey, JSON.stringify(profiles.slice(0, 12)));
}

function isWorkspaceProfile(value: unknown): value is WorkspaceProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<WorkspaceProfile>;
  return (
    typeof entry.id === "string" &&
    typeof entry.label === "string" &&
    typeof entry.workspace === "string" &&
    typeof entry.serverUrl === "string" &&
    typeof entry.policyProfileId === "string" &&
    (entry.shellExecutionMode === "direct" || entry.shellExecutionMode === "workspace-copy") &&
    (entry.allowPdfTextExtraction === undefined || typeof entry.allowPdfTextExtraction === "boolean") &&
    typeof entry.maxSteps === "string" &&
    typeof entry.updatedAt === "string"
  );
}

function createWorkspaceProfileId(label: string): string {
  const slug = label
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "workspace"}-${Date.now().toString(36)}`;
}

function RichTextBlockView({
  className,
  value,
  diffViewMode
}: {
  className: string;
  value: string;
  diffViewMode: DiffViewMode;
}) {
  const blocks = parseRichTextBlocks(value);
  return (
    <div className={`${className} richTextBlock`}>
      {blocks.map((block, index) =>
        block.type === "diff" ? (
          <DiffBlockView key={`${block.header}-${index}`} block={block} viewMode={diffViewMode} />
        ) : (
          <pre key={`text-${index}`} className="richTextPlain">
            {block.value}
          </pre>
        )
      )}
    </div>
  );
}

function DiffBlockView({ block, viewMode }: { block: Extract<RichTextBlock, { type: "diff" }>; viewMode: DiffViewMode }) {
  return (
    <div className="diffBlock">
      <div className="diffHeader">{block.header}</div>
      {viewMode === "split" ? <SplitDiffRows lines={block.lines} /> : <UnifiedDiffRows lines={block.lines} />}
    </div>
  );
}

function UnifiedDiffRows({ lines }: { lines: string[] }) {
  return (
    <div className="diffRows">
      {lines.map((line, index) => {
        const kind = diffLineKind(line);
        return (
          <div key={`${index}-${line}`} className={`diffRow ${kind}`}>
            <span className="diffMarker">{diffLineMarker(line)}</span>
            <code>{diffLineText(line)}</code>
          </div>
        );
      })}
    </div>
  );
}

function SplitDiffRows({ lines }: { lines: string[] }) {
  return (
    <div className="diffSplitRows">
      <div className="diffSplitHead">
        <span>Before</span>
        <span>After</span>
      </div>
      {createSplitDiffRows(lines).map((row, index) =>
        row.type === "meta" ? (
          <div key={`meta-${index}-${row.text}`} className="diffSplitMeta">
            <code>{row.text}</code>
          </div>
        ) : (
          <div key={`pair-${index}-${row.left.text}-${row.right.text}`} className="diffSplitRow">
            <DiffSplitCell line={row.left} side="left" />
            <DiffSplitCell line={row.right} side="right" />
          </div>
        )
      )}
    </div>
  );
}

function DiffSplitCell({ line, side }: { line: SplitDiffLine; side: "left" | "right" }) {
  return (
    <div className={`diffSplitCell ${line.kind} ${side}`}>
      <span className="diffMarker">{line.marker}</span>
      <code>{line.text}</code>
    </div>
  );
}

function parseRichTextBlocks(value: string): RichTextBlock[] {
  const lines = value.split("\n");
  const blocks: RichTextBlock[] = [];
  let textLines: string[] = [];
  let index = 0;

  const flushText = () => {
    const text = trimBlockSeparators(textLines).join("\n");
    if (text) {
      blocks.push({ type: "text", value: text });
    }
    textLines = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("diff -- ")) {
      flushText();
      const diffLines = [line];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const next = lines[index + 1] ?? "";
        if (current.startsWith("diff -- ")) {
          break;
        }
        if (current === "" && !isDiffLine(next)) {
          break;
        }
        if (current.startsWith("File audit")) {
          break;
        }
        diffLines.push(current);
        index += 1;
      }
      blocks.push({ type: "diff", header: diffLines[0] ?? "diff", lines: diffLines.slice(1) });
      continue;
    }
    textLines.push(line);
    index += 1;
  }

  flushText();
  return blocks.length > 0 ? blocks : [{ type: "text", value }];
}

function trimBlockSeparators(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") {
    start += 1;
  }
  while (end > start && lines[end - 1] === "") {
    end -= 1;
  }
  return lines.slice(start, end);
}

function isDiffLine(value: string): boolean {
  return (
    value.startsWith("diff -- ") ||
    value.startsWith("--- ") ||
    value.startsWith("+++ ") ||
    value.startsWith("@@") ||
    value.startsWith("+") ||
    value.startsWith("-") ||
    value.startsWith(" ") ||
    value.startsWith("[diff ")
  );
}

function createSplitDiffRows(lines: string[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const kind = diffLineKind(line);
    if (kind === "header" || kind === "meta") {
      rows.push({ type: "meta", text: line });
      index += 1;
      continue;
    }
    if (kind === "remove") {
      const removed: string[] = [];
      const added: string[] = [];
      while (index < lines.length && diffLineKind(lines[index] ?? "") === "remove") {
        removed.push(lines[index] ?? "");
        index += 1;
      }
      while (index < lines.length && diffLineKind(lines[index] ?? "") === "add") {
        added.push(lines[index] ?? "");
        index += 1;
      }
      const count = Math.max(removed.length, added.length);
      for (let pairIndex = 0; pairIndex < count; pairIndex += 1) {
        const removedLine = removed[pairIndex];
        const addedLine = added[pairIndex];
        rows.push({
          type: "pair",
          left: removedLine ? createSplitDiffLine(removedLine, "remove") : createEmptySplitDiffLine(),
          right: addedLine ? createSplitDiffLine(addedLine, "add") : createEmptySplitDiffLine()
        });
      }
      continue;
    }
    if (kind === "add") {
      rows.push({
        type: "pair",
        left: createEmptySplitDiffLine(),
        right: createSplitDiffLine(line, "add")
      });
      index += 1;
      continue;
    }
    const context = createSplitDiffLine(line, "context");
    rows.push({ type: "pair", left: context, right: context });
    index += 1;
  }

  return rows;
}

function createSplitDiffLine(value: string, kind: SplitDiffLine["kind"]): SplitDiffLine {
  return {
    kind,
    marker: diffLineMarker(value),
    text: diffLineText(value)
  };
}

function createEmptySplitDiffLine(): SplitDiffLine {
  return { kind: "empty", marker: " ", text: "" };
}

function diffLineKind(value: string): "header" | "add" | "remove" | "context" | "meta" {
  if (value.startsWith("--- ") || value.startsWith("+++ ") || value.startsWith("@@")) {
    return "header";
  }
  if (value.startsWith("+")) {
    return "add";
  }
  if (value.startsWith("-")) {
    return "remove";
  }
  if (value.startsWith("[diff ")) {
    return "meta";
  }
  return "context";
}

function diffLineMarker(value: string): string {
  if (value.startsWith("--- ") || value.startsWith("+++ ") || value.startsWith("@@") || value.startsWith("[diff ")) {
    return " ";
  }
  if (value.startsWith("+") || value.startsWith("-") || value.startsWith(" ")) {
    return value.slice(0, 1);
  }
  return " ";
}

function diffLineText(value: string): string {
  if (value.startsWith("--- ") || value.startsWith("+++ ") || value.startsWith("@@") || value.startsWith("[diff ")) {
    return value;
  }
  if (value.startsWith("+") || value.startsWith("-") || value.startsWith(" ")) {
    return value.slice(1);
  }
  return value;
}

function formatApprovalDetails(input: unknown, fileAudits?: FileAuditEntry[]) {
  const audit = formatFileAudits(fileAudits);
  return audit ? `${formatBody(input)}\n\nFile audit\n${audit}` : formatBody(input);
}

function formatToolOutput(output: string, audit?: ToolAuditMetadata) {
  const fileAudit = formatFileAudits(audit?.files);
  const shellAudit = formatShellAudit(audit?.shell);
  return [
    output,
    fileAudit ? `File audit\n${fileAudit}` : "",
    shellAudit ? `Shell audit\n${shellAudit}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatFileAudits(fileAudits?: FileAuditEntry[]) {
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

function formatFileSnapshot(snapshot?: FileHashSnapshot) {
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

function formatShellAudit(shellAudit?: ToolAuditMetadata["shell"]) {
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

function formatBudgetStatus(budget: BudgetSnapshot | null): string {
  if (!budget) {
    return "Optional";
  }
  if (budget.maxTokens !== undefined) {
    return `${budget.remainingTokens ?? 0} tokens left`;
  }
  if (budget.maxEstimatedUsd !== undefined) {
    return `${formatUsd(budget.remainingUsd ?? 0)} left`;
  }
  return `${budget.totalTokens} tokens`;
}

function formatTokenBudgetMetric(budget: BudgetSnapshot | null, configuredMaxTokens: string): string {
  if (budget?.maxTokens !== undefined) {
    return `${budget.remainingTokens ?? 0}/${budget.maxTokens}`;
  }
  const configured = configuredMaxTokens.trim();
  return configured ? `0/${configured}` : "Off";
}

function formatCostMetric(budget: BudgetSnapshot | null): string {
  if (!budget?.estimatedUsd && budget?.estimatedUsd !== 0) {
    return "Off";
  }
  if (budget.maxEstimatedUsd !== undefined) {
    return `${formatUsd(budget.estimatedUsd)} / ${formatUsd(budget.maxEstimatedUsd)}`;
  }
  return formatUsd(budget.estimatedUsd);
}

function formatPolicyBundleStatus(
  policyBundle: PolicyBundleVerificationResult | null,
  state: LoadState
): string {
  if (state === "loading") {
    return "Checking";
  }
  if (state === "error") {
    return "Error";
  }
  if (!policyBundle) {
    return "Not checked";
  }
  if (!policyBundle.exists) {
    return "Missing";
  }
  if (policyBundle.ok) {
    return "Trusted";
  }
  if (policyBundle.signatureVerified) {
    return policyBundle.trusted ? "Failed" : "Untrusted";
  }
  return "Failed";
}

function formatSecurityScanStatus(scan: SecurityScanResult | null, state: LoadState): string {
  if (state === "loading") {
    return "Scanning";
  }
  if (state === "error") {
    return "Error";
  }
  if (!scan) {
    return "Not run";
  }
  return scan.findings.length > 0 ? `${scan.findings.length} findings` : "Clear";
}

function formatSecurityScanTone(scan: SecurityScanResult | null, state: LoadState): string {
  if (state === "loading") {
    return "loading";
  }
  if (state === "error" || (scan && scan.findings.length > 0)) {
    return "error";
  }
  if (scan) {
    return "ready";
  }
  return "idle";
}

function formatSecurityScanMessage(scan: SecurityScanResult): string {
  if (scan.findings.length === 0) {
    return `Scanned ${scan.scannedFiles} files. No probable secrets found.`;
  }
  const suffix = scan.truncated ? " Results are truncated." : "";
  return `Found ${scan.findings.length} probable secret signals in ${scan.filesWithFindings} files.${suffix}`;
}

function formatEvalReportStatus(report: EvalRunReport | null, state: LoadState): string {
  if (state === "loading") {
    return "Loading";
  }
  if (state === "error") {
    return "Error";
  }
  if (!report) {
    return "Not loaded";
  }
  return report.totalRuns > 0 ? `${report.totalRuns} runs` : "No runs";
}

function formatEvalReportTone(report: EvalRunReport | null, state: LoadState): string {
  if (state === "loading") {
    return "loading";
  }
  if (state === "error") {
    return "error";
  }
  if (!report) {
    return "idle";
  }
  if (report.totalRuns === 0) {
    return "idle";
  }
  return report.passRate < 1 ? "error" : "ready";
}

function formatEvalReportMessage(report: EvalRunReport): string {
  if (report.totalRuns === 0) {
    return "No recorded eval evidence.";
  }
  return `${report.totalRuns} recorded runs. Average score ${formatScoreValue(report.averageScore)}.`;
}

function formatReleaseEvidenceStatus(report: ReleaseEvidenceReport | null, state: LoadState): string {
  if (state === "loading") {
    return "Loading";
  }
  if (state === "error") {
    return "Error";
  }
  if (!report) {
    return "Not loaded";
  }
  if (report.summary.fail > 0) {
    return `${report.summary.fail} fail`;
  }
  if (report.summary.warn > 0) {
    return `${report.summary.warn} warn`;
  }
  return "Ready";
}

function formatReleaseEvidenceTone(report: ReleaseEvidenceReport | null, state: LoadState): string {
  if (state === "loading") {
    return "loading";
  }
  if (state === "error" || (report && report.summary.fail > 0)) {
    return "error";
  }
  if (report && report.summary.warn > 0) {
    return "loading";
  }
  if (report) {
    return "ready";
  }
  return "idle";
}

function formatReleaseEvidenceMessage(report: ReleaseEvidenceReport): string {
  return `${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failures.`;
}

function formatDistributionPreflightStatus(report: DistributionPreflightReport | null, state: LoadState): string {
  if (state === "loading") {
    return "Checking";
  }
  if (state === "error") {
    return "Error";
  }
  if (!report) {
    return "Not loaded";
  }
  if (report.summary.fail > 0) {
    return `${report.summary.fail} fail`;
  }
  if (report.summary.warn > 0) {
    return `${report.summary.warn} warn`;
  }
  return "Ready";
}

function formatDistributionPreflightTone(report: DistributionPreflightReport | null, state: LoadState): string {
  if (state === "loading") {
    return "loading";
  }
  if (state === "error" || (report && report.summary.fail > 0)) {
    return "error";
  }
  if (report && report.summary.warn > 0) {
    return "loading";
  }
  if (report) {
    return "ready";
  }
  return "idle";
}

function formatDistributionPreflightMessage(report: DistributionPreflightReport): string {
  return `${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failures.`;
}

function formatEvalRunScore(score: EvalScore): string {
  return `${score.matchedSignals.length}/${score.totalSignals} (${formatScoreValue(score.score)})`;
}

function formatScoreValue(value: number): string {
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMeterWidth(value: number): string {
  const clamped = Math.min(Math.max(value, 0), 1);
  return `${Math.round(clamped * 100)}%`;
}

function formatOptionalDelta(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function formatPolicyBundleTone(policyBundle: PolicyBundleVerificationResult | null, state: LoadState): string {
  if (state === "loading") {
    return "loading";
  }
  if (state === "error") {
    return "error";
  }
  if (policyBundle?.ok) {
    return "ready";
  }
  if (policyBundle?.exists) {
    return "error";
  }
  return "idle";
}

function formatWorkspaceConfigStatus(result: WorkspaceConfigResult | null, state: LoadState): string {
  if (state === "loading") {
    return "Loading";
  }
  if (state === "error") {
    return "Error";
  }
  if (!result) {
    return "Not loaded";
  }
  return result.exists ? "Loaded" : "Missing";
}

function formatWorkspaceConfigTone(result: WorkspaceConfigResult | null, state: LoadState): string {
  if (state === "loading") {
    return "loading";
  }
  if (state === "error") {
    return "error";
  }
  if (result?.exists) {
    return "ready";
  }
  return "idle";
}

function formatWorkspaceConfigMessage(result: WorkspaceConfigResult | null, fallback: string): string {
  if (fallback) {
    return fallback;
  }
  if (!result) {
    return "No workspace config loaded.";
  }
  return result.exists ? "Workspace policy defaults are loaded." : `No config at ${result.path}`;
}

function formatProviderPolicySummary(config: WorkspaceConfig): string {
  const baseUrls = config.provider?.allowedBaseUrls?.length ?? 0;
  const models = config.provider?.allowedModels?.length ?? 0;
  return `${baseUrls} URLs / ${models} models`;
}

function formatShellPolicySummary(config: WorkspaceConfig): string {
  const policy = config.policy ?? {};
  const network = policy.allowNetwork === true ? "network allowed" : "network blocked";
  return `${policy.shellEnvironment ?? "minimal"} / ${policy.shellExecutionMode ?? "direct"} / ${network}`;
}

function formatShellCommandPatternSummary(config: WorkspaceConfig): string {
  const policy = config.policy ?? {};
  return `${policy.allowedShellCommands?.length ?? 0} allow / ${policy.deniedShellCommands?.length ?? 0} deny`;
}

function formatDlpPolicySummary(config: WorkspaceConfig): string {
  const policy = config.policy ?? {};
  return `${policy.redactionPatterns?.length ?? 0} redact / ${policy.dlpPatterns?.length ?? 0} block`;
}

function formatArtifactPolicySummary(config: WorkspaceConfig): string {
  const policy = config.policy ?? {};
  const archive = policy.allowArchiveListing === true ? "archive allowed" : "archive blocked";
  const pdf = policy.allowPdfTextExtraction === true ? "PDF allowed" : "PDF blocked";
  return `${archive} / ${pdf}`;
}

function formatRetentionPolicySummary(config: WorkspaceConfig): string {
  const retention = config.retention;
  if (!retention) {
    return "default";
  }
  const sessions = retention.maxSessions === undefined ? "default sessions" : `${retention.maxSessions} sessions`;
  const age = retention.maxAgeDays === undefined ? "default age" : `${retention.maxAgeDays} days`;
  return `${sessions} / ${age}`;
}

function shortFingerprint(value: string): string {
  return `sha256:${value.slice(0, 12)}`;
}

function formatBudgetBody(budget: BudgetSnapshot): string {
  const lines = [
    `Prompt tokens: ${budget.promptTokens}`,
    `Completion tokens: ${budget.completionTokens}`,
    `Total tokens: ${budget.totalTokens}`
  ];
  if (budget.maxTokens !== undefined) {
    lines.push(`Token budget: ${budget.totalTokens} / ${budget.maxTokens}`);
    lines.push(`Remaining tokens: ${budget.remainingTokens ?? 0}`);
  }
  if (budget.estimatedUsd !== undefined) {
    lines.push(`Estimated cost: ${formatUsd(budget.estimatedUsd)}`);
  }
  if (budget.maxEstimatedUsd !== undefined) {
    lines.push(`Cost budget: ${formatUsd(budget.estimatedUsd ?? 0)} / ${formatUsd(budget.maxEstimatedUsd)}`);
    lines.push(`Remaining cost: ${formatUsd(budget.remainingUsd ?? 0)}`);
  }
  return lines.join("\n");
}

function formatRetentionResult(result: SessionRetentionResult) {
  const action = result.dryRun ? "Would delete" : "Deleted";
  const deleted = result.deleted.length > 0 ? result.deleted.join("\n") : "No sessions matched the retention policy.";
  return [
    `Scanned: ${result.scanned}`,
    `Retained: ${result.retained}`,
    `${action}: ${result.deleted.length}`,
    "",
    deleted
  ].join("\n");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function createLogItemFromEvent(event: AgentEvent, timestamp: string, id: string): LogItem {
  switch (event.type) {
    case "session_started":
      return {
        id,
        timestamp,
        kind: "Session",
        tone: "muted",
        title: "Session started",
        meta: `${event.sessionId.slice(0, 8)} / ${event.model}`,
        body: event.workspace
      };
    case "model_usage":
      return {
        id,
        timestamp,
        kind: "Usage",
        tone: "muted",
        title: "Model usage",
        meta: `${event.totalTokens} tokens`,
        body: `Model: ${event.model}\nPrompt tokens: ${event.promptTokens}\nCompletion tokens: ${event.completionTokens}\nTotal tokens: ${event.totalTokens}`,
        tokens: event.totalTokens
      };
    case "budget_updated":
      return {
        id,
        timestamp,
        kind: "Budget",
        tone: "muted",
        title: "Budget updated",
        meta: formatBudgetStatus(event.budget),
        body: formatBudgetBody(event.budget)
      };
    case "budget_exceeded":
      return {
        id,
        timestamp,
        kind: "Budget",
        tone: "bad",
        title: "Budget limit reached",
        meta: event.reason,
        body: `${event.message}\n\n${formatBudgetBody(event.budget)}`
      };
    case "step":
      return {
        id,
        timestamp,
        kind: "Step",
        tone: "accent",
        title: "Step in progress",
        meta: `${event.index} of ${event.maxSteps}`
      };
    case "assistant_message":
      return {
        id,
        timestamp,
        kind: "Assistant",
        tone: "plain",
        title: "Assistant message",
        meta: `${event.content.length} chars`,
        body: event.content
      };
    case "tool_approval_requested":
      return {
        id,
        timestamp,
        kind: "Approval",
        tone: "accent",
        title: event.name,
        meta: `${event.risk} / requested ${formatStoredTime(event.requestedAt)}`,
        body: `${event.reason}\n\nRequested: ${formatStoredDateTime(event.requestedAt)}\n\n${formatApprovalDetails(
          event.input,
          event.fileAudits
        )}`
      };
    case "tool_approval_resolved":
      return {
        id,
        timestamp,
        kind: "Approval",
        tone: event.approved ? "good" : "bad",
        title: event.name,
        meta: `${event.approved ? "Approved" : "Denied"} / ${event.actor ?? "unknown"} / ${event.decisionLatencyMs}ms`,
        body: `${event.reason ?? "No reason provided."}\n\nRequested: ${formatStoredDateTime(
          event.requestedAt
        )}\nResolved: ${formatStoredDateTime(event.resolvedAt)}${formatFileAudits(event.fileAudits) ? `\n\nFile audit\n${formatFileAudits(event.fileAudits)}` : ""}`
      };
    case "tool_started":
      return {
        id,
        timestamp,
        kind: "Tool",
        tone: "muted",
        title: event.name,
        meta: "Tool started",
        body: formatBody(event.input)
      };
    case "tool_finished":
      return {
        id,
        timestamp,
        kind: "Tool",
        tone: event.ok ? "good" : "bad",
        title: event.name,
        meta: event.ok ? "Tool completed" : "Tool failed",
        body: formatToolOutput(event.output, event.audit)
      };
    case "final":
      return {
        id,
        timestamp,
        kind: "Final",
        tone: "good",
        title: "Final response",
        meta: `${event.content.length} chars`,
        body: event.content
      };
    case "error":
      return {
        id,
        timestamp,
        kind: "Error",
        tone: "bad",
        title: "Error",
        meta: "Agent",
        body: event.message
      };
  }
}

function formatTimestamp() {
  return timeFormatter.format(new Date());
}

function formatStoredTime(value?: string) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date);
}

function formatStoredDateTime(value?: string) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

type RootElement = HTMLElement & { __deepcodexRoot?: Root };

const rootElement = document.getElementById("root") as RootElement;
const root = rootElement.__deepcodexRoot ?? createRoot(rootElement);
rootElement.__deepcodexRoot = root;
root.render(<App />);
