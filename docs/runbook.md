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
| `DEEPCODEX_DENIED_PATHS` | Optional. | Built-in defaults. | Comma-separated deny patterns such as `secrets,private/*.json,**/*.map`. Extends the default list. |
| `DEEPCODEX_DENIED_EXTENSIONS` | Optional. | Built-in defaults. | Comma-separated extensions such as `.pem,.sqlite`. Extends the default media/artifact extension deny list. |
| `DEEPCODEX_MAX_FILE_BYTES` | Optional. | `524288` | Maximum UTF-8 file size for read, write, edit, and search tools. Set `0` to block non-empty file content. |
| `DEEPCODEX_MAX_SESSION_TOKENS` | Optional. | Empty. | Stops a run when cumulative provider token usage reaches this limit. |
| `DEEPCODEX_MAX_SESSION_USD` | Optional. | Empty. | Stops a run when estimated provider cost reaches this USD limit. Requires both pricing variables below. |
| `DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS` | Optional. | Empty. | Input token price used for local cost estimates. Prices are external configuration, not hard-coded. |
| `DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS` | Optional. | Empty. | Output token price used for local cost estimates. Prices are external configuration, not hard-coded. |
| `DEEPCODEX_MAX_SESSIONS` | Optional. | Empty. | Default maximum retained session history files for retention pruning. |
| `DEEPCODEX_SESSION_RETENTION_DAYS` | Optional. | Empty. | Default maximum session age in days for retention pruning. |
| `DEEPCODEX_SHELL_ENV` | Optional. | `minimal` | `minimal` passes only essential process variables to shell tools; `inherit` passes the parent environment for trusted workspaces. |
| `DEEPCODEX_ALLOW_NETWORK` | Optional. | `false` | Blocks common shell network commands by default. Set `true` only for trusted package install, remote git, or network utility tasks. |
| `DEEPCODEX_POLICY_PROFILE` | Optional. | Empty/custom. | Default reusable policy profile. Supported built-ins are `inspection`, `guarded-write`, and `full-access-review`. |
| `DEEPCODEX_PRICING_PROFILES` | Optional. | Empty. | JSON array or object map of caller-managed pricing profiles. Each profile needs `id`, `label`, `inputUsdPerMillionTokens`, and `outputUsdPerMillionTokens`. |
| `DEEPCODEX_PRICING_PROFILE` | Optional. | Empty/custom. | Default pricing profile id used to fill input/output token prices for cost estimates. |
| `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY` | Optional. | Empty. | Trusted Ed25519 public key PEM used to verify `.deepcodex/policy-bundle.json`. |
| `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE` | Optional. | Empty. | Path to a trusted Ed25519 public key PEM file. Takes precedence over inline public key env. |
| `DEEPCODEX_REQUIRE_SIGNED_POLICY` | Optional. | `false` | When `true`, CLI/server agent runs require a trusted signed policy bundle before model or tool execution starts. |

## Workspace Configuration

Repository defaults can live in `.deepcodex/config.json`. This file is intended for non-secret team policy: model, provider base URL, provider/model allowlists, custom team policy profiles, default policy profile, approval mode, max steps, budget defaults, pricing profile id, file policy additions, custom redaction/DLP patterns, secret-write policy, shell environment mode, shell network access, and session retention defaults.

Create a template:

```powershell
node apps/cli/dist/index.js config init --workspace D:\Coding\DeepCodex
```

Inspect the active file:

```powershell
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
```

Example:

