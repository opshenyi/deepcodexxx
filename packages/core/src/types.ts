export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  enum?: string[];
  additionalProperties?: boolean;
  default?: unknown;
}

export interface BudgetPolicy {
  maxTokens?: number;
  maxEstimatedUsd?: number;
  inputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens?: number;
}

export interface BudgetSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  maxTokens?: number;
  remainingTokens?: number;
  estimatedUsd?: number;
  maxEstimatedUsd?: number;
  remainingUsd?: number;
}

export type BudgetLimitReason = "tokens" | "cost";

export type AgentEvent =
  | { type: "session_started"; sessionId: string; workspace: string; model: string }
  | { type: "model_usage"; model: string; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: "budget_updated"; budget: BudgetSnapshot }
  | { type: "budget_exceeded"; reason: BudgetLimitReason; message: string; budget: BudgetSnapshot }
  | { type: "assistant_message"; content: string }
  | {
      type: "tool_approval_requested";
      approvalId: string;
      name: string;
      input: unknown;
      risk: ToolApprovalRisk;
      reason: string;
      requestedAt: string;
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
    }
  | { type: "tool_started"; name: string; input: unknown }
  | { type: "tool_finished"; name: string; output: string; ok: boolean }
  | { type: "step"; index: number; maxSteps: number }
  | { type: "final"; content: string }
  | { type: "error"; message: string };

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

export type ApprovalMode = "suggest" | "workspace-write" | "full-access";
export type ToolApprovalRisk = "workspace-write" | "shell" | "memory";

export interface ToolApprovalRequest {
  approvalId: string;
  name: string;
  input: unknown;
  risk: ToolApprovalRisk;
  reason: string;
  requestedAt: string;
}

export interface ToolApprovalDecision {
  approved: boolean;
  reason?: string;
  actor?: string;
}

export type ToolApprovalHandler = (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;

export interface ApprovalPolicy {
  mode: ApprovalMode;
  allowShell?: boolean;
  allowNetwork?: boolean;
  allowFileWrite?: boolean;
  allowStateWrite?: boolean;
  deniedPaths?: string[];
  maxFileBytes?: number;
}

export interface AgentRunOptions {
  prompt: string;
  workspace: string;
  sessionId?: string;
  maxSteps?: number;
  policy?: ApprovalPolicy;
  model?: string;
  budget?: BudgetPolicy;
  chatClient?: AgentChatClient;
  onEvent?: AgentEventHandler;
  requestToolApproval?: ToolApprovalHandler;
}

export interface AgentRunResult {
  sessionId: string;
  finalText: string;
  events: AgentEvent[];
}

export interface DeepSeekConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface DeepSeekChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface DeepSeekChoice {
  index: number;
  finish_reason?: string;
  message: ChatMessage;
}

export interface DeepSeekChatResponse {
  id: string;
  choices: DeepSeekChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface AgentChatClient {
  model: string;
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<DeepSeekChatResponse>;
}

export interface WorkspaceContext {
  root: string;
  memoryPath: string;
  policy: ApprovalPolicy;
}

export interface ToolRuntime {
  workspace: WorkspaceContext;
}

export interface ToolResult {
  ok: boolean;
  content: string;
}

export interface RuntimeTool {
  definition: ToolDefinition;
  run(input: unknown, runtime: ToolRuntime): Promise<ToolResult>;
}
