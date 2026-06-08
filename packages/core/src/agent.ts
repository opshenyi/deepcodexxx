import { randomUUID } from "node:crypto";
import { DeepSeekClient } from "./deepseek.js";
import { readWorkspaceMemory } from "./memory.js";
import { createDefaultTools } from "./tools.js";
import type { AgentEvent, AgentRunOptions, AgentRunResult, ChatMessage, RuntimeTool } from "./types.js";
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
  const client = new DeepSeekClient({ model: options.model });
  const tools = createDefaultTools();
  const events: AgentEvent[] = [];
  const emit = async (event: AgentEvent) => {
    events.push(event);
    await options.onEvent?.(event);
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

  for (let index = 1; index <= maxSteps; index += 1) {
    await emit({ type: "step", index, maxSteps });
    const response = await client.chat(messages, tools.map((tool) => tool.definition));
    const assistant = response.choices[0]?.message;
    if (!assistant) {
      throw new Error("DeepSeek returned no assistant message.");
    }

    messages.push(assistant);
    const toolCalls = assistant.tool_calls ?? [];
    const text = assistant.content ?? "";

    if (text.trim()) {
      await emit({ type: "assistant_message", content: text });
      finalText = text;
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

      await emit({ type: "tool_started", name: call.function.name, input });
      const result = tool
        ? await tool.run(input, { workspace })
        : { ok: false, content: `Unknown tool: ${call.function.name}` };
      await emit({ type: "tool_finished", name: call.function.name, output: result.content, ok: result.ok });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content
      });
    }
  }

  const content = finalText || "Reached the maximum agent step count before a final answer.";
  await emit({ type: "final", content });
  return { sessionId, finalText: content, events };
}

function findTool(tools: RuntimeTool[], name: string): RuntimeTool | undefined {
  return tools.find((tool) => tool.definition.function.name === name);
}

