import path from "node:path";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import type { AgentEvent, BudgetSnapshot, WorkspaceContext } from "./types.js";

export type SessionStatus = "running" | "completed" | "errored";
export type SessionExportFormat = "json" | "markdown";

export interface SessionEventRecord {
  sequence: number;
  timestamp: string;
  event: AgentEvent;
}

export interface TokenUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SessionHistory {
  sessionId: string;
  workspace: string;
  model?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  events: SessionEventRecord[];
  tokenUsage?: TokenUsageSummary;
  budget?: BudgetSnapshot;
  finalContent?: string;
  errorMessage?: string;
}

export interface SessionSummary {
  sessionId: string;
  workspace: string;
  model?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  lastEventType?: AgentEvent["type"];
  tokenUsage?: TokenUsageSummary;
  budget?: BudgetSnapshot;
  finalContent?: string;
  errorMessage?: string;
}

export interface SessionEventRecorder {
  record(event: AgentEvent): Promise<SessionHistory>;
}

export interface SessionRetentionPolicy {
  maxSessions?: number;
  maxAgeDays?: number;
  dryRun?: boolean;
}

export interface SessionRetentionResult {
  scanned: number;
  retained: number;
  deleted: string[];
  dryRun: boolean;
}

export class InvalidSessionIdError extends Error {
  constructor(sessionId: string) {
    super(`Invalid session id: ${sessionId}`);
    this.name = "InvalidSessionIdError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function createSessionRecorder(workspace: WorkspaceContext): SessionEventRecorder {
  let history: SessionHistory | undefined;

  return {
    async record(event: AgentEvent): Promise<SessionHistory> {
      const startedSessionId = event.type === "session_started" ? event.sessionId : undefined;
      const sessionId = history?.sessionId ?? startedSessionId;
      if (!sessionId) {
        throw new Error("Cannot record an agent event before session_started.");
      }

      history ??= await readOrCreateSessionHistory(workspace, sessionId, event);

      const timestamp = new Date().toISOString();
      history.events.push({
        sequence: history.events.length + 1,
        timestamp,
        event
      });
      applyEventMetadata(history, event);
      history.updatedAt = timestamp;
      history.eventCount = history.events.length;

      await writeSessionHistory(workspace, history);
      return history;
    }
  };
}

export async function listSessionHistories(workspace: WorkspaceContext): Promise<SessionSummary[]> {
  const directory = sessionDirectory(workspace);
  await mkdir(directory, { recursive: true });

  const entries = await readdir(directory, { withFileTypes: true });
  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry): Promise<SessionSummary | undefined> => {
        const sessionId = entry.name.slice(0, -".json".length);
        try {
          return summarizeSession(await readSessionHistory(workspace, sessionId));
        } catch {
          return undefined;
        }
      })
  );

  return sessions
    .filter((session): session is SessionSummary => Boolean(session))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function pruneSessionHistories(
  workspace: WorkspaceContext,
  policy: SessionRetentionPolicy = {}
): Promise<SessionRetentionResult> {
  const normalized = normalizeRetentionPolicy(policy);
  const directory = sessionDirectory(workspace);
  await mkdir(directory, { recursive: true });

  const entries = await readdir(directory, { withFileTypes: true });
  const sessions = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const sessionId = entry.name.slice(0, -".json".length);
          try {
            const session = await readSessionHistory(workspace, sessionId);
            return {
              sessionId,
              filePath: sessionFilePath(workspace, sessionId),
              updatedAtMs: sessionTimestampMs(session)
            };
          } catch {
            return undefined;
          }
        })
    )
  ).filter((session): session is { sessionId: string; filePath: string; updatedAtMs: number } => Boolean(session));

  const deleteIds = new Set<string>();
  if (normalized.maxAgeDays !== undefined) {
    const cutoff = Date.now() - normalized.maxAgeDays * 24 * 60 * 60 * 1000;
    for (const session of sessions) {
      if (session.updatedAtMs < cutoff) {
        deleteIds.add(session.sessionId);
      }
    }
  }

  if (normalized.maxSessions !== undefined) {
    const sorted = [...sessions].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    for (const session of sorted.slice(normalized.maxSessions)) {
      deleteIds.add(session.sessionId);
    }
  }

  const deletions = sessions.filter((session) => deleteIds.has(session.sessionId));
  if (!normalized.dryRun) {
    await Promise.all(deletions.map((session) => unlink(session.filePath)));
  }

  return {
    scanned: sessions.length,
    retained: sessions.length - deletions.length,
    deleted: deletions.map((session) => session.sessionId).sort(),
    dryRun: normalized.dryRun
  };
}

export async function readSessionHistory(workspace: WorkspaceContext, sessionId: string): Promise<SessionHistory> {
  const filePath = sessionFilePath(workspace, sessionId);
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new SessionNotFoundError(sessionId);
    }
    throw error;
  });
  return parseSessionHistory(raw, filePath);
}

export function exportSessionHistory(session: SessionHistory, format: SessionExportFormat = "markdown"): string {
  if (format === "json") {
    return `${JSON.stringify(session, null, 2)}\n`;
  }
  return renderSessionMarkdown(session);
}

