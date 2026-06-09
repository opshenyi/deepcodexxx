# Runbook

This runbook covers local setup for the Web, Desktop, and CLI clients, plus the DeepSeek environment contract. Commands assume PowerShell from the repository root.

## Prerequisites

- Node.js and npm installed.
- Network access to DeepSeek for live model runs.
- A local workspace path for the agent to inspect.
- A disposable branch or sample workspace for write-mode demos.

## Install

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` or set the same values in the shell before starting the app.

## DeepSeek Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | Required for live model runs. | Empty. | If missing, DeepCodex runs in local demo mode and does not call DeepSeek. |
| `DEEPSEEK_BASE_URL` | Optional. | `https://api.deepseek.com` | The client calls `${DEEPSEEK_BASE_URL}/chat/completions`; trailing slash is stripped. |
| `DEEPSEEK_MODEL` | Optional. | `deepseek-chat` | Use a DeepSeek model compatible with the OpenAI-style chat completions API. |
| `DEEPCODEX_PORT` | Optional for server. | `17361` | Keep `17361` for the current Web client because it connects to `http://127.0.0.1:17361`. |
| `DEEPCODEX_WORKSPACE` | Optional. | Current working directory. | Used by the server and CLI when a request does not pass a workspace path. |
| `DEEPCODEX_DENIED_PATHS` | Optional. | Built-in defaults. | Comma-separated deny patterns such as `secrets,private/*.json`. Extends the default list. |
| `DEEPCODEX_MAX_FILE_BYTES` | Optional. | `524288` | Maximum UTF-8 file size for read, write, edit, and search tools. Set `0` to block non-empty file content. |
| `DEEPCODEX_MAX_SESSION_TOKENS` | Optional. | Empty. | Stops a run when cumulative provider token usage reaches this limit. |
| `DEEPCODEX_MAX_SESSION_USD` | Optional. | Empty. | Stops a run when estimated provider cost reaches this USD limit. Requires both pricing variables below. |
| `DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS` | Optional. | Empty. | Input token price used for local cost estimates. Prices are external configuration, not hard-coded. |
| `DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS` | Optional. | Empty. | Output token price used for local cost estimates. Prices are external configuration, not hard-coded. |
| `DEEPCODEX_MAX_SESSIONS` | Optional. | Empty. | Default maximum retained session history files for retention pruning. |
| `DEEPCODEX_SESSION_RETENTION_DAYS` | Optional. | Empty. | Default maximum session age in days for retention pruning. |
| `DEEPCODEX_SHELL_ENV` | Optional. | `minimal` | `minimal` passes only essential process variables to shell tools; `inherit` passes the parent environment for trusted workspaces. |

The current DeepSeek client sends non-streaming chat completion requests with tool definitions, `temperature: 0.2`, `max_tokens: 4096`, and a 120 second timeout. Product events are streamed by the local DeepCodex server even though the model request itself is not streamed.

When the configured DeepSeek-compatible provider returns usage metadata, DeepCodex records prompt, completion, and total token counts in the live event stream, session history, replay view, exports, and CLI session output. Token and cost budgets are enforced from those provider usage events. A budget can prevent additional tool or model work after the configured limit is reached.

## Verify Configuration

```powershell
npm run build
node apps/cli/dist/index.js doctor
```

Expected checks:

- `DeepSeek API key: configured` for live model runs, or `missing` for local demo mode.
- Base URL and model reflect the shell or `.env` values.
- Budget variables print when they are configured.
- Node version prints without crashing.

## Web Client

```powershell
npm run dev
```

Open `http://127.0.0.1:5173`.

Runtime endpoints:

- Web client: `http://127.0.0.1:5173`
- Local server: `http://127.0.0.1:17361`
- Health check: `http://127.0.0.1:17361/api/health`

Recommended demo flow:

1. Enter a workspace path such as `D:\Coding\DeepCodex`.
2. Start in `suggest` mode for inspection-only prompts.
3. Use `workspace-write` only on a disposable branch or sample workspace.
4. Set `Tool approvals` to `Manual` when demonstrating write, shell, or memory safety gates.
5. Watch the event stream for approvals, file hash audit metadata, tool starts, tool results, errors, and final answer.
6. Use `Load memory` to show `.deepcodex/memory.md` content for the selected workspace.
7. Set a token cap or USD cap in the Budget panel when demonstrating cost controls.
8. Use `Load sessions`, then `Replay` or `Export`, to show the persisted audit timeline for a previous run.

## Desktop Client

```powershell
npm run dev:desktop
```

The script starts the server, starts the Web client, waits for both local URLs, then launches Electron. It is the best path for showing the desktop surface during an interview, but it is still a development launch rather than a packaged installer.

Use the same workspace and approval-mode guidance as the Web client. If Electron opens before the Web UI is ready, wait for the Vite page to finish loading and retry the command after stopping the previous processes.

## CLI Client

Build first:

