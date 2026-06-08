import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  InvalidSessionIdError,
  SessionNotFoundError,
  appendWorkspaceMemory,
  createSessionRecorder,
  createWorkspaceContext,
  listSessionHistories,
  readSessionHistory,
  readWorkspaceMemory,
  runDeepCodexAgent
} from "@deepcodex/core";
import type { AgentEvent, ApprovalMode, ToolApprovalDecision, ToolApprovalRequest } from "@deepcodex/core";

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

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "DeepCodex",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
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
  pending.resolve({ approved, reason });
  res.json({ ok: true, approvalId, approved });
});

app.post("/api/agent/run", async (req, res) => {
  const body = req.body as {
    prompt?: string;
    workspace?: string;
    mode?: ApprovalMode;
    approvalMode?: RunApprovalMode;
    maxSteps?: number;
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
    const workspace = await createWorkspaceContext(readWorkspace(body.workspace));
    const recorder = createSessionRecorder(workspace);
    recordEvent = async (event: AgentEvent) => {
      try {
        await recorder.record(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to persist DeepCodex session event: ${message}`);
      }
    };

    await runDeepCodexAgent({
      prompt,
      workspace: workspace.root,
      maxSteps: body.maxSteps,
      policy: {
        mode: body.mode ?? "workspace-write",
        allowShell: body.mode !== "suggest",
        allowFileWrite: body.mode !== "suggest",
        allowNetwork: false
      },
      requestToolApproval: createToolApprovalHandler(body.approvalMode ?? "auto"),
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

type RunApprovalMode = "auto" | "manual" | "deny";

function createToolApprovalHandler(mode: RunApprovalMode) {
  if (mode === "auto") {
    return undefined;
  }

  if (mode === "deny") {
    return async (request: ToolApprovalRequest): Promise<ToolApprovalDecision> => ({
      approved: false,
      reason: `Denied by run approval mode for ${request.name}.`
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
        reason: "Approval timed out after 10 minutes."
      });
    }, 10 * 60 * 1000);

    pendingApprovals.set(request.approvalId, { request, resolve, timeout });
  });
}
