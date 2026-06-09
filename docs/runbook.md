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
| `DEEPSEEK_MODEL` | Optional. | `deepseek-v4-flash` | Use a DeepSeek model compatible with the OpenAI-style chat completions API. |
| `DEEPCODEX_PROVIDER_FALLBACK_MODELS` | Optional. | Empty. | Comma-separated fallback model ids. Fallback is tried only after retryable failures exhaust the retry budget for the current model. |
| `DEEPCODEX_PROVIDER_MAX_RETRIES` | Optional. | `2` | Retries retryable DeepSeek-compatible provider failures. Set `0` to disable retries. |
| `DEEPCODEX_PROVIDER_RETRY_BASE_MS` | Optional. | `500` | Exponential backoff base delay in milliseconds for provider retries. |
| `DEEPCODEX_PORT` | Optional for server. | `17361` | Port used by the local server. |
| `DEEPCODEX_CORS_ORIGINS` | Optional for server. | Empty. | Comma-separated browser origins allowed by CORS. Empty keeps permissive local-development CORS. |
| `VITE_DEEPCODEX_SERVER_URL` | Optional for Web build/dev. | `http://127.0.0.1:17361` | Default API base shown in the Web Server field; users can override it at runtime in the sidebar. |
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
| `DEEPCODEX_SHELL_EXECUTION_MODE` | Optional. | `direct` | `direct` runs shell commands in the selected workspace. `workspace-copy` runs them in a temporary copy that is removed after execution. |
| `DEEPCODEX_ALLOW_NETWORK` | Optional. | `false` | Blocks common shell network commands by default. Set `true` only for trusted package install, remote git, or network utility tasks. |
| `DEEPCODEX_ALLOW_ARCHIVE_LISTING` | Optional. | `false` | Enables ZIP-compatible archive entry metadata listing without extraction. Keep disabled unless a trusted workspace needs archive manifests. |
| `DEEPCODEX_ALLOW_PDF_TEXT_EXTRACTION` | Optional. | `false` | Enables bounded local PDF text extraction. Keep disabled unless a trusted workspace needs document text in model context. |
| `DEEPCODEX_POLICY_PROFILE` | Optional. | Empty/custom. | Default reusable policy profile. Supported built-ins are `inspection`, `guarded-write`, and `full-access-review`. |
| `DEEPCODEX_PRICING_PROFILES` | Optional. | Empty. | JSON array or object map of caller-managed pricing profiles. Each profile needs `id`, `label`, `inputUsdPerMillionTokens`, and `outputUsdPerMillionTokens`. |
| `DEEPCODEX_PRICING_PROFILE` | Optional. | Empty/custom. | Default pricing profile id used to fill input/output token prices for cost estimates. |
| `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY` | Optional. | Empty. | Trusted Ed25519 public key PEM used to verify `.deepcodex/policy-bundle.json`. |
| `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE` | Optional. | Empty. | Path to a trusted Ed25519 public key PEM file. Takes precedence over inline public key env. |
| `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILES` | Optional. | Empty. | Comma-separated trusted public key PEM files for key rotation windows. |
| `DEEPCODEX_REVOKED_POLICY_BUNDLES` | Optional. | Empty. | Comma-separated policy bundle SHA-256 hashes to reject. |
| `DEEPCODEX_REVOKED_POLICY_KEYS` | Optional. | Empty. | Comma-separated trusted public key SHA-256 hashes to reject. |
| `DEEPCODEX_POLICY_BUNDLE_TRUSTED_ISSUERS` | Optional. | Empty. | Comma-separated issuer names allowed for signed policy bundles. |
| `DEEPCODEX_REQUIRE_SIGNED_POLICY` | Optional. | `false` | When `true`, CLI/server agent runs require a trusted signed policy bundle before model or tool execution starts. |

## Workspace Configuration

