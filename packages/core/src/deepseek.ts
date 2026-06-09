import type {
  ChatMessage,
  DeepSeekChatRequest,
  DeepSeekChatResponse,
  DeepSeekConfig,
  DeepSeekReasoningEffort,
  DeepSeekThinkingType,
  ToolDefinition
} from "./types.js";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_THINKING,
  normalizeBaseUrl,
  normalizeDeepSeekThinking,
  normalizeFallbackModels,
  normalizeModel,
  normalizeOptionalReasoningEffort
} from "./provider-policy.js";

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export class DeepSeekClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly models: string[];
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly thinking: DeepSeekThinkingType;
  readonly reasoningEffort?: DeepSeekReasoningEffort;
  private readonly apiKey?: string;
  private lastModelValue: string;

  constructor(config: DeepSeekConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL);
    const primaryModel = normalizeModel(config.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL);
    this.models = [
      primaryModel,
      ...normalizeFallbackModels(
        primaryModel,
        config.fallbackModels ?? readCommaSeparatedEnv(process.env.DEEPCODEX_PROVIDER_FALLBACK_MODELS)
      )
    ];
    this.model = primaryModel;
    this.lastModelValue = this.model;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.maxRetries = config.maxRetries ?? readNonNegativeIntegerEnv("DEEPCODEX_PROVIDER_MAX_RETRIES", 2);
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? readNonNegativeNumberEnv("DEEPCODEX_PROVIDER_RETRY_BASE_MS", 500);
    this.thinking = normalizeDeepSeekThinking(
      config.thinking ?? process.env.DEEPCODEX_PROVIDER_THINKING ?? DEFAULT_DEEPSEEK_THINKING
    );
    this.reasoningEffort = normalizeOptionalReasoningEffort(
      config.reasoningEffort ?? process.env.DEEPCODEX_PROVIDER_REASONING_EFFORT
    );
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  get lastModel(): string {
    return this.lastModelValue;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[] = []): Promise<DeepSeekChatResponse> {
    this.lastModelValue = this.model;
    if (!this.apiKey) {
      return this.mockResponse(messages);
    }

    let lastError: DeepSeekError | undefined;
    const maxAttempts = this.maxRetries + 1;
    const exhaustedModels: string[] = [];
    for (const model of this.models) {
      const payload: DeepSeekChatRequest = {
        model,
        messages,
        tools,
        tool_choice: tools.length > 0 ? "auto" : "none",
        max_tokens: 4096,
        stream: false,
        thinking: { type: this.thinking },
        ...(this.thinking === "disabled" ? { temperature: 0.2 } : {}),
        ...(this.thinking === "enabled" && this.reasoningEffort
          ? { reasoning_effort: this.reasoningEffort }
          : {})
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        this.lastModelValue = model;
        try {
          return await this.sendChatRequest(payload);
        } catch (error) {
          const deepSeekError = toDeepSeekError(error);
          lastError = deepSeekError;
          if (!deepSeekError.retryable) {
            throw deepSeekError;
          }
          if (attempt < maxAttempts) {
            await delay(retryDelayMs(this.retryBaseDelayMs, attempt));
          }
        }
      }
      exhaustedModels.push(model);
    }
    const modelCount = exhaustedModels.length || this.models.length;
    const modelsText = exhaustedModels.length > 0 ? exhaustedModels.join(", ") : this.models.join(", ");
    throw new DeepSeekError(
      `DeepSeek request failed after ${maxAttempts} attempts for ${modelCount} model(s) (${modelsText}): ${
        lastError?.message ?? "unknown error"
      }`,
      lastError?.status,
      lastError?.body,
      lastError?.retryable ?? true
    );
  }

  private async sendChatRequest(payload: DeepSeekChatRequest): Promise<DeepSeekChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const body = await response.text();
      if (!response.ok) {
        throw new DeepSeekError(
          `DeepSeek request failed with ${response.status}`,
          response.status,
          body,
          isRetryableStatus(response.status)
        );
      }

      try {
        return JSON.parse(body) as DeepSeekChatResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new DeepSeekError(`DeepSeek returned invalid JSON: ${message}`, response.status, body);
      }
    } catch (error) {
      if (error instanceof DeepSeekError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new DeepSeekError(`DeepSeek request failed: ${message}`, undefined, undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }

  private mockResponse(messages: ChatMessage[]): DeepSeekChatResponse {
    const latest = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    return {
      id: `mock-${Date.now()}`,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content:
              "DeepCodex is running in local demo mode because DEEPSEEK_API_KEY is not set.\n\n" +
              "I received this task:\n\n" +
              latest +
              "\n\nSet DEEPSEEK_API_KEY and rerun the same prompt to let DeepSeek inspect, edit, and test the workspace."
          }
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }
}

function toDeepSeekError(error: unknown): DeepSeekError {
  if (error instanceof DeepSeekError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DeepSeekError(`DeepSeek request failed: ${message}`, undefined, undefined, true);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(baseDelayMs: number, failedAttempt: number): number {
  return baseDelayMs * 2 ** Math.max(0, failedAttempt - 1);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const value = readNonNegativeNumberEnv(name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readNonNegativeNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return parsed;
}

function readCommaSeparatedEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
