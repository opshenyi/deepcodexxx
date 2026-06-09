# DeepCodex Memory

Last updated: 2026-06-09 Asia/Shanghai

## User Goal

Build a commercial-quality DeepSeek coding agent product as an interview project. It must have three clients, use no emoji or icon-led UI, follow a restrained Codex-like enterprise style, and keep a memory file so future context resets know what to do next.

## Completed In This Session

- Confirmed workspace was initially empty and not a git repository.
- Read `D:\design-md` local UX/UI references and applied the most relevant developer-tool patterns from Cursor, OpenCode, Warp, Linear, Raycast, and Vercel.
- Pulled shallow reference clones into `references/agents` for major open-source coding agents:
  Codex, OpenCode, OpenHands, Cline, Roo Code, Continue, Aider, SWE-agent, GPT Engineer, Tabby, Goose, Gemini CLI, Qwen Code, Void, Devika, and smol developer.
- Fixed Gemini CLI checkout on Windows by enabling `core.longpaths` and restoring the worktree.
- Created the first DeepCodex monorepo:
  - `packages/core` for DeepSeek client, agent loop, tools, safety, workspace memory.
  - `apps/server` for local HTTP and event-stream API.
  - `apps/web` for browser client.
  - `apps/desktop` for Electron client.
  - `apps/cli` for terminal client.
- Added docs for architecture, product readiness, and reference agent survey.
- Added commercial documentation, release checklist, security model, roadmap, runbook, and design system notes.
- Added session audit persistence under `.deepcodex/state/sessions`.
- Added unified diff output for write/edit tools; in `suggest` mode those tools preview changes without writing.
- Added Web and CLI session history views (`Load sessions`, `deepcodex sessions list/show`).
- Added manual tool approvals across core/server/Web/CLI for `write_file`, `edit_file`, `run_command`, and `append_memory`.
- CLI agent runs now persist the same `.deepcodex/state/sessions` audit history as Web/server runs.
- Added strict read-only `suggest` behavior so agent inspection runs do not create `.deepcodex` memory or session state.
- Added configurable denied path patterns and default protection for `.env*` and `.deepcodex/state`.
- Added configurable file-size limits for file read, write, edit, and search tools through `DEEPCODEX_MAX_FILE_BYTES`; default is 512 KiB.
- Added Web session replay for saved `.deepcodex/state/sessions` audit timelines, with desktop and mobile browser smoke checks.
- Added approval audit metadata across core/server/Web/CLI: request time, decision time, decision latency, and actor.
- Added Markdown/JSON session export through core formatter, server endpoint, Web export button, and CLI `sessions export`.
- Added binary-aware file handling so read/edit reject binary-looking files and search skips them.
- Added token usage accounting events and session totals when the provider returns usage metadata; surfaced in Web, CLI, replay, and export.
- Added run-level token and estimated-cost budget controls across core, server, Web/Desktop, CLI, session replay, exports, docs, and `.env.example`. Cost budgets require caller-provided input/output token prices and stop additional work after provider usage reaches the configured limit.
- Added approval and tool file hash auditing for `write_file` and `edit_file`: approval requests include before-file SHA-256 metadata when available, tool results include before/after SHA-256 and applied/preview status, and Web/CLI/session exports display the audit data.
- Added session audit retention pruning by max retained session count or max age days, with dry-run support in core, server API, CLI `sessions prune`, and Web/desktop Audit trail controls. Env defaults are `DEEPCODEX_MAX_SESSIONS` and `DEEPCODEX_SESSION_RETENTION_DAYS`.
- Added minimal shell environment mode for `run_command`: default `DEEPCODEX_SHELL_ENV=minimal` keeps provider keys and arbitrary parent env vars out of shell child processes; `inherit` remains available for trusted tasks.
- Added generated/build output path policy: default denied paths now cover nested env files, nested `node_modules`, and common generated folders (`dist`, `build`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.vite`, `.parcel-cache`), with `**` glob support for custom deny patterns like `**/*.map`.
- Added event redaction for common secret assignments, bearer headers, and token literals before agent events are streamed/persisted; redacted tool output is also sent back into the model loop.
- Added built-in reusable policy profiles across core/server/Web/Desktop/CLI: `inspection`, `guarded-write`, and `full-access-review`. Profiles bundle execution mode, approval default, max steps, and shell environment, with CLI `profiles list/show` and Web profile selector.

## Architecture Decisions

- Product code is clean-room TypeScript. Reference repos are study material only.
- Default DeepSeek base URL is `https://api.deepseek.com`.
- Default model is configurable through `DEEPSEEK_MODEL` and currently falls back to `deepseek-chat`.
- Agent tools are evented and policy-controlled.
- Workspace memory lives in `.deepcodex/memory.md`.
- Product memory for future Codex sessions lives in this file.

## Next Steps

1. Add OS-level shell sandboxing or isolated execution workers; current shell protection is command filtering plus minimal env, not a full sandbox.
2. Add richer media/artifact-type policies beyond path-based generated output denial.
3. Add managed pricing profiles, custom team policy profile storage, and project-specific DLP controls.
4. Continue browser and CLI smoke checks after meaningful product changes.
5. Continue pushing production-ready increments to `https://github.com/opshenyi/deepcodexxx.git`.
