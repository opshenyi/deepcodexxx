import { randomUUID } from "node:crypto";
import {
  addModelUsageToBudget,
  createInitialBudgetSnapshot,
  evaluateBudgetLimit,
  formatBudgetSnapshot,
  isBudgetPolicyEnabled,
  normalizeBudgetPolicy
} from "./budget.js";
import { DeepSeekClient } from "./deepseek.js";
import { createApprovalFileAudits } from "./file-audit.js";
import { readWorkspaceMemory } from "./memory.js";
import { redactSensitiveText, redactSensitiveValue, type RedactionOptions } from "./redaction.js";
import { createDefaultTools } from "./tools.js";
import type { AgentEvent, AgentRunOptions, AgentRunResult, ChatMessage, RuntimeTool, ToolApprovalRisk } from "./types.js";
import { createWorkspaceContext } from "./workspace.js";

const SYSTEM_PROMPT = `You are DeepCodex, a commercial coding agent powered by DeepSeek.

Operating model:
- Inspect the repository before editing.
- Use tools for file reads, edits, search, command execution, and memory.
- Keep changes scoped and production-minded.
- Prefer exact edits over rewriting whole files.
- Run verification commands when relevant.
- Do not claim a command succeeded unless a tool result proves it.
- If an action is blocked by policy, explain the blocker and propose the next safe step.
`;

