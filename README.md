# DeepCodex

DeepCodex is a DeepSeek-powered coding agent product with Web, Desktop, and CLI clients. It is designed as a commercial interview project: clean architecture, transparent tool execution, persistent memory, and a restrained enterprise UI.

Core safety features include workspace path guardrails, manual tool approvals, diff-producing write/edit tools, file hash audit metadata, session replay/export, retention pruning, and run-level token or estimated-cost budgets.

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
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex "Inspect this repository and summarize the next safe step."
node apps/cli/dist/index.js ask --approval prompt --workspace D:\Coding\DeepCodex "Make a small safe change and show the checks."
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --max-session-tokens 20000 "Inspect this repository with a token budget."
node apps/cli/dist/index.js sessions list --workspace D:\Coding\DeepCodex
```

## Environment

- `DEEPSEEK_API_KEY`: DeepSeek API key.
- `DEEPSEEK_BASE_URL`: Defaults to `https://api.deepseek.com`.
- `DEEPSEEK_MODEL`: Defaults to `deepseek-chat`.
- `DEEPCODEX_PORT`: Defaults to `17361`.
- `DEEPCODEX_WORKSPACE`: Optional default workspace path.
- `DEEPCODEX_MAX_SESSION_TOKENS`: Optional token budget per agent run.
- `DEEPCODEX_MAX_SESSION_USD`: Optional estimated USD budget per agent run.
- `DEEPCODEX_INPUT_USD_PER_MILLION_TOKENS`: Required when enforcing a USD budget.
- `DEEPCODEX_OUTPUT_USD_PER_MILLION_TOKENS`: Required when enforcing a USD budget.

If `DEEPSEEK_API_KEY` is not set, DeepCodex runs in local demo mode and returns a clear mock response instead of calling DeepSeek. For the current Web client, keep `DEEPCODEX_PORT=17361` because the browser app connects to `http://127.0.0.1:17361`.

## Runbook

Detailed setup and smoke-test steps are in `docs/runbook.md`.

- Web: `npm run dev`, then open `http://127.0.0.1:5173`.
- Desktop: `npm run dev:desktop`.
- CLI: `npm run build`, then run `node apps/cli/dist/index.js doctor`.
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