export function parseSessionExportFormat(value: unknown): SessionExportFormat {
  if (value === undefined || value === null || value === "" || value === "markdown") {
    return "markdown";
  }
  if (value === "json") {
    return "json";
  }
  throw new Error("format must be markdown or json");
}

export function sessionDirectory(workspace: WorkspaceContext): string {
  return path.join(workspace.root, ".deepcodex", "state", "sessions");
}

async function readOrCreateSessionHistory(
  workspace: WorkspaceContext,
  sessionId: string,
  event: AgentEvent
): Promise<SessionHistory> {
  try {
    return await readSessionHistory(workspace, sessionId);
  } catch (error) {
    if (!(error instanceof SessionNotFoundError)) {
      throw error;
    }
  }

  const timestamp = new Date().toISOString();
  const history: SessionHistory = {
    sessionId,
    workspace: event.type === "session_started" ? event.workspace : workspace.root,
    model: event.type === "session_started" ? event.model : undefined,
    status: "running",
    createdAt: timestamp,
    updatedAt: timestamp,
    eventCount: 0,
    events: []
  };
  applyEventMetadata(history, event);
  return history;
}

async function writeSessionHistory(workspace: WorkspaceContext, history: SessionHistory): Promise<void> {
  const filePath = sessionFilePath(workspace, history.sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function sessionFilePath(workspace: WorkspaceContext, sessionId: string): string {
  assertValidSessionId(sessionId);
  return path.join(sessionDirectory(workspace), `${sessionId}.json`);
}

function assertValidSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new InvalidSessionIdError(sessionId);
  }
}

function normalizeRetentionPolicy(policy: SessionRetentionPolicy): Required<Pick<SessionRetentionPolicy, "dryRun">> &
  Omit<SessionRetentionPolicy, "dryRun"> {
  if (policy.maxSessions !== undefined && (!Number.isInteger(policy.maxSessions) || policy.maxSessions < 0)) {
    throw new Error("maxSessions must be a non-negative integer.");
  }
  if (policy.maxAgeDays !== undefined && (!Number.isFinite(policy.maxAgeDays) || policy.maxAgeDays < 0)) {
    throw new Error("maxAgeDays must be a non-negative number.");
  }
  return { ...policy, dryRun: policy.dryRun ?? false };
}