Repository defaults can live in `.deepcodex/config.json`. This file is intended for non-secret team policy: model, provider base URL, provider/model allowlists, approved provider fallback models, custom team policy profiles, default policy profile, approval mode, max steps, budget defaults, pricing profile id, file policy additions, custom redaction/DLP patterns, secret-write policy, archive listing policy, PDF text extraction policy, shell environment mode, shell execution mode, shell network access, shell command allow/deny regex patterns, and session retention defaults.

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
  "model": "deepseek-v4-flash",
  "provider": {
    "baseUrl": "https://api.deepseek.com",
    "fallbackModels": [],
    "allowedBaseUrls": ["https://api.deepseek.com"],
    "allowedModels": ["deepseek-v4-flash"]
  },
  "policyProfileId": "guarded-write",
  "approvalMode": "manual",
  "maxSteps": 12,
  "pricingProfileId": "custom",
  "evals": [
    {
      "id": "workspace-release-smoke",
      "label": "Workspace release smoke",
      "description": "Team-owned read-only release evidence check for this repository.",
      "prompt": "Inspect this repository in read-only mode. Summarize release evidence, verification commands, and remaining documented risks. Do not modify files.",
      "profile": "inspection",
      "maxSteps": 6,
      "budget": {
        "maxTokens": 60000
      },
      "expectedSignals": ["release checklist", "runbook", "product readiness"]
    }
  ],
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
        "allowArchiveListing": false,
        "allowPdfTextExtraction": false,
        "shellEnvironment": "minimal",
        "shellExecutionMode": "direct",
        "deniedShellCommands": ["\\bterraform\\s+apply\\b", "\\bkubectl\\s+delete\\b"]
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
    "allowArchiveListing": false,
    "allowPdfTextExtraction": false,
    "shellEnvironment": "minimal",
    "shellExecutionMode": "direct",
    "maxFileBytes": 524288,
    "deniedPaths": ["secrets"],
    "deniedFileExtensions": [".pem", ".sqlite"],
    "redactionPatterns": ["ACME_[A-Z0-9]{16,}"],
    "dlpPatterns": ["ACME_SECRET_[A-Z0-9]{16,}"],
    "deniedShellCommands": ["\\bterraform\\s+apply\\b", "\\bkubectl\\s+delete\\b"]
  },
  "retention": {
    "maxSessions": 100,
    "maxAgeDays": 30
  }
}
```

Precedence is explicit request or CLI flag first, then environment variable, then workspace config, then built-in defaults. Provider allowlists are enforced after the effective base URL, primary model, and fallback models are resolved, so an environment override can still be blocked by workspace policy. Custom `policyProfiles` cannot use the reserved `custom` id or replace built-in profile ids. Workspace `evals` entries add repository-specific read-only smoke tasks; their ids must be unique, file-name safe, and cannot replace built-in eval ids. `redactionPatterns` entries are JavaScript regular expression sources applied globally and replaced with `[redacted-custom]`; `dlpPatterns` entries are JavaScript regular expression sources used for write-time DLP blocking. `allowedShellCommands` and `deniedShellCommands` entries are JavaScript regular expression sources applied to the raw shell command before execution; deny matches block immediately, allowlists restrict commands when non-empty, and built-in dangerous/network gates still apply after allowlist matching. Do not put provider keys or secrets in workspace config.

The current DeepSeek client sends non-streaming chat completion requests with tool definitions, `temperature: 0.2`, `max_tokens: 4096`, and a 120 second timeout. Product events are streamed by the local DeepCodex server even though the model request itself is not streamed. Provider calls retry 429, 500, 502, 503, 504, and network failures with exponential backoff; when those retryable failures exhaust the retry budget for a model, the next approved fallback model is tried and a `provider_fallback` event is streamed and persisted. 400-class request errors and invalid JSON are surfaced without retry or fallback.

As of 2026-06-09, official DeepSeek API docs list `deepseek-v4-flash` and `deepseek-v4-pro` for the OpenAI-format chat completions API, and the legacy `deepseek-chat` and `deepseek-reasoner` aliases are scheduled to stop working on 2026-07-24 15:59 UTC. DeepCodex keeps model ids configurable for migration, but new templates use V4 model ids.

DeepCodex exposes this checked model metadata through the CLI, API, and Web/Desktop right rail. The catalog is descriptive product metadata for model selection and migration review; pricing remains caller-managed configuration.

```powershell
node apps/cli/dist/index.js providers models
node apps/cli/dist/index.js providers show deepseek-v4-flash --json
Invoke-RestMethod http://127.0.0.1:17361/api/provider/models
```

When the configured DeepSeek-compatible provider returns usage metadata, DeepCodex records prompt, completion, and total token counts in the live event stream, session history, replay view, exports, and CLI session output using the actual model that responded. Token and cost budgets are enforced from those provider usage events. A budget can prevent additional tool or model work after the configured limit is reached.

Workspace config reads include a SHA-256 fingerprint of the raw `.deepcodex/config.json` file. CLI `doctor` and Web `Load config` show a short hash, while `config show --json` and `/api/workspace-config` expose the full value for audit records.

Signed policy bundles can live at `.deepcodex/policy-bundle.json`. The bundle signs a payload containing the active config SHA-256, issuer, issue time, and optional expiry. Generate an Ed25519 keypair and keep the private key outside the workspace:

```powershell
node apps/cli/dist/index.js config generate-keypair --private-key D:\keys\policy-private.pem --public-key D:\keys\policy-public.pem
```

`config generate-keypair` refuses to overwrite existing key files unless `--force` is passed and prints the public key SHA-256 for trust-policy records. Sign the active workspace config with the private key:

```powershell
node apps/cli/dist/index.js config sign-bundle --workspace D:\Coding\DeepCodex --private-key D:\keys\policy-private.pem --issuer "Security Team" --expires-at 2026-12-31T23:59:59.000Z
```

`config sign-bundle` refuses to overwrite an existing bundle unless `--force` is passed. `--embed-public-key` or `--public-key <path>` can include public-key metadata in the bundle for audit convenience, but embedded keys are not trusted for signed-only enforcement. Verify the bundle with a trusted Ed25519 public key:

```powershell
node apps/cli/dist/index.js config verify-bundle --workspace D:\Coding\DeepCodex --public-key D:\keys\old-policy.pub.pem D:\keys\new-policy.pub.pem
```

Export a trust package for local/CI rollout without private keys:

```powershell
node apps/cli/dist/index.js config export-trust-package --workspace D:\Coding\DeepCodex --public-key D:\keys\policy-public.pem --trusted-issuer "Security Team" --require-signed-policy --output D:\keys\deepcodex-policy-trust.json --env-output D:\keys\deepcodex-policy-trust.env
```

The trust package contains public key PEM data, public key SHA-256 fingerprints, bundle/config fingerprints, issuer and revocation policy, signed-only recommendation, and the current verification result. The env fragment contains local/CI variables such as `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILES`, `DEEPCODEX_REQUIRE_SIGNED_POLICY`, and trusted issuer or revocation lists. It never includes signing private keys.

The server exposes the same verification result at `/api/policy-bundle?workspace=<path>` using `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY`, `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE`, or `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILES`. Use `DEEPCODEX_REVOKED_POLICY_BUNDLES`, `DEEPCODEX_REVOKED_POLICY_KEYS`, and `DEEPCODEX_POLICY_BUNDLE_TRUSTED_ISSUERS` to narrow the trust policy during rotation or incident response. Set `DEEPCODEX_REQUIRE_SIGNED_POLICY=true` to require a trusted signed bundle before CLI/server agent runs start. This enforcement switch is environment-only so an unsigned workspace config cannot disable it. Do not put signing private keys in `.deepcodex/config.json`, `.env`, repository files, session memory, or session history.

The Web and Desktop clients include a Policy bundle panel in the right rail. `Load config` refreshes that panel for the selected workspace, and `Check bundle` can refresh it independently. The panel displays the server verification result only; key generation and signing stay in the CLI so private signing keys do not enter the browser runtime.

Agent events are redacted for common secret patterns before they are streamed to clients or persisted in session history. The default redaction covers common `*_API_KEY`, `*_TOKEN`, `*_SECRET`, password/private-key assignments, bearer authorization headers, and common token literals. Workspaces can add project-specific regex redaction patterns in `.deepcodex/config.json`.

Write and edit tools also apply sensitive-text checks before producing diffs or writing files. Probable secrets and workspace `dlpPatterns` matches are blocked by default and reported by finding type without returning raw secret values. Set `policy.allowSecretWrites: true` only in a trusted workspace policy when a fixture or migration intentionally needs secret-like text.

The same sensitive-text detector can run as a read-only workspace security scan from CLI or Web/Desktop. The scan respects denied paths, denied extensions, binary detection, `maxFileBytes`, and workspace `dlpPatterns`, and reports only file path, line number, finding type, and label. It does not return the matched secret value or line text.

ZIP-compatible archive listing is disabled by default. When `policy.allowArchiveListing: true`, `DEEPCODEX_ALLOW_ARCHIVE_LISTING=true`, or CLI `--allow-archive-listing` is set, the agent can call `list_archive_entries` to read the ZIP central directory and return bounded entry metadata. It does not extract files, decompress data, return entry contents, return archive comments, or bypass denied workspace paths. Entries matching denied path policy are omitted from the manifest.

PDF text extraction is disabled by default. When `policy.allowPdfTextExtraction: true`, `DEEPCODEX_ALLOW_PDF_TEXT_EXTRACTION=true`, Web `PDF text extraction`, or CLI `--allow-pdf-text-extraction` is set, the agent can call `extract_pdf_text` to read bounded text from a local PDF. It respects denied paths and `maxFileBytes`, requires a PDF header, caps pages and returned characters, and does not return raw bytes, base64 data, images, attachments, or embedded files.

Shell execution defaults to `direct` for compatibility. Set `policy.shellExecutionMode: "workspace-copy"`, `DEEPCODEX_SHELL_EXECUTION_MODE=workspace-copy`, or CLI `--shell-execution-mode workspace-copy` to run shell commands from a temporary workspace snapshot. The snapshot skips denied paths, denied file extensions, symlinks, files above `maxFileBytes`, and stops at bounded file-count and total-byte caps. It is removed after the command, and shell tool events include a `Shell audit` block with copy statistics. This protects the real workspace from relative-path writes, but it is not a kernel sandbox; a command that explicitly reaches an absolute path can still use the user's OS permissions.

Use workspace policy `deniedShellCommands` to block repository-specific risky commands such as production deployment or destructive infrastructure commands. Use `allowedShellCommands` only when a team wants a narrow command menu for a profile, such as `^npm\\s+test$` or `^npm\\s+run\\s+build$`. These patterns are allow/deny gates on the raw command string; built-in dangerous command and network command checks still run afterward.

## Verify Configuration

```powershell
npm run build
node apps/cli/dist/index.js doctor
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
```

Expected checks:

- `DeepSeek API key: configured` for live model runs, or `missing` for local demo mode.
- Base URL and model reflect the shell or `.env` values.
- Fallback model count reflects `DEEPCODEX_PROVIDER_FALLBACK_MODELS` or workspace `provider.fallbackModels`.
- `providers models` reports the checked DeepSeek V4 model ids, the default model, and legacy alias migration status.
- Provider retry settings print with their effective environment/default values.
- Budget variables print when they are configured.
- Workspace config path and status print without crashing.
- Workspace config SHA-256 prints when a config file exists.
- Policy bundle status prints as missing, trusted, untrusted, or failed.
- Signed policy required prints `yes` when `DEEPCODEX_REQUIRE_SIGNED_POLICY=true`.
- Provider allowlist counts print when workspace config defines them.
- Shell network policy prints as blocked unless explicitly enabled.
- Shell execution mode prints as `direct` unless a workspace copy is explicitly enabled.
- Shell command allow/deny pattern counts print when workspace config or the selected profile defines them.
- Archive listing policy prints as blocked unless explicitly enabled.
- PDF text extraction policy prints as blocked unless explicitly enabled.
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
- Provider catalog API: `http://127.0.0.1:17361/api/provider/models`

