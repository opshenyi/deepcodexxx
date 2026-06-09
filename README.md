# DeepCodex

DeepCodex is a DeepSeek-powered coding agent product with Web, Desktop, and CLI clients. It is designed as a commercial interview project: clean architecture, transparent tool execution, persistent memory, and a restrained enterprise UI.

Core safety features include workspace-level configuration with SHA-256 provenance, reusable policy profiles, provider/model allowlists, workspace path guardrails, generated/build output deny patterns, media/artifact extension policies, safe artifact metadata inspection, manual tool approvals, event redaction, write-time DLP blocking for probable secrets, diff-producing write/edit tools, file hash audit metadata, session replay/export, retention pruning, minimal shell environment mode, network-aware shell command policy, and run-level token or estimated-cost budgets.

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
```

CLI client:

```powershell
npm run build
node apps/cli/dist/index.js doctor
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js profiles list
node apps/cli/dist/index.js pricing list
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex "Inspect this repository and summarize the next safe step."
node apps/cli/dist/index.js ask --profile inspection --workspace D:\Coding\DeepCodex "Inspect this repository without making changes."
node apps/cli/dist/index.js ask --approval prompt --workspace D:\Coding\DeepCodex "Make a small safe change and show the checks."
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --max-session-tokens 20000 "Inspect this repository with a token budget."
node apps/cli/dist/index.js sessions list --workspace D:\Coding\DeepCodex
```

Workspace defaults can be stored in `.deepcodex/config.json` so a repository can pin its model and provider base URL, define provider/model allowlists and team policy profiles, choose a default policy profile, set approval mode, max steps, budget, file policy additions, custom redaction/DLP patterns, secret-write policy, shell environment, shell network access, pricing profile, and session retention defaults:

```powershell
node apps/cli/dist/index.js config init --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js profiles list --workspace D:\Coding\DeepCodex
```

## Environment

- `DEEPSEEK_API_KEY`: DeepSeek API key.
- `DEEPSEEK_BASE_URL`: Defaults to `https://api.deepseek.com`.
- `DEEPSEEK_MODEL`: Defaults to `deepseek-chat`.
- `DEEPCODEX_PORT`: Defaults to `17361`.
- `DEEPCODEX_WORKSPACE`: Optional default workspace path.
- `DEEPCODEX_DENIED_EXTENSIONS`: Optional extension deny-list additions for media/artifact files.
- `DEEPCODEX_MAX_SESSION_TOKENS`: Optional token budget per agent run.
- `DEEPCODEX_MAX_SESSION_USD`: Optional estimated USD budget per agent run.
- `DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS`: Required when enforcing a USD budget.
- `DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS`: Required when enforcing a USD budget.
- `DEEPCODEX_SHELL_ENV`: Defaults to `minimal`; set `inherit` only for trusted shell tasks that need parent environment variables.
- `DEEPCODEX_ALLOW_NETWORK`: Defaults to `false`; set `true` only for trusted shell tasks that need package installs, git fetch/pull/push, or network utilities.
- `DEEPCODEX_POLICY_PROFILE`: Optional default profile: `inspection`, `guarded-write`, or `full-access-review`.
- `DEEPCODEX_PRICING_PROFILES`: Optional JSON array/object of caller-managed pricing profiles.
- `DEEPCODEX_PRICING_PROFILE`: Optional default pricing profile id used for estimated cost budgets.

If `DEEPSEEK_API_KEY` is not set, DeepCodex runs in local demo mode and returns a clear mock response instead of calling DeepSeek. For the current Web client, keep `DEEPCODEX_PORT=17361` because the browser app connects to `http://127.0.0.1:17361`.

Environment variables and explicit CLI/Web request values override `.deepcodex/config.json`; the workspace config is the team default layer, not a secrets store.

## Runbook

Detailed setup and smoke-test steps are in `docs/runbook.md`.

- Web: `npm run dev`, then open `http://127.0.0.1:5173`.
- Desktop: `npm run dev:desktop`.
- CLI: `npm run build`, then run `node apps/cli/dist/index.js doctor`.
- Workspace config: `node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex`.
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

## Reference Research

Reference repositories are shallow-cloned under `references/agents` and ignored by git. See `docs/reference-agents.md` for the survey and licensing notes.
