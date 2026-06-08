#!/usr/bin/env node
import "dotenv/config";
import chalk from "chalk";
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createSessionRecorder,
  createWorkspaceContext,
  exportSessionHistory,
  listSessionHistories,
  parseSessionExportFormat,
  readSessionHistory,
  readWorkspaceMemory,
  runDeepCodexAgent
} from "@deepcodex/core";
import type { AgentEvent, ApprovalPolicy, SessionEventRecorder, ToolApprovalDecision, ToolApprovalRequest } from "@deepcodex/core";

const program = new Command();

program
  .name("deepcodex")
  .description("DeepSeek-powered coding agent for local workspaces.")
  .version("0.1.0");

program
  .command("ask")
  .argument("<prompt...>", "Task for the coding agent")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--mode <mode>", "suggest, workspace-write, or full-access", "workspace-write")
  .option("--approval <mode>", "auto, prompt, or deny", "auto")
  .option("--max-steps <number>", "Maximum agent loop count", "12")
  .action(
    async (promptParts: string[], options: { workspace: string; mode: string; approval: string; maxSteps: string }) => {
      const approvalMode = parseCliApprovalMode(options.approval);
      const rl = approvalMode === "prompt" ? createInterface({ input, output }) : undefined;
      try {
        const policy = createPolicy(options.mode);
        const workspace = await createWorkspaceContext(options.workspace, policy);
        const recorder = policy.allowStateWrite === false ? undefined : createSessionRecorder(workspace);
        await runDeepCodexAgent({
          prompt: promptParts.join(" "),
          workspace: workspace.root,
          maxSteps: Number(options.maxSteps),
          policy,
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
  .option("--mode <mode>", "suggest, workspace-write, or full-access", "workspace-write")
  .option("--approval <mode>", "auto, prompt, or deny", "auto")
  .action(async (options: { workspace: string; mode: string; approval: string }) => {
    const rl = createInterface({ input, output });
    const approvalMode = parseCliApprovalMode(options.approval);
    console.log(chalk.gray("DeepCodex interactive session. Submit an empty line to exit."));
    try {
      while (true) {
        const prompt = (await rl.question(chalk.bold("task> "))).trim();
        if (!prompt) {
          break;
        }
        const policy = createPolicy(options.mode);
        const workspace = await createWorkspaceContext(options.workspace, policy);
        const recorder = policy.allowStateWrite === false ? undefined : createSessionRecorder(workspace);
        await runDeepCodexAgent({
          prompt,
          workspace: workspace.root,
          maxSteps: 12,
          policy,
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
        `${session.sessionId}  ${session.status}  ${session.eventCount} events  ${session.updatedAt}  ${session.lastEventType ?? "none"}`
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

program
  .command("doctor")
  .action(() => {
    console.log(`DeepSeek API key: ${process.env.DEEPSEEK_API_KEY ? "configured" : "missing"}`);
    console.log(`DeepSeek base URL: ${process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"}`);
    console.log(`DeepSeek model: ${process.env.DEEPSEEK_MODEL ?? "deepseek-chat"}`);
    console.log(`Node: ${process.version}`);
  });

await program.parseAsync();

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "session_started":
      console.log(chalk.gray(`session ${event.sessionId}`));
      console.log(chalk.gray(`workspace ${event.workspace}`));
      console.log(chalk.gray(`model ${event.model}`));
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
      console.log(event.ok ? chalk.green(event.output) : chalk.red(event.output));
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

function createPolicy(mode: string): ApprovalPolicy {
  return {
    mode: parseMode(mode),
    allowFileWrite: mode !== "suggest",
    allowShell: mode !== "suggest",
    allowNetwork: false,
    allowStateWrite: mode !== "suggest",
    deniedPaths: readDeniedPathsFromEnv(),
    maxFileBytes: readMaxFileBytesFromEnv()
  };
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

function readMaxFileBytesFromEnv(): number | undefined {
  const raw = process.env.DEEPCODEX_MAX_FILE_BYTES;
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

type CliApprovalMode = "auto" | "prompt" | "deny";

function parseCliApprovalMode(value: string): CliApprovalMode {
  if (value === "auto" || value === "prompt" || value === "deny") {
    return value;
  }
  throw new Error("approval must be auto, prompt, or deny");
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
    console.log(formatApprovalInput(request.input));
    const answer = (await rl.question("Approve this tool call? [y/N] ")).trim().toLowerCase();
    const approved = answer === "y" || answer === "yes";
    return {
      approved,
      reason: approved ? "Approved in CLI." : "Denied in CLI.",
      actor: "cli-prompt"
    };
  };
}

function formatApprovalInput(inputValue: unknown): string {
  if (typeof inputValue === "string") {
    return inputValue;
  }
  const serialized = JSON.stringify(inputValue, null, 2);
  return serialized ?? String(inputValue);
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