The Web sidebar includes a Server field. It defaults to `VITE_DEEPCODEX_SERVER_URL` or `http://127.0.0.1:17361`, normalizes host-only values such as `127.0.0.1:17361`, and saves the selected API base in browser local storage.

For controlled demos, set `DEEPCODEX_CORS_ORIGINS=http://127.0.0.1:5173` or a comma-separated allowlist matching the Web origins you expect. Requests without an `Origin` header, such as local scripts and health checks, still work.

Recommended demo flow:

1. Enter a workspace path such as `D:\Coding\DeepCodex`.
2. Start with the `Inspection` policy profile for read-only prompts.
3. Use `Guarded write` only on a disposable branch or sample workspace.
4. Use `Load config` when the workspace has `.deepcodex/config.json`, then confirm profile, approval, max steps, budget, pricing, and retention values.
5. Review the Workspace policy panel for config hash, provider allowlists, shell controls, DLP counts, artifact controls, retention, and config path.
6. Review the Provider catalog panel for default model, source checked date, V4 model count, legacy alias count, and migration targets.
7. Check the Policy bundle panel when demonstrating signed workspace policy; it should show missing, trusted, untrusted, or failed with the verification reason.
8. Keep `Tool approvals` on `Manual` when demonstrating write, shell, or memory safety gates.
9. Watch the event stream for provider fallback selection, approvals, file hash audit metadata, tool starts, tool results, errors, and final answer.
10. Use the Release evidence and Distribution preflight `Download` buttons to save Markdown handoff reports.
11. Use `Load report` in Eval evidence to show recorded eval totals, score averages, and recent run summaries.
12. Use `Run scan` in Security scan to show existing probable-secret findings without revealing secret values.
13. Use `Load memory` to show `.deepcodex/memory.md` content for the selected workspace.
14. Set a token cap or USD cap in the Budget panel when demonstrating cost controls.
15. Use `Load sessions`, then `Replay` or `Export`, to show the persisted audit timeline for a previous run.

