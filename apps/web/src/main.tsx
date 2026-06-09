import React, { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./styles.css";

type ApprovalMode = "suggest" | "workspace-write" | "full-access";
type ToolApprovalMode = "auto" | "manual" | "deny";

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
    deniedPaths?: string[];
    deniedFileExtensions?: string[];
    redactionPatterns?: string[];
    dlpPatterns?: string[];
    maxFileBytes?: number;
    shellEnvironment?: "minimal" | "inherit";
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
    deniedPaths?: string[];
    deniedFileExtensions?: string[];
    redactionPatterns?: string[];
    dlpPatterns?: string[];
    maxFileBytes?: number;
    shellEnvironment?: "minimal" | "inherit";
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

type PolicyProfileOption = {
  id: string;
  label: string;
  detail: string;
  mode?: ApprovalMode;
  approvalMode?: ToolApprovalMode;
  maxSteps?: number;
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
const serverUrl = import.meta.env.VITE_DEEPCODEX_SERVER_URL ?? "http://127.0.0.1:17361";
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
  const [prompt, setPrompt] = useState("Inspect this repository and propose the safest next implementation step.");
  const [policyProfileId, setPolicyProfileId] = useState<PolicyProfileOption["id"]>(defaultPolicyProfile);
  const [mode, setMode] = useState<ApprovalMode>("workspace-write");
  const [approvalMode, setApprovalMode] = useState<ToolApprovalMode>("manual");
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
  const [configState, setConfigState] = useState<LoadState>("idle");
  const [configMessage, setConfigMessage] = useState("");
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
  const statusTone = isRunning ? "running" : finalText ? "ready" : "idle";
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
  }, []);

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

  async function loadPricingProfiles() {
    try {
      const response = await fetch(`${serverUrl}/api/pricing-profiles`);
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

  async function loadPolicyProfiles(workspaceOverride = workspace) {
    const params = new URLSearchParams();
    if (workspaceOverride) {
      params.set("workspace", workspaceOverride);
    }
    try {
      const response = await fetch(`${serverUrl}/api/policy-profiles?${params.toString()}`);
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
      if (result.exists) {
        const nextProfiles = mergePolicyProfileOptions(result.config.policyProfiles);
        setPolicyProfileOptions(nextProfiles);
        applyWorkspaceConfig(result.config, nextProfiles);
        setConfigMessage(`Loaded ${result.path}${result.sha256 ? ` sha256:${result.sha256.slice(0, 12)}` : ""}`);
      } else {
        setConfigMessage(`No config at ${result.path}`);
      }
      setConfigState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConfigMessage(message);
      setConfigState("error");
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
      const content = await response.text();
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `deepcodex-session-${sessionId}.md`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
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
                      {item.body ? <pre className="eventBody">{item.body}</pre> : null}
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
                      {item.body ? <pre className="eventBody">{item.body}</pre> : null}
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
                  <pre className="approvalInput">{formatApprovalDetails(approval.input, approval.fileAudits)}</pre>
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

function formatBody(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

function formatApprovalDetails(input: unknown, fileAudits?: FileAuditEntry[]) {
  const audit = formatFileAudits(fileAudits);
  return audit ? `${formatBody(input)}\n\nFile audit\n${audit}` : formatBody(input);
}

function formatToolOutput(output: string, audit?: ToolAuditMetadata) {
  const fileAudit = formatFileAudits(audit?.files);
  return fileAudit ? `${output}\n\nFile audit\n${fileAudit}` : output;
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
