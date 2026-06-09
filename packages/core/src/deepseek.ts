import type {
  ChatMessage,
  DeepSeekChatRequest,
  DeepSeekChatResponse,
  DeepSeekConfig,
  ToolDefinition
} from "./types.js";
import { DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL, normalizeBaseUrl } from "./provider-policy.js";

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export class DeepSeekClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  private readonly apiKey?: string;

  constructor(config: DeepSeekConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL);
    this.model = config.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[] = []): Promise<DeepSeekChatResponse> {
    if (!this.apiKey) {
      return this.mockResponse(messages);
    }

    const payload: DeepSeekChatRequest = {
      model: this.model,
      messages,
      tools,
      tool_choice: tools.length > 0 ? "auto" : "none",
      temperature: 0.2,
      max_tokens: 4096,
      stream: false
    };

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
        throw new DeepSeekError(`DeepSeek request failed with ${response.status}`, response.status, body);
      }

      return JSON.parse(body) as DeepSeekChatResponse;
    } catch (error) {
      if (error instanceof DeepSeekError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new DeepSeekError(`DeepSeek request failed: ${message}`);
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