## Desktop Client

Development launch:

```powershell
npm run dev:desktop
```

The script starts the server, starts the Web client, waits for both local URLs, then launches Electron. It is the best path for showing the desktop surface during an interview, but it is still a development launch rather than a packaged installer.

Production-like smoke launch:

```powershell
npm run start:desktop
```

This builds all workspaces, starts Electron without `DEEPCODEX_WEB_URL`, checks `http://127.0.0.1:17361/api/health`, starts the built server automatically when needed, waits for health, and loads the built Web client from `apps/web/dist/index.html`. Set `DEEPCODEX_DESKTOP_START_SERVER=false` only when an external compatible local server is already managed by another process. `DEEPCODEX_SERVER_ENTRY` can override the built server entry for packaging experiments.

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

Machine-readable diagnostics:

```powershell
node apps/cli/dist/index.js doctor --json
```

CI-oriented preflight checks can make `doctor` fail with a non-zero exit code when required conditions are not met. The JSON output includes `ok`, `requirementFailures`, and `policyBundleVerification`:

```powershell
node apps/cli/dist/index.js doctor --json --require-api-key
node apps/cli/dist/index.js doctor --workspace D:\Coding\DeepCodex --json --require-workspace-config
node apps/cli/dist/index.js doctor --workspace D:\Coding\DeepCodex --json --require-trusted-policy-bundle
```

