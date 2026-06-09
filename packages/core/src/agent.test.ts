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
      expect.objectContaining({
        type: "tool_approval_requested",
        requestedAt: expect.any(String),
        fileAudits: [
          expect.objectContaining({
            path: "approval.txt",
            operation: "write",
            before: { exists: false }
          })
        ]
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_approval_resolved",
        approved: false,
        reason: "test denial",
        actor: "test-suite",
        requestedAt: expect.any(String),
        resolvedAt: expect.any(String),
        decisionLatencyMs: expect.any(Number),
        fileAudits: [
          expect.objectContaining({
            path: "approval.txt",
            operation: "write",
            before: { exists: false }
          })
        ]
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
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_finished",
        name: "write_file",
        audit: {
          files: [
            expect.objectContaining({
              path: "approval.txt",
              operation: "write",
              applied: true,
              before: { exists: false },
              after: expect.objectContaining({ exists: true, bytes: 9, sha256: expect.any(String) })
            })
          ]
        }
      })
    );
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

  it("emits usage for the chat client's last model when a fallback model responded", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const events: AgentEvent[] = [];

    await runDeepCodexAgent({
      prompt: "inspect only",
      workspace: tempDir,
      chatClient: fallbackUsageClient(),
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model_usage",
        model: "fallback-model",
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5
      })
    );
  });

  it("redacts sensitive assistant content before emitting or returning it", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const events: AgentEvent[] = [];

    const result = await runDeepCodexAgent({
      prompt: "show a secret",
      workspace: tempDir,
      chatClient: secretFinalClient(),
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(result.finalText).toContain("DEEPSEEK_API_KEY=[redacted]");
    expect(result.finalText).not.toContain("live-secret");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        content: expect.stringContaining("DEEPSEEK_API_KEY=[redacted]")
      })
    );
  });

  it("applies workspace redaction patterns to agent events and final text", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const events: AgentEvent[] = [];

    const result = await runDeepCodexAgent({
      prompt: "show a project secret",
      workspace: tempDir,
      policy: {
        mode: "workspace-write",
        redactionPatterns: ["ACME_[A-Z]{16}"]
      },
      chatClient: customSecretFinalClient(),
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(result.finalText).toContain("[redacted-custom]");
    expect(result.finalText).not.toContain("ACME_ABCDEFGHIJKLMNOP");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        content: "Project token [redacted-custom]"
      })
    );
  });

  it("stops before tool execution when the session token budget is reached", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const events: AgentEvent[] = [];

    await runDeepCodexAgent({
      prompt: "write a file",
      workspace: tempDir,
      budget: { maxTokens: 10 },
      chatClient: budgetedToolClient(),
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(events).toContainEqual(expect.objectContaining({ type: "budget_updated" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "budget_exceeded", reason: "tokens" }));
    expect(events.some((event) => event.type === "tool_started")).toBe(false);
    await expect(readFile(path.join(tempDir, "budget.txt"), "utf8")).rejects.toThrow();
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

function fallbackUsageClient(): AgentChatClient {
  return {
    model: "primary-model",
    lastModel: "fallback-model",
    async chat(): Promise<DeepSeekChatResponse> {
      return {
        id: "test-fallback-usage",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "fallback response"
            }
          }
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5
        }
      };
    }
  };
}

function secretFinalClient(): AgentChatClient {
  return {
    model: "test-model",
    async chat(): Promise<DeepSeekChatResponse> {
      return {
        id: "test-secret-final",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Do not leak DEEPSEEK_API_KEY=live-secret"
            }
          }
        ]
      };
    }
  };
}

function customSecretFinalClient(): AgentChatClient {
  return {
    model: "test-model",
    async chat(): Promise<DeepSeekChatResponse> {
      return {
        id: "test-custom-secret-final",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Project token ACME_ABCDEFGHIJKLMNOP"
            }
          }
        ]
      };
    }
  };
}

function budgetedToolClient(): AgentChatClient {
  return {
    model: "test-model",
    async chat(): Promise<DeepSeekChatResponse> {
      return {
        id: "test-budget-tool-call",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "tool-call-budget",
                  type: "function",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({ path: "budget.txt", content: "should not write\n" })
                  }
                }
              ]
            }
          }
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10
        }
      };
    }
  };
}
