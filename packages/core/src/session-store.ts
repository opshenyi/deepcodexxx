import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { AgentEvent, WorkspaceContext } from "./types.js";

export type SessionStatus = "running" | "completed" | "errored";

export interface SessionEventRecord {
  sequence: number;
  timestamp: string;
  event: AgentEvent;
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
  finalContent?: string;
  errorMessage?: string;
}

export interface SessionEventRecorder {
  record(event: AgentEvent): Promise<SessionHistory>;
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

function applyEventMetadata(history: SessionHistory, event: AgentEvent): void {
  switch (event.type) {
    case "session_started":
      history.sessionId = event.sessionId;
      history.workspace = event.workspace;
      history.model = event.model;
      history.status = "running";
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
    finalContent: parsed.finalContent,
    errorMessage: parsed.errorMessage
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