```json
{
  "version": 1,
  "model": "deepseek-chat",
  "provider": {
    "baseUrl": "https://api.deepseek.com",
    "allowedBaseUrls": ["https://api.deepseek.com"],
    "allowedModels": ["deepseek-chat"]
  },
  "policyProfileId": "guarded-write",
  "approvalMode": "manual",
  "maxSteps": 12,
  "pricingProfileId": "custom",
  "policyProfiles": [
    {
      "id": "team-review",
      "label": "Team review",
      "description": "Team-managed workspace-write profile with manual approvals and a tighter run budget.",
      "approvalMode": "manual",
      "maxSteps": 10,
      "policy": {
        "mode": "workspace-write",
        "allowShell": true,
        "allowFileWrite": true,
        "allowNetwork": false,
        "allowStateWrite": true,
        "allowSecretWrites": false,
        "shellEnvironment": "minimal"
      },
      "budget": {
        "maxTokens": 80000
      }
    }
  ],
  "budget": {
    "maxTokens": 120000
  },
  "policy": {
    "allowNetwork": false,
    "allowSecretWrites": false,
    "shellEnvironment": "minimal",
    "maxFileBytes": 524288,
    "deniedPaths": ["secrets"],
    "deniedFileExtensions": [".pem", ".sqlite"],
    "redactionPatterns": ["ACME_[A-Z0-9]{16,}"],
    "dlpPatterns": ["ACME_SECRET_[A-Z0-9]{16,}"]
  },
  "retention": {
    "maxSessions": 100,
    "maxAgeDays": 30
  }
}
```

Precedence is explicit request or CLI flag first, then environment variable, then workspace config, then built-in defaults. Provider allowlists are enforced after the effective base URL and model are resolved, so an environment override can still be blocked by workspace policy. Custom `policyProfiles` cannot use the reserved `custom` id or replace built-in profile ids. `redactionPatterns` entries are JavaScript regular expression sources applied globally and replaced with `[redacted-custom]`; `dlpPatterns` entries are JavaScript regular expression sources used for write-time DLP blocking. Do not put provider keys or secrets in workspace config.

The current DeepSeek client sends non-streaming chat completion requests with tool definitions, `temperature: 0.2`, `max_tokens: 4096`, and a 120 second timeout. Product events are streamed by the local DeepCodex server even though the model request itself is not streamed.

When the configured DeepSeek-compatible provider returns usage metadata, DeepCodex records prompt, completion, and total token counts in the live event stream, session history, replay view, exports, and CLI session output. Token and cost budgets are enforced from those provider usage events. A budget can prevent additional tool or model work after the configured limit is reached.

Workspace config reads include a SHA-256 fingerprint of the raw `.deepcodex/config.json` file. CLI `doctor` and Web `Load config` show a short hash, while `config show --json` and `/api/workspace-config` expose the full value for audit records.

Signed policy bundles can live at `.deepcodex/policy-bundle.json`. The bundle signs a payload containing the active config SHA-256, issuer, issue time, and optional expiry. Verify it with a trusted Ed25519 public key:

```powershell
node apps/cli/dist/index.js config verify-bundle --workspace D:\Coding\DeepCodex --public-key D:\keys\deepcodex-policy.pub.pem
```

The server exposes the same verification result at `/api/policy-bundle?workspace=<path>` using `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY` or `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE`. Set `DEEPCODEX_REQUIRE_SIGNED_POLICY=true` to require a trusted signed bundle before CLI/server agent runs start. This enforcement switch is environment-only so an unsigned workspace config cannot disable it.

Agent events are redacted for common secret patterns before they are streamed to clients or persisted in session history. The default redaction covers common `*_API_KEY`, `*_TOKEN`, `*_SECRET`, password/private-key assignments, bearer authorization headers, and common token literals. Workspaces can add project-specific regex redaction patterns in `.deepcodex/config.json`.

Write and edit tools also apply sensitive-text checks before producing diffs or writing files. Probable secrets and workspace `dlpPatterns` matches are blocked by default and reported by finding type without returning raw secret values. Set `policy.allowSecretWrites: true` only in a trusted workspace policy when a fixture or migration intentionally needs secret-like text.

## Verify Configuration

```powershell
npm run build
node apps/cli/dist/index.js doctor
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
```

Expected checks:

