# DeepCodex

DeepCodex is a DeepSeek-powered coding agent product with Web, Desktop, and CLI clients. It is designed as a commercial interview project: clean architecture, transparent tool execution, persistent memory, and a restrained enterprise UI.

Core safety features include workspace-level configuration with SHA-256 provenance and optional signed policy-bundle verification, reusable policy profiles, provider/model allowlists, saved Web workspace profiles, Web/Desktop workspace policy summaries, workspace path guardrails, generated/build output deny patterns, media/artifact extension policies, safe artifact metadata inspection, default-off archive listing and PDF text extraction, workspace security scanning for probable secrets, manual tool approvals, event redaction, write-time DLP blocking for probable secrets, diff-producing write/edit tools, Web unified/split diff review, file hash audit metadata, session replay/export, retention pruning, minimal shell environment mode, network-aware and workspace-configurable shell command policy, run-level token or estimated-cost budgets, release evidence reports, distribution preflight checks, Web/Desktop Markdown evidence downloads, and CLI CI diagnostics.

## Quick Start

```powershell
npm install
Copy-Item .env.example .env
# Set DEEPSEEK_API_KEY in .env or your shell profile.
npm run dev
```

Open `http://127.0.0.1:5173` for the Web client.

Desktop client:

```powershell
npm run dev:desktop
npm run start:desktop
```

CLI client:

```powershell
npm run build
node apps/cli/dist/index.js doctor
node apps/cli/dist/index.js doctor --json
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js profiles list
node apps/cli/dist/index.js pricing list
node apps/cli/dist/index.js evals list --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals report --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js release evidence --workspace D:\Coding\DeepCodex --json
node apps/cli/dist/index.js release preflight --root D:\Coding\DeepCodex --json
node apps/cli/dist/index.js security scan --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js completion powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex "Inspect this repository and summarize the next safe step."
node apps/cli/dist/index.js ask --profile inspection --workspace D:\Coding\DeepCodex "Inspect this repository without making changes."
node apps/cli/dist/index.js ask --approval prompt --workspace D:\Coding\DeepCodex "Make a small safe change and show the checks."
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --max-session-tokens 20000 "Inspect this repository with a token budget."
node apps/cli/dist/index.js sessions list --workspace D:\Coding\DeepCodex
```

Workspace defaults can be stored in `.deepcodex/config.json` so a repository can pin its model and provider base URL, define provider/model allowlists, team policy profiles, workspace eval tasks, choose a default policy profile, set approval mode, max steps, budget, file policy additions, custom redaction/DLP patterns, secret-write policy, archive listing policy, PDF text extraction policy, shell environment, shell network access, shell command allow/deny patterns, pricing profile, and session retention defaults:

```powershell
node apps/cli/dist/index.js config init --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js profiles list --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js config export-trust-package --workspace D:\Coding\DeepCodex --public-key D:\keys\policy-public.pem --trusted-issuer "Security Team" --require-signed-policy --output D:\keys\deepcodex-policy-trust.json --env-output D:\keys\deepcodex-policy-trust.env
```

## Environment

- `DEEPSEEK_API_KEY`: DeepSeek API key.
- `DEEPSEEK_BASE_URL`: Defaults to `https://api.deepseek.com`.
- `DEEPSEEK_MODEL`: Defaults to `deepseek-chat`.
- `DEEPCODEX_PROVIDER_MAX_RETRIES`: Defaults to `2`; retries retryable provider failures before surfacing an error.
- `DEEPCODEX_PROVIDER_RETRY_BASE_MS`: Defaults to `500`; exponential backoff base delay for provider retries.
- `DEEPCODEX_PORT`: Defaults to `17361`.
- `DEEPCODEX_WORKSPACE`: Optional default workspace path.
- `DEEPCODEX_DENIED_EXTENSIONS`: Optional extension deny-list additions for media/artifact files.
- `DEEPCODEX_MAX_SESSION_TOKENS`: Optional token budget per agent run.
- `DEEPCODEX_MAX_SESSION_USD`: Optional estimated USD budget per agent run.
- `DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS`: Required when enforcing a USD budget.
- `DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS`: Required when enforcing a USD budget.
- `DEEPCODEX_SHELL_ENV`: Defaults to `minimal`; set `inherit` only for trusted shell tasks that need parent environment variables.
- `DEEPCODEX_ALLOW_NETWORK`: Defaults to `false`; set `true` only for trusted shell tasks that need package installs, git fetch/pull/push, or network utilities.
- `DEEPCODEX_ALLOW_PDF_TEXT_EXTRACTION`: Defaults to `false`; set `true` only for trusted local PDFs that need bounded text extraction.
- `DEEPCODEX_POLICY_PROFILE`: Optional default profile: `inspection`, `guarded-write`, or `full-access-review`.
- `DEEPCODEX_PRICING_PROFILES`: Optional JSON array/object of caller-managed pricing profiles.
- `DEEPCODEX_PRICING_PROFILE`: Optional default pricing profile id used for estimated cost budgets.
- `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY`: Optional trusted Ed25519 public key PEM for policy-bundle verification.
- `DEEPCODEX_POLICY_BUNDLE_PUBLIC_KEY_FILE`: Optional path to a trusted Ed25519 public key PEM file.
- `DEEPCODEX_REQUIRE_SIGNED_POLICY`: Defaults to `false`; set `true` to require a trusted signed policy bundle before CLI/server agent runs.

If `DEEPSEEK_API_KEY` is not set, DeepCodex runs in local demo mode and returns a clear mock response instead of calling DeepSeek. For the current Web client, keep `DEEPCODEX_PORT=17361` because the browser app connects to `http://127.0.0.1:17361`.

Environment variables and explicit CLI/Web request values override `.deepcodex/config.json`; the workspace config is the team default layer, not a secrets store.

## Runbook

Detailed setup and smoke-test steps are in `docs/runbook.md`.

- Web: `npm run dev`, then open `http://127.0.0.1:5173`.
- Desktop dev: `npm run dev:desktop`.
- Desktop production-like smoke: `npm run start:desktop`.
- CLI: `npm run build`, then run `node apps/cli/dist/index.js doctor`.
- CLI completion: `node apps/cli/dist/index.js completion powershell`, `completion bash`, or `completion zsh`.
- Workspace config: `node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex`.
- Web/Desktop workspace policy: use `Load config` to review config hash, provider allowlists, shell controls, DLP counts, artifact controls, retention, and config path.
- Web/Desktop evidence: use the right-rail `Download` buttons to save Markdown release evidence and distribution preflight reports.
- Session audit: `node apps/cli/dist/index.js sessions list --workspace D:\Coding\DeepCodex`.
- Health check: `http://127.0.0.1:17361/api/health`.

Use `suggest` mode for inspection demos, `workspace-write` for bounded edits in a disposable workspace, and `full-access` only for controlled local runs.

Use Web `Tool approvals: Manual` or CLI `--approval prompt` to pause write, shell, and memory tools until reviewed.

## Clients

- Web: `apps/web`
- Desktop: `apps/desktop`
- CLI: `apps/cli`
- Server: `apps/server`
- Agent core: `packages/core`

## Commercialization Materials

- Capability matrix and positioning: `docs/commercialization.md`
- Product readiness: `docs/product-readiness.md`
- Design system: `docs/design-system.md`
- Security model: `docs/security-model.md`
- Release and demo checklist: `docs/release-checklist.md`
- Roadmap: `docs/roadmap.md`
- CLI evals: `docs/evals.md`

## Reference Research

Reference repositories are shallow-cloned under `references/agents` and ignored by git. See `docs/reference-agents.md` for the survey and licensing notes.
