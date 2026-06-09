import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDeepCodexAgent, toolApprovalRisk } from "./agent.js";
import type { AgentChatClient, AgentEvent, ChatMessage, DeepSeekChatResponse, ToolDefinition } from "./types.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("agent approval risk", () => {
  it("requires approval for mutating tools", () => {
    expect(toolApprovalRisk("write_file")).toBe("workspace-write");
    expect(toolApprovalRisk("edit_file")).toBe("workspace-write");
    expect(toolApprovalRisk("run_command")).toBe("shell");
    expect(toolApprovalRisk("append_memory")).toBe("memory");
  });

  it("does not require approval for read-only tools", () => {
    expect(toolApprovalRisk("list_files")).toBeUndefined();
    expect(toolApprovalRisk("read_file")).toBeUndefined();
    expect(toolApprovalRisk("search_files")).toBeUndefined();
    expect(toolApprovalRisk("read_memory")).toBeUndefined();
  });

  it("denies a mutating tool before it writes to disk", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const events: AgentEvent[] = [];

    await runDeepCodexAgent({
      prompt: "write a file",
      workspace: tempDir,
      chatClient: scriptedWriteClient(),
      requestToolApproval: async (request) => {
        expect(request.requestedAt).toEqual(expect.any(String));
        return { approved: false, reason: "test denial", actor: "test-suite" };
      },
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_approval_requested", requestedAt: expect.any(String) })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_approval_resolved",
        approved: false,
        reason: "test denial",
        actor: "test-suite",
        requestedAt: expect.any(String),
        resolvedAt: expect.any(String),
        decisionLatencyMs: expect.any(Number)
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_finished", name: "write_file", ok: false })
    );
    await expect(readFile(path.join(tempDir, "approval.txt"), "utf8")).rejects.toThrow();
  });

  it("executes a mutating tool after approval", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const events: AgentEvent[] = [];

    await runDeepCodexAgent({
      prompt: "write a file",
      workspace: tempDir,
      chatClient: scriptedWriteClient(),
      requestToolApproval: async () => ({ approved: true, reason: "test approval", actor: "test-suite" }),
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_approval_resolved",
        approved: true,
        reason: "test approval",
        actor: "test-suite",
        decisionLatencyMs: expect.any(Number)
      })
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_started", name: "write_file" }));
    await expect(readFile(path.join(tempDir, "approval.txt"), "utf8")).resolves.toBe("approved\n");
  });

  it("does not create workspace state during suggest-mode inspection", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));

    await runDeepCodexAgent({
      prompt: "inspect only",
      workspace: tempDir,
      policy: {
        mode: "suggest",
        allowFileWrite: false,
        allowShell: false,
        allowNetwork: false
      },
      chatClient: finalOnlyClient()
    });

    expect(existsSync(path.join(tempDir, ".deepcodex"))).toBe(false);
  });

  it("emits model usage when the chat response includes token accounting", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const events: AgentEvent[] = [];

    await runDeepCodexAgent({
      prompt: "inspect only",
      workspace: tempDir,
      chatClient: finalOnlyClient(),
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model_usage",
        model: "test-model",
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15
      })
    );
  });
});

function scriptedWriteClient(): AgentChatClient {
  let callCount = 0;
  return {
    model: "test-model",
    async chat(_messages: ChatMessage[], _tools?: ToolDefinition[]): Promise<DeepSeekChatResponse> {
      callCount += 1;
      if (callCount === 1) {
        return {
          id: "test-tool-call",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "tool-call-1",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({ path: "approval.txt", content: "approved\n" })
                    }
                  }
                ]
              }
            }
          ]
        };
      }

      return {
        id: "test-final",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "done"
            }
          }
        ]
      };
    }
  };
}

function finalOnlyClient(): AgentChatClient {
  return {
    model: "test-model",
    async chat(): Promise<DeepSeekChatResponse> {
      return {
        id: "test-final-only",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "inspection complete"
            }
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      };
    }
  };
}
