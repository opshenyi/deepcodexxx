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

## Architecture Decisions

- Product code is clean-room TypeScript. Reference repos are study material only.
- Default DeepSeek base URL is `https://api.deepseek.com`.
- Default model is configurable through `DEEPSEEK_MODEL` and currently falls back to `deepseek-chat`.
- Agent tools are evented and policy-controlled.
- Workspace memory lives in `.deepcodex/memory.md`.
- Product memory for future Codex sessions lives in this file.

## Next Steps

1. Commit and push the token usage accounting work if it has not already been committed.
2. Add cost/budget controls that can stop sessions before runaway provider spend.
3. Add approval file hashes, audit retention controls, generated-asset policies, and shell isolation.
4. Continue browser and CLI smoke checks after meaningful product changes.
5. Continue pushing production-ready increments to `https://github.com/opshenyi/deepcodexxx.git`.