function sessionTimestampMs(session: SessionHistory): number {
  const parsed = Date.parse(session.updatedAt || session.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function applyEventMetadata(history: SessionHistory, event: AgentEvent): void {
  switch (event.type) {
    case "session_started":
      history.sessionId = event.sessionId;
      history.workspace = event.workspace;
      history.model = event.model;
      history.status = "running";
      break;
    case "model_usage":
      history.tokenUsage = addTokenUsage(history.tokenUsage, event);
      break;
    case "budget_updated":
    case "budget_exceeded":
      history.budget = event.budget;
      break;
    case "final":
      history.status = "completed";
      history.finalContent = event.content;
      break;
    case "error":
      history.status = "errored";
      history.errorMessage = event.message;
      break;
  }
}

function summarizeSession(session: SessionHistory): SessionSummary {
  const lastEvent = session.events.at(-1)?.event;
  return {
    sessionId: session.sessionId,
    workspace: session.workspace,
    model: session.model,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    eventCount: session.eventCount,
    lastEventType: lastEvent?.type,
    tokenUsage: session.tokenUsage,
    budget: session.budget,
    finalContent: session.finalContent,
    errorMessage: session.errorMessage
  };
}

function parseSessionHistory(raw: string, source: string): SessionHistory {
  const parsed = JSON.parse(raw) as Partial<SessionHistory>;
  if (!parsed.sessionId || !Array.isArray(parsed.events)) {
    throw new Error(`Invalid session history file: ${source}`);
  }

  return {
    sessionId: parsed.sessionId,
    workspace: parsed.workspace ?? "",
    model: parsed.model,
    status: parsed.status ?? "running",
    createdAt: parsed.createdAt ?? "",
    updatedAt: parsed.updatedAt ?? "",
    eventCount: parsed.events.length,
    events: parsed.events,
    tokenUsage: parsed.tokenUsage,
    budget: parsed.budget,
    finalContent: parsed.finalContent,
    errorMessage: parsed.errorMessage
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function renderSessionMarkdown(session: SessionHistory): string {
  const lines = [
    "# DeepCodex Session Export",
    "",
    `- Session: ${session.sessionId}`,
    `- Status: ${session.status}`,
    `- Workspace: ${session.workspace || "unknown"}`,
    `- Model: ${session.model ?? "unknown"}`,
    `- Created: ${session.createdAt || "unknown"}`,
    `- Updated: ${session.updatedAt || "unknown"}`,
    `- Events: ${session.eventCount}`,
    `- Tokens: ${session.tokenUsage?.totalTokens ?? 0}`,
    `- Estimated Cost: ${formatExportUsd(session.budget?.estimatedUsd)}`,
    `- Token Budget: ${formatExportBudget(session.budget?.totalTokens, session.budget?.maxTokens)}`,
    `- Cost Budget: ${formatExportBudget(session.budget?.estimatedUsd, session.budget?.maxEstimatedUsd, formatExportUsd)}`,
    ""
  ];

  if (session.finalContent) {
    lines.push("## Final Response", "", codeFence(session.finalContent), "");
  }
  if (session.errorMessage) {
    lines.push("## Error", "", codeFence(session.errorMessage), "");
  }

  lines.push("## Events", "");
  for (const record of session.events) {
    lines.push(`### ${record.sequence}. ${record.event.type}`, "", `- Timestamp: ${record.timestamp}`, `- ${eventSummary(record.event)}`);
    const details = eventDetails(record.event);
    if (details) {
      lines.push("", codeFence(details));
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function eventSummary(event: AgentEvent): string {
  switch (event.type) {
    case "session_started":
      return `Session started with ${event.model}.`;
    case "model_usage":
      return `Model usage for ${event.model}: ${event.totalTokens} tokens.`;
    case "budget_updated":
      return `Budget updated: ${event.budget.totalTokens} tokens used.`;
    case "budget_exceeded":
      return `Budget limit reached for ${event.reason}: ${event.message}`;
    case "step":
      return `Step ${event.index} of ${event.maxSteps}.`;
    case "assistant_message":
      return `Assistant message, ${event.content.length} chars.`;
    case "tool_approval_requested":
      return `Approval requested for ${event.name} (${event.risk}) at ${event.requestedAt}.`;
    case "tool_approval_resolved":
      return `Approval ${event.approved ? "approved" : "denied"} for ${event.name} by ${
        event.actor ?? "unknown"
      } in ${event.decisionLatencyMs}ms.`;
    case "tool_started":
      return `Tool started: ${event.name}.`;
    case "tool_finished":
      return `Tool ${event.ok ? "completed" : "failed"}: ${event.name}.`;
    case "final":
      return `Final response, ${event.content.length} chars.`;
    case "error":
      return `Error: ${event.message}`;
  }
}

function eventDetails(event: AgentEvent): string {
  switch (event.type) {
    case "session_started":
      return `workspace: ${event.workspace}\nmodel: ${event.model}`;
    case "model_usage":
      return `model: ${event.model}\npromptTokens: ${event.promptTokens}\ncompletionTokens: ${event.completionTokens}\ntotalTokens: ${event.totalTokens}`;
    case "budget_updated":
      return formatEventValue(event.budget);
    case "budget_exceeded":
      return `reason: ${event.reason}\nmessage: ${event.message}\nbudget:\n${formatEventValue(event.budget)}`;
    case "assistant_message":
      return event.content;
    case "tool_approval_requested":
      return withFileAudit(
        `reason: ${event.reason}\nrequestedAt: ${event.requestedAt}\ninput:\n${formatEventValue(event.input)}`,
        event.fileAudits
      );
    case "tool_approval_resolved":
      return withFileAudit(
        `approved: ${event.approved}\nreason: ${event.reason ?? "No reason provided."}\nactor: ${
        event.actor ?? "unknown"
      }\nrequestedAt: ${event.requestedAt}\nresolvedAt: ${event.resolvedAt}\ndecisionLatencyMs: ${
        event.decisionLatencyMs
      }`,
        event.fileAudits
      );
    case "tool_started":
      return formatEventValue(event.input);
    case "tool_finished":
      return event.audit?.files ? `${event.output}\n\nFile audit\n${formatEventValue(event.audit.files)}` : event.output;
    case "final":
      return event.content;
    case "error":
      return event.message;
    case "step":
      return "";
  }
}

function addTokenUsage(current: TokenUsageSummary | undefined, event: Extract<AgentEvent, { type: "model_usage" }>) {
  return {
    promptTokens: (current?.promptTokens ?? 0) + event.promptTokens,
    completionTokens: (current?.completionTokens ?? 0) + event.completionTokens,
    totalTokens: (current?.totalTokens ?? 0) + event.totalTokens
  };
}

function formatEventValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2) ?? String(value);
}

function withFileAudit(value: string, fileAudits: unknown): string {
  return fileAudits ? `${value}\n\nfileAudits:\n${formatEventValue(fileAudits)}` : value;
}

function codeFence(value: string): string {
  const content = truncateExportValue(value);
  const fence = content.includes("```") ? "````" : "```";
  return `${fence}\n${content}\n${fence}`;
}

function truncateExportValue(value: string): string {
  const limit = 8_000;
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`;
}

function formatExportBudget(
  value: number | undefined,
  limit: number | undefined,
  formatter: (input: number | undefined) => string = formatExportNumber
): string {
  if (limit === undefined) {
    return "none";
  }
  return `${formatter(value ?? 0)} / ${formatter(limit)}`;
}

function formatExportNumber(value: number | undefined): string {
  return value === undefined ? "not tracked" : String(value);
}

function formatExportUsd(value: number | undefined): string {
  return value === undefined ? "not tracked" : `$${value.toFixed(6)}`;
}