```powershell
npm run build
```

Configuration check:

```powershell
node apps/cli/dist/index.js doctor
```

Read workspace memory:

```powershell
node apps/cli/dist/index.js memory --workspace D:\Coding\DeepCodex
```

List persisted sessions:

```powershell
node apps/cli/dist/index.js sessions list --workspace D:\Coding\DeepCodex
```

Show one session:

```powershell
node apps/cli/dist/index.js sessions show <session-id> --workspace D:\Coding\DeepCodex
```

Export one session as Markdown:

```powershell
node apps/cli/dist/index.js sessions export <session-id> --workspace D:\Coding\DeepCodex --format markdown
```

Preview retention pruning without deleting files:

```powershell
node apps/cli/dist/index.js sessions prune --workspace D:\Coding\DeepCodex --max-sessions 100 --dry-run
```

Apply retention pruning:

```powershell
node apps/cli/dist/index.js sessions prune --workspace D:\Coding\DeepCodex --max-sessions 100 --max-age-days 30
```

Run an inspection task:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest "Inspect this repository and summarize the safest next step."
```

Run a bounded write-mode task on a disposable workspace:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --approval prompt --max-steps 12 "Make a small documentation improvement and summarize the change."
```

Run a shell-capable task while keeping the shell environment minimal:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --shell-env minimal "Run the relevant verification command and summarize the result."
```

Run with a token budget:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest --max-session-tokens 20000 "Inspect this repository and summarize the safest next step."
```

Run with a cost budget, using caller-provided sample pricing:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest --max-session-usd 0.25 --input-usd-per-million-tokens 0.10 --output-usd-per-million-tokens 0.20 "Inspect this repository and summarize the safest next step."
```

Approval modes:

| Mode | File writes | Shell | Intended use |
| --- | --- | --- | --- |
| `suggest` | Disabled for file write/edit tools. | Disabled. | Planning, inspection, and low-risk demos. |
| `workspace-write` | Enabled inside workspace guardrails. | Enabled, with dangerous command patterns requiring `full-access`. | Local development tasks on a trusted workspace. |
| `full-access` | Enabled inside workspace guardrails. | Enabled with fewer command-pattern restrictions. | Controlled demos only; use disposable workspaces. |

Tool approval modes:

| Mode | Behavior | Intended use |
| --- | --- | --- |
| `auto` | Mutating tool calls run after policy checks. | Fast demos in disposable workspaces. |
| `prompt` / Web `Manual` | Write, edit, shell, and memory mutation tools pause until approved or denied. | Safety-focused demos. |
| `deny` | Mutating tool calls are rejected after the approval event is recorded. | Dry runs that prove mutation cannot proceed. |

Approval audit events record request time, decision time, decision latency, and actor in the live event stream and persisted session history.

For `write_file` and `edit_file`, approval and tool result events also include file audit metadata when the path can be resolved. The approval request records the before-file SHA-256 snapshot; the tool result records before/after SHA-256 snapshots and whether the change was applied or only previewed.

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Web UI cannot run the agent. | Server is not listening on `17361`. | Open `/api/health` and keep `DEEPCODEX_PORT=17361`. |
| CLI stays in demo mode. | `DEEPSEEK_API_KEY` is not available to the shell. | Run `doctor` from the same shell. |
| Workspace error. | Path does not exist or is not a directory. | Pass an absolute workspace path. |
| Tool command blocked. | Approval mode is `suggest`, or a dangerous command needs `full-access`. | Rerun with the intended mode only after reviewing the command. |
| Shell command cannot find a custom environment variable. | Shell environment mode is `minimal`. | Use `--shell-env inherit` or `DEEPCODEX_SHELL_ENV=inherit` only for trusted workspaces that need parent environment variables. |
| Agent appears paused. | Tool approvals are manual and a tool is waiting for approval. | Approve or deny the pending tool in the Web approval queue, or answer the CLI prompt. |
| Unexpected memory file appears. | Memory was loaded explicitly or the run used `workspace-write` / `full-access`. | Use `suggest` for strict inspection runs. |
| A file is denied unexpectedly. | The file matches the built-in denied list or `DEEPCODEX_DENIED_PATHS`. | Review the deny pattern before loosening it. |
| A file is skipped or rejected as too large. | It exceeds `DEEPCODEX_MAX_FILE_BYTES` or the built-in 512 KiB default. | Raise the limit only for trusted workspaces and keep large generated assets out of model context. |
| Cost budget is rejected. | `DEEPCODEX_MAX_SESSION_USD` or `--max-session-usd` was set without input and output token prices. | Configure both pricing values or use a token-only budget. |
| Budget stops a run before tools execute. | The provider usage metadata reached the configured budget. | Raise the session budget or rerun a narrower prompt. |
| Session history grows too large. | Retention variables are not set and pruning has not been run. | Use Web Audit retention controls or `deepcodex sessions prune --dry-run` before applying deletion. |