- `DeepSeek API key: configured` for live model runs, or `missing` for local demo mode.
- Base URL and model reflect the shell or `.env` values.
- Budget variables print when they are configured.
- Workspace config path and status print without crashing.
- Workspace config SHA-256 prints when a config file exists.
- Policy bundle status prints as missing, trusted, untrusted, or failed.
- Signed policy required prints `yes` when `DEEPCODEX_REQUIRE_SIGNED_POLICY=true`.
- Provider allowlist counts print when workspace config defines them.
- Shell network policy prints as blocked unless explicitly enabled.
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
2. Start with the `Inspection` policy profile for read-only prompts.
3. Use `Guarded write` only on a disposable branch or sample workspace.
4. Use `Load config` when the workspace has `.deepcodex/config.json`, then confirm profile, approval, max steps, budget, pricing, and retention values.
5. Keep `Tool approvals` on `Manual` when demonstrating write, shell, or memory safety gates.
6. Watch the event stream for approvals, file hash audit metadata, tool starts, tool results, errors, and final answer.
7. Use `Load memory` to show `.deepcodex/memory.md` content for the selected workspace.
8. Set a token cap or USD cap in the Budget panel when demonstrating cost controls.
9. Use `Load sessions`, then `Replay` or `Export`, to show the persisted audit timeline for a previous run.

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

List reusable policy profiles:

```powershell
node apps/cli/dist/index.js profiles list --workspace D:\Coding\DeepCodex
```

If the workspace config defines a `team-review` profile, inspect it:

```powershell
node apps/cli/dist/index.js profiles show team-review --workspace D:\Coding\DeepCodex
```

List configured pricing profiles:

```powershell
node apps/cli/dist/index.js pricing list
```

Inspect workspace defaults:

```powershell
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
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
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --profile inspection "Inspect this repository and summarize the safest next step."
```

Run a bounded write-mode task on a disposable workspace:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --approval prompt --max-steps 12 "Make a small documentation improvement and summarize the change."
```

Reusable policy profiles:

| Profile | Mode | Approval default | Intended use |
| --- | --- | --- | --- |
| `inspection` | `suggest` | `deny` | Read-only repository planning with no shell, writes, memory writes, or session state. |
| `guarded-write` | `workspace-write` | `manual` / CLI prompt | Bounded local edits with review gates for mutating tools. |
| `full-access-review` | `full-access` | `manual` / CLI prompt | Controlled demos that require full command policy but still pause for review. |

Run a shell-capable task while keeping the shell environment minimal:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --shell-env minimal "Run the relevant verification command and summarize the result."
```

Run a trusted task that needs package install or remote git access:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --approval prompt --allow-network "Install the approved dependency and run the relevant verification."
```

Run with a token budget:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest --max-session-tokens 20000 "Inspect this repository and summarize the safest next step."
```

