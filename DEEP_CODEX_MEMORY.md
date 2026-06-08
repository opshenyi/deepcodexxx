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

## Architecture Decisions

- Product code is clean-room TypeScript. Reference repos are study material only.
- Default DeepSeek base URL is `https://api.deepseek.com`.
- Default model is configurable through `DEEPSEEK_MODEL` and currently falls back to `deepseek-chat`.
- Agent tools are evented and policy-controlled.
- Workspace memory lives in `.deepcodex/memory.md`.
- Product memory for future Codex sessions lives in this file.

## Next Steps

1. Run `npm install`.
2. Fix any TypeScript or dependency issues from install/build.
3. Run `npm run build` and `npm test`.
4. Start `npm run dev`, inspect the Web client in the browser, and polish layout if needed.
5. Add approval queue and diff preview for writes before calling this commercial-ready.
6. Add persisted session history and release packaging.
7. Initialize git, set remote to `https://github.com/opshenyi/deepcodexxx.git`, commit product code, and push when credentials allow.