Use `--require-trusted-policy-bundle` with `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY`, `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE`, or `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILES` configured. Without a trusted key, a bundle that verifies only against an embedded public key remains untrusted and the preflight fails.

Generate shell completion scripts:

```powershell
node apps/cli/dist/index.js completion powershell
node apps/cli/dist/index.js completion bash
node apps/cli/dist/index.js completion zsh
node apps/cli/dist/index.js completion json
```

The shell scripts complete command names, subcommands, and options from the Commander command tree. `completion json` prints the same command spec for packaging checks or custom installer scripts.

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

List checked DeepSeek model metadata:

```powershell
node apps/cli/dist/index.js providers models
node apps/cli/dist/index.js providers show deepseek-v4-pro
```

List and run built-in or workspace-defined smoke evals:

```powershell
node apps/cli/dist/index.js evals list --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals show repo-map --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json --min-score 0.8
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json --record
node apps/cli/dist/index.js evals history --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals compare <baseline-run-id> <candidate-run-id> --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals report --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js release evidence --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js release evidence --workspace D:\Coding\DeepCodex --json --fail-on-fail
node apps/cli/dist/index.js release preflight --root D:\Coding\DeepCodex
node apps/cli/dist/index.js release preflight --root D:\Coding\DeepCodex --json --fail-on-fail
node apps/cli/dist/index.js security scan --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js security scan --workspace D:\Coding\DeepCodex --json --fail-on-findings
```

CLI evals use read-only `suggest` mode and emit `eval_started`, normal agent events, and `eval_result` records in JSON mode. Results include exact expected-signal scoring and the task source (`built-in` or `workspace`). Use `--min-score <0-1>` or `--require-pass` to make the command fail for CI smoke gates. Add `--record` only when you want to persist local eval evidence under `.deepcodex/state/evals`; use `evals compare` to review score and signal changes between recorded runs, and `evals report` to aggregate release evidence.

`release evidence` aggregates workspace config provenance, policy-bundle verification, eval evidence, security scan metadata, provider-key status, and recent session summaries into one Markdown or JSON report. It is intended as an interview or CI evidence artifact; it does not replace the individual tests, eval runs, or security review.

`release preflight` checks the product root for expected root scripts, Web/Desktop/CLI/server build scripts, CLI bin/completion readiness, Desktop bootstrap safety settings, built artifacts, required docs, and ignored local-state paths. Missing built artifacts warn so a source-only checkout can still be reviewed, while missing scripts, docs, CLI packaging metadata, or safety settings fail the gate.