export async function runDeepCodexAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const sessionId = options.sessionId ?? randomUUID();
  const workspace = await createWorkspaceContext(options.workspace, options.policy);
  const client =
    options.chatClient ??
    new DeepSeekClient({
      baseUrl: options.baseUrl,
      model: options.model,
      fallbackModels: options.fallbackModels,
      thinking: options.thinking,
      reasoningEffort: options.reasoningEffort
    });
  const redactionOptions: RedactionOptions = { additionalPatterns: workspace.policy.redactionPatterns };
  const budgetPolicy = normalizeBudgetPolicy(options.budget);
  const budgetEnabled = isBudgetPolicyEnabled(budgetPolicy);
  let budgetSnapshot = createInitialBudgetSnapshot(budgetPolicy);
  const tools = createDefaultTools();
  const events: AgentEvent[] = [];
  const emit = async (event: AgentEvent) => {
    const redactedEvent = redactAgentEvent(event, redactionOptions);
    events.push(redactedEvent);
    await options.onEvent?.(redactedEvent);
  };

  await emit({ type: "session_started", sessionId, workspace: workspace.root, model: client.model });

  const memory = await readWorkspaceMemory(workspace);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\nWorkspace: ${workspace.root}\n\nPersistent memory:\n${memory}`
    },
    {
      role: "user",
      content: options.prompt
    }
  ];

  const maxSteps = options.maxSteps ?? 12;
  let finalText = "";
  const initialBudgetLimit = evaluateBudgetLimit(budgetSnapshot);
  if (initialBudgetLimit) {
    await emit({
      type: "budget_exceeded",
      reason: initialBudgetLimit.reason,
      message: initialBudgetLimit.message,
      budget: budgetSnapshot
    });
    const content = `${initialBudgetLimit.message} The session stopped before requesting a model response.`;
    await emit({ type: "final", content });
    return { sessionId, finalText: content, events };
  }

  for (let index = 1; index <= maxSteps; index += 1) {
    await emit({ type: "step", index, maxSteps });
    const response = await client.chat(messages, tools.map((tool) => tool.definition));
    const activeModel = client.lastModel ?? client.model;
    if (activeModel !== client.model) {
      await emit({ type: "provider_fallback", primaryModel: client.model, model: activeModel });
    }
    let usageEvent: Extract<AgentEvent, { type: "model_usage" }> | undefined;
    if (response.usage) {
      const promptTokens = response.usage.prompt_tokens ?? 0;
      const completionTokens = response.usage.completion_tokens ?? 0;
      usageEvent = {
        type: "model_usage",
        model: activeModel,
        promptTokens,
        completionTokens,
        totalTokens: response.usage.total_tokens ?? promptTokens + completionTokens
      };
      await emit(usageEvent);
      budgetSnapshot = addModelUsageToBudget(budgetSnapshot, usageEvent, budgetPolicy);
      if (budgetEnabled) {
        await emit({ type: "budget_updated", budget: budgetSnapshot });
      }
    }
    const assistant = response.choices[0]?.message;
    if (!assistant) {
      throw new Error("DeepSeek returned no assistant message.");
    }

    const text = redactSensitiveText(assistant.content ?? "", redactionOptions);
    const replayAssistant: ChatMessage = { ...assistant, content: text };
    messages.push(replayAssistant);
    const toolCalls = replayAssistant.tool_calls ?? [];

    if (text.trim()) {
      await emit({ type: "assistant_message", content: text });
      finalText = text;
    }

    const budgetLimit = evaluateBudgetLimit(budgetSnapshot);
    if (budgetLimit) {
      await emit({
        type: "budget_exceeded",
        reason: budgetLimit.reason,
        message: budgetLimit.message,
        budget: budgetSnapshot
      });
      const content =
        toolCalls.length === 0 && (finalText || text)
          ? finalText || text
          : `${budgetLimit.message} The session stopped before additional tool or model work.\n\n${formatBudgetSnapshot(
              budgetSnapshot
            )}`;
      await emit({ type: "final", content });
      return { sessionId, finalText: content, events };
    }

    if (toolCalls.length === 0) {
      await emit({ type: "final", content: finalText || text });
      return { sessionId, finalText: finalText || text, events };
    }

    for (const call of toolCalls) {
      const tool = findTool(tools, call.function.name);
      const rawInput = call.function.arguments || "{}";
      let input: unknown = rawInput;
      try {
        input = JSON.parse(rawInput);
      } catch {
        input = { raw: rawInput };
      }

      if (tool && options.requestToolApproval) {
        const risk = toolApprovalRisk(call.function.name);
        if (risk) {
          const approvalId = randomUUID();
          const reason = approvalReason(call.function.name, risk);
          const requestedAt = new Date().toISOString();
          const fileAudits = await createApprovalFileAudits(call.function.name, input, workspace);
          const approvalRequest = {
            approvalId,
            name: call.function.name,
            input: redactSensitiveValue(input, redactionOptions),
            risk,
            reason,
            requestedAt,
            fileAudits
          };
          await emit({ type: "tool_approval_requested", ...approvalRequest });
          const decision = await options.requestToolApproval(approvalRequest);
          const resolvedAt = new Date().toISOString();
          await emit({
            type: "tool_approval_resolved",
            approvalId,
            name: call.function.name,
            approved: decision.approved,
            reason: decision.reason,
            requestedAt,
            resolvedAt,
            decisionLatencyMs: Math.max(0, Date.parse(resolvedAt) - Date.parse(requestedAt)),
            actor: decision.actor ?? "approval-handler",
            fileAudits
          });

          if (!decision.approved) {
            const content = `Tool call denied by approval policy: ${decision.reason ?? "No reason provided."}`;
            await emit({ type: "tool_finished", name: call.function.name, output: content, ok: false });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content
            });
            continue;
          }
        }
      }

      await emit({ type: "tool_started", name: call.function.name, input });
      const result = tool
        ? await tool.run(input, { workspace })
        : { ok: false, content: `Unknown tool: ${call.function.name}` };
      const safeToolContent = redactSensitiveText(result.content, redactionOptions);
      await emit({
        type: "tool_finished",
        name: call.function.name,
        output: safeToolContent,
        ok: result.ok,
        audit: result.audit
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: safeToolContent
      });
    }
  }

  const content = finalText || "Reached the maximum agent step count before a final answer.";
  await emit({ type: "final", content });
  return { sessionId, finalText: content, events };
}

function redactAgentEvent(event: AgentEvent, options: RedactionOptions): AgentEvent {
  switch (event.type) {
    case "assistant_message":
    case "final":
      return { ...event, content: redactSensitiveText(event.content, options) };
    case "tool_approval_requested":
      return {
        ...event,
        input: redactSensitiveValue(event.input, options),
        reason: redactSensitiveText(event.reason, options)
      };
    case "tool_approval_resolved":
      return { ...event, reason: event.reason ? redactSensitiveText(event.reason, options) : event.reason };
    case "tool_started":
      return { ...event, input: redactSensitiveValue(event.input, options) };
    case "tool_finished":
      return { ...event, output: redactSensitiveText(event.output, options) };
    case "error":
      return { ...event, message: redactSensitiveText(event.message, options) };
    default:
      return event;
  }
}

function findTool(tools: RuntimeTool[], name: string): RuntimeTool | undefined {
  return tools.find((tool) => tool.definition.function.name === name);
}

export function toolApprovalRisk(toolName: string): ToolApprovalRisk | undefined {
  switch (toolName) {
    case "write_file":
    case "edit_file":
      return "workspace-write";
    case "run_command":
      return "shell";
    case "append_memory":
      return "memory";
    default:
      return undefined;
  }
}

function approvalReason(toolName: string, risk: ToolApprovalRisk): string {
  switch (risk) {
    case "workspace-write":
      return `${toolName} can change files in the selected workspace.`;
    case "shell":
      return `${toolName} can execute a local shell command with user privileges.`;
    case "memory":
      return `${toolName} can append persistent workspace memory.`;
  }
}
