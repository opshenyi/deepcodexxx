#!/usr/bin/env node
import "dotenv/config";
import chalk from "chalk";
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createWorkspaceContext, readWorkspaceMemory, runDeepCodexAgent } from "@deepcodex/core";
import type { AgentEvent } from "@deepcodex/core";

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
  .option("--max-steps <number>", "Maximum agent loop count", "12")
  .action(async (promptParts: string[], options: { workspace: string; mode: string; maxSteps: string }) => {
    await runDeepCodexAgent({
      prompt: promptParts.join(" "),
      workspace: options.workspace,
      maxSteps: Number(options.maxSteps),
      policy: {
        mode: parseMode(options.mode),
        allowFileWrite: options.mode !== "suggest",
        allowShell: options.mode !== "suggest",
        allowNetwork: false
      },
      onEvent: printEvent
    });
  });

program
  .command("chat")
  .description("Start an interactive DeepCodex session.")
  .option("-w, --workspace <path>", "Workspace path", process.cwd())
  .option("--mode <mode>", "suggest, workspace-write, or full-access", "workspace-write")
  .action(async (options: { workspace: string; mode: string }) => {
    const rl = createInterface({ input, output });
    console.log(chalk.gray("DeepCodex interactive session. Submit an empty line to exit."));
    try {
      while (true) {
        const prompt = (await rl.question(chalk.bold("task> "))).trim();
        if (!prompt) {
          break;
        }
        await runDeepCodexAgent({
          prompt,
          workspace: options.workspace,
          maxSteps: 12,
          policy: {
            mode: parseMode(options.mode),
            allowFileWrite: options.mode !== "suggest",
            allowShell: options.mode !== "suggest",
            allowNetwork: false
          },
          onEvent: printEvent
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