Run with a cost budget, using caller-provided sample pricing:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest --max-session-usd 0.25 --input-usd-per-million-tokens 0.10 --output-usd-per-million-tokens 0.20 "Inspect this repository and summarize the safest next step."
```

Run with a managed pricing profile:

```powershell
$env:DEEPCODEX_PRICING_PROFILES='[{"id":"example","label":"Example pricing","inputUsdPerMillionTokens":0.10,"outputUsdPerMillionTokens":0.20}]'
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest --max-session-usd 0.25 --pricing-profile example "Inspect this repository and summarize the safest next step."
```

Approval modes:

| Mode | File writes | Shell | Intended use |
| --- | --- | --- | --- |
| `suggest` | Disabled for file write/edit tools. | Disabled. | Planning, inspection, and low-risk demos. |
| `workspace-write` | Enabled inside workspace guardrails. | Enabled, with dangerous command patterns requiring `full-access` and common network commands requiring explicit network policy. | Local development tasks on a trusted workspace. |
| `full-access` | Enabled inside workspace guardrails. | Enabled with fewer dangerous-command restrictions; common network commands still require explicit network policy. | Controlled demos only; use disposable workspaces. |

Tool approval modes:

| Mode | Behavior | Intended use |
| --- | --- | --- |
| `auto` | Mutating tool calls run after policy checks. | Fast demos in disposable workspaces. |
| `prompt` / Web `Manual` | Write, edit, shell, and memory mutation tools pause until approved or denied. | Safety-focused demos. |
| `deny` | Mutating tool calls are rejected after the approval event is recorded. | Dry runs that prove mutation cannot proceed. |

Approval audit events record request time, decision time, decision latency, and actor in the live event stream and persisted session history.

For `write_file` and `edit_file`, approval and tool result events also include file audit metadata when the path can be resolved. The approval request records the before-file SHA-256 snapshot; the tool result records before/after SHA-256 snapshots and whether the change was applied or only previewed.

The `inspect_artifact` tool is available to the agent for media or binary-adjacent files that should not be read as text. It returns metadata such as byte size, detected type, sample hash, and simple image dimensions, while omitting raw bytes, base64 data, OCR, PDF text, and archive contents. It still respects denied path patterns such as `.env` and `.deepcodex/state`.

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Web UI cannot run the agent. | Server is not listening on `17361`. | Open `/api/health` and keep `DEEPCODEX_PORT=17361`. |
| CLI stays in demo mode. | `DEEPSEEK_API_KEY` is not available to the shell. | Run `doctor` from the same shell. |
| Workspace error. | Path does not exist or is not a directory. | Pass an absolute workspace path. |
| Tool command blocked. | Approval mode is `suggest`, or a dangerous command needs `full-access`. | Rerun with the intended mode only after reviewing the command. |
| Shell command cannot find a custom environment variable. | Shell environment mode is `minimal`. | Use `--shell-env inherit` or `DEEPCODEX_SHELL_ENV=inherit` only for trusted workspaces that need parent environment variables. |
| Shell network command is blocked. | `allowNetwork` is false and the command looks like package install, remote git, or a network utility. | Use CLI `--allow-network`, `DEEPCODEX_ALLOW_NETWORK=true`, or workspace policy `allowNetwork: true` only for trusted tasks. |
| Write or edit is blocked by DLP policy. | The proposed content looks like a secret assignment, bearer token, token literal, or workspace custom DLP match. | Move the value to an environment variable or set `policy.allowSecretWrites: true` only for a trusted fixture/migration workspace. |
| A project-specific secret still appears in output. | Redaction is pattern-based. | Add the pattern to a future project DLP policy and rotate the exposed secret if necessary. |
| Agent appears paused. | Tool approvals are manual and a tool is waiting for approval. | Approve or deny the pending tool in the Web approval queue, or answer the CLI prompt. |
| Unexpected memory file appears. | Memory was loaded explicitly or the run used `workspace-write` / `full-access`. | Use `suggest` for strict inspection runs. |
| A file is denied unexpectedly. | The file matches the built-in denied list or `DEEPCODEX_DENIED_PATHS`. | Review the deny pattern before loosening it. |
| A media or artifact file is denied unexpectedly. | The file extension matches the built-in media/artifact deny list or `DEEPCODEX_DENIED_EXTENSIONS`. | Use `inspect_artifact` for metadata-only inspection, or add a future policy-controlled extraction tool for that file type. |
| A file is skipped or rejected as too large. | It exceeds `DEEPCODEX_MAX_FILE_BYTES` or the built-in 512 KiB default. | Raise the limit only for trusted workspaces and keep large generated assets out of model context. |
| Cost budget is rejected. | `DEEPCODEX_MAX_SESSION_USD` or `--max-session-usd` was set without input and output token prices. | Configure both pricing values or use a token-only budget. |
| Pricing profile is rejected. | `DEEPCODEX_PRICING_PROFILE` or `--pricing-profile` does not match a configured profile id. | Run `deepcodex pricing list` and choose one of the configured ids. |
| Provider is rejected. | `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, or workspace defaults do not match `provider.allowedBaseUrls` or `provider.allowedModels`. | Run `deepcodex doctor --workspace <path>` and update the workspace provider policy or selected model. |
| Run fails before the model call with signed policy required. | `DEEPCODEX_REQUIRE_SIGNED_POLICY=true` and the policy bundle is missing, untrusted, expired, or does not match the active config SHA-256. | Run `deepcodex config verify-bundle --workspace <path> --public-key <pem>` and fix the bundle or trusted public key. |
| Workspace config is rejected. | `.deepcodex/config.json` has invalid JSON, unsupported values, or an invalid redaction regex. | Run `deepcodex config show --workspace <path>` and fix the reported field. |
| Budget stops a run before tools execute. | The provider usage metadata reached the configured budget. | Raise the session budget or rerun a narrower prompt. |
| Session history grows too large. | Retention variables are not set and pruning has not been run. | Use Web Audit retention controls or `deepcodex sessions prune --dry-run` before applying deletion. |
