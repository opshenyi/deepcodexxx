# DeepCodex Architecture

DeepCodex is a TypeScript monorepo with five production packages:

- `packages/core`: DeepSeek client, agent loop, tool registry, workspace safety, persistent memory.
- `apps/server`: Local HTTP and event-stream API.
- `apps/web`: Browser client with Codex-inspired agent console.
- `apps/desktop`: Electron desktop client that hosts the Web experience.
- `apps/cli`: Terminal client for direct workspace operation.

## Runtime Flow

1. A client sends a task, workspace path, and approval mode.
2. The server or CLI creates a workspace context and reads `.deepcodex/memory.md`.
3. The core agent sends system context, user task, and tool schemas to DeepSeek.
4. DeepSeek chooses tool calls or returns a final answer.
5. Tool calls execute inside the workspace guardrails.
6. Every step is emitted as an event for UI, CLI, and logs.

## Commercial Guardrails

- File and shell permissions are explicit via `suggest`, `workspace-write`, and `full-access`.
- Paths cannot escape the workspace root.
- `.git`, `node_modules`, `references/agents`, env files, and session audit state are denied by default.
- File read, write, edit, and search tools enforce a configurable 512 KiB default size limit.
- Dangerous shell commands are blocked unless `full-access` is selected.
- Missing API keys trigger demo mode instead of crashing the product.

## DeepSeek Integration

The client uses the OpenAI-compatible chat completions endpoint at `DEEPSEEK_BASE_URL`, defaulting to `https://api.deepseek.com`. The model is controlled by `DEEPSEEK_MODEL`, defaulting to `deepseek-chat` for compatibility with common DeepSeek examples.