`security scan` is a read-only preflight for existing probable secrets. Use `--json` for CI artifacts and `--fail-on-findings` when a workspace should fail the gate if any finding metadata is reported. The command reports finding type and label only; it does not print matched values.

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

Emit newline-delimited JSON events for automation:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --profile inspection --json "Inspect this repository and summarize the safest next step."
```

`ask --json` writes one JSON object per line for each event and a final `result` record. It rejects prompt/manual approval mode so stdout stays machine-readable.

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

Run a trusted document-review task that needs local PDF text:

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --profile inspection --allow-pdf-text-extraction "Extract the first pages of docs\example.pdf and summarize the implementation requirements."
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

For `run_command`, a zero exit code is required for a successful tool result. Non-zero exits, timeout termination, signals, and output overflow are reported as failed tool results. Shell output collection is bounded, and timeouts attempt to terminate the spawned process tree so a failed verification command is not treated as proof that checks passed.

When `shellExecutionMode` is `workspace-copy`, `run_command` executes from a temporary snapshot instead of the selected workspace path. The tool omits denied and oversized files from the snapshot, records copy statistics in `Shell audit`, and removes the snapshot after execution. Use this for safer test or inspection commands that should not write into the real repository.

The `inspect_artifact` tool is available to the agent for media or binary-adjacent files that should not be read as text. It returns metadata such as byte size, detected type, sample hash, and simple image dimensions, while omitting raw bytes, base64 data, OCR, and archive contents. It still respects denied path patterns such as `.env` and `.deepcodex/state`.

The `list_archive_entries` tool can list ZIP-compatible archive entry metadata only when archive listing policy is explicitly enabled. It reads the end-of-central-directory record and a bounded central directory range, reports entry names, directory/file status, compressed and uncompressed sizes, compression method, unsafe-path flags, truncation status, and denied-entry counts. It never extracts archive members or returns member content.

The `extract_pdf_text` tool can extract local PDF text only when PDF text extraction policy is explicitly enabled. It reads the PDF through the shared file policy, reports page and character bounds, and does not expose raw PDF bytes, base64 content, images, attachments, or embedded files.

The Security scan panel and CLI `security scan` command use the same detector as write-time DLP blocking to scan existing allowed text files for probable secrets. The output is intentionally metadata-only: path, line, type, and label.

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Web UI cannot run the agent. | Server is not listening or the Web Server field points at the wrong API base. | Open `/api/health`, then save the matching Server URL in the sidebar. |
| Browser reports a CORS failure. | `DEEPCODEX_CORS_ORIGINS` does not include the Web origin. | Add the Web origin to `DEEPCODEX_CORS_ORIGINS` or leave it empty for local development. |
| Desktop production-like launch opens but cannot run tasks. | Managed server did not start or the Web Server field points at another API base. | Use `npm run start:desktop`, check `/api/health`, and save the matching Server URL. |
| CLI stays in demo mode. | `DEEPSEEK_API_KEY` is not available to the shell. | Run `doctor` from the same shell. |
| Workspace error. | Path does not exist or is not a directory. | Pass an absolute workspace path. |
| Tool command blocked. | Approval mode is `suggest`, or a dangerous command needs `full-access`. | Rerun with the intended mode only after reviewing the command. |
| Shell command failed. | The command exited non-zero, timed out, was terminated, or exceeded the output cap. | Treat it as failed verification; inspect stdout/stderr and rerun only after changing the command or fixing the underlying issue. |
| Shell command cannot find a custom environment variable. | Shell environment mode is `minimal`. | Use `--shell-env inherit` or `DEEPCODEX_SHELL_ENV=inherit` only for trusted workspaces that need parent environment variables. |
| Shell command changes are missing from the workspace. | Shell execution mode is `workspace-copy`, so relative-path writes happened in the temporary snapshot. | Use direct mode only when the command is intentionally allowed to update the selected workspace, or keep workspace-copy for verification commands. |
| Shell network command is blocked. | `allowNetwork` is false and the command looks like package install, remote git, or a network utility. | Use CLI `--allow-network`, `DEEPCODEX_ALLOW_NETWORK=true`, or workspace policy `allowNetwork: true` only for trusted tasks. |
| Shell command is denied by workspace shell policy. | The command matched `policy.deniedShellCommands`. | Change the task command, use a different approved profile, or update the signed workspace policy after review. |
| Shell command is not in the workspace shell allowlist. | `policy.allowedShellCommands` is non-empty and none of the patterns matched the raw command. | Use one of the documented allowed commands or update the team policy after review. |
| Write or edit is blocked by DLP policy. | The proposed content looks like a secret assignment, bearer token, token literal, or workspace custom DLP match. | Move the value to an environment variable or set `policy.allowSecretWrites: true` only for a trusted fixture/migration workspace. |
| Security scan reports findings. | Existing allowed text files match built-in sensitive patterns or workspace `dlpPatterns`. | Review the reported path and line locally, move real secrets out of the workspace, or tune project-specific patterns for false positives. |
| A project-specific secret still appears in output. | Redaction is pattern-based. | Add the pattern to a future project DLP policy and rotate the exposed secret if necessary. |
| Agent appears paused. | Tool approvals are manual and a tool is waiting for approval. | Approve or deny the pending tool in the Web approval queue, or answer the CLI prompt. |
| Unexpected memory file appears. | Memory was loaded explicitly or the run used `workspace-write` / `full-access`. | Use `suggest` for strict inspection runs. |
| A file is denied unexpectedly. | The file matches the built-in denied list or `DEEPCODEX_DENIED_PATHS`. | Review the deny pattern before loosening it. |
| A media or artifact file is denied unexpectedly. | The file extension matches the built-in media/artifact deny list or `DEEPCODEX_DENIED_EXTENSIONS`. | Use `inspect_artifact` for metadata-only inspection. For trusted ZIP manifests, enable `allowArchiveListing` and use `list_archive_entries`. |
| Archive listing is blocked. | `allowArchiveListing` is false. | Use CLI `--allow-archive-listing`, `DEEPCODEX_ALLOW_ARCHIVE_LISTING=true`, or workspace policy `allowArchiveListing: true` only for trusted archive manifests. |
| PDF text extraction is blocked. | `allowPdfTextExtraction` is false. | Use Web `PDF text extraction`, CLI `--allow-pdf-text-extraction`, `DEEPCODEX_ALLOW_PDF_TEXT_EXTRACTION=true`, or workspace policy `allowPdfTextExtraction: true` only for trusted PDFs. |
| PDF text extraction says the header is missing. | The file is not a valid PDF or the content does not start with `%PDF-`. | Use `inspect_artifact` to check metadata and replace the file with a valid local PDF. |
| A file is skipped or rejected as too large. | It exceeds `DEEPCODEX_MAX_FILE_BYTES` or the built-in 512 KiB default. | Raise the limit only for trusted workspaces and keep large generated assets out of model context. |
| Cost budget is rejected. | `DEEPCODEX_MAX_SESSION_USD` or `--max-session-usd` was set without input and output token prices. | Configure both pricing values or use a token-only budget. |
| Pricing profile is rejected. | `DEEPCODEX_PRICING_PROFILE` or `--pricing-profile` does not match a configured profile id. | Run `deepcodex pricing list` and choose one of the configured ids. |
| Provider is rejected. | `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPCODEX_PROVIDER_FALLBACK_MODELS`, or workspace defaults do not match `provider.allowedBaseUrls` or `provider.allowedModels`. | Run `deepcodex doctor --workspace <path>` and update the workspace provider policy, selected model, or fallback model list. |
| Provider call fails after several attempts. | DeepSeek-compatible provider returned retryable failures or the network remained unavailable through the retry budget for every configured fallback model. | Run `doctor`, verify network/API status, remove unhealthy fallbacks, or tune `DEEPCODEX_PROVIDER_MAX_RETRIES` and `DEEPCODEX_PROVIDER_RETRY_BASE_MS` only for trusted demos. |
| Run fails before the model call with signed policy required. | `DEEPCODEX_REQUIRE_SIGNED_POLICY=true` and the policy bundle is missing, untrusted, expired, revoked, has an untrusted issuer, or does not match the active config SHA-256. | Run `deepcodex config verify-bundle --workspace <path> --public-key <pem>` and fix the bundle, trusted key list, revocation list, or issuer allowlist. |
| Workspace config is rejected. | `.deepcodex/config.json` has invalid JSON, unsupported values, or an invalid redaction regex. | Run `deepcodex config show --workspace <path>` and fix the reported field. |
| Budget stops a run before tools execute. | The provider usage metadata reached the configured budget. | Raise the session budget or rerun a narrower prompt. |
| Session history grows too large. | Retention variables are not set and pruning has not been run. | Use Web Audit retention controls or `deepcodex sessions prune --dry-run` before applying deletion. |
