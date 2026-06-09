# Commercialization Brief

DeepCodex is positioned as a local-first DeepSeek coding agent for interview and pilot evaluation. The current product demonstrates a shared agent core across Web, Desktop, and CLI clients, transparent tool execution, workspace-scoped operations, and persistent workspace memory.

This document separates implemented capabilities from commercial gaps so the demo can be evaluated without overstating readiness.

## Product Positioning

DeepCodex is useful when an evaluator wants to see how a coding agent handles local repositories with explicit execution boundaries. The core value is not a hosted SaaS workflow yet; it is a complete local product slice that shows provider integration, runtime policy, multi-client UX, and a practical release path.

Primary audiences:

- Technical interviewers reviewing architecture, safety tradeoffs, and product thinking.
- Engineering leads evaluating local AI coding workflows before a hosted rollout.
- Developers who want a transparent DeepSeek-based coding agent for repository inspection and bounded edits.

## Capability Matrix

| Area | Current capability | Evidence in product | Demo maturity | Commercial gap |
| --- | --- | --- | --- | --- |
| Agent loop | DeepSeek-compatible chat completions loop with tool calls, bounded steps, token usage events, and run-level token/cost budgets when the provider returns usage metadata. | `packages/core` agent, DeepSeek client, budget controls, and tool registry. | Demo-ready. | Add retry policy and richer provider failure handling. |
| Provider setup | Environment-driven DeepSeek API key, base URL, model, policy profile, and optional budget variables. Missing key falls back to local demo mode. | `.env.example`, `DeepSeekClient`, CLI `doctor`. | Demo-ready. | Add provider registry, per-workspace model policy, and managed pricing profiles. |
| Workspace tools | List, read, search, write, edit, shell command, read memory, append memory. Write and edit tools return unified diffs plus before/after SHA-256 audit metadata; `suggest` mode previews without applying. File tools enforce a configurable size cap, avoid binary-looking files for read/edit/search, and skip common generated/build output paths by default. | Default tool registry in `packages/core`. | Demo-ready for local repositories. | Add richer media/artifact-type policies. |
| Execution transparency | Server sends event-stream updates for session, model usage, budget updates, budget stops, approval request, approval decision, tool start, tool result, final answer, and errors. Events are redacted for common secret patterns before streaming/persistence. Sessions are persisted locally, replayable in the Web client, exportable as Markdown or JSON, and prunable by count or age with dry-run support. | Local HTTP API, Web event timeline and replay view, CLI export/prune, and session store. | Demo-ready. | Add structured observability and broader DLP policy. |
| Web client | Browser console for workspace path, execution mode, prompt, event stream, session replay, audit export, memory, and final output. | `apps/web`. | Demo-ready. | Add saved workspace profiles, diff viewer, and configurable server URL. |
| Desktop client | Electron shell that hosts the Web experience after server and Web are available. | `apps/desktop`, `npm run dev:desktop`. | Demo-ready for local development. | Add packaged installers, signing, auto-update policy, and OS-specific QA. |
| CLI client | `doctor`, `ask`, `memory`, and `sessions list/show/export` commands for terminal workflows. | `apps/cli`. | Demo-ready. | Add shell completion, config profiles, and broader non-interactive CI mode. |
| Workspace safety | Path resolution prevents file tools from escaping the workspace; denied path patterns protect `.git`, `node_modules`, nested env files, generated/build output, reference repos, and session audit state by default; file-size limits reduce runaway context and memory usage; shell tools default to a minimal child-process environment. | `workspace.ts`, safety tests. | MVP-ready. | Add OS-level sandboxing for shell and broader security regression tests. |
| Approval modes | `suggest`, `workspace-write`, and `full-access` control file and shell behavior. Built-in reusable profiles (`inspection`, `guarded-write`, `full-access-review`) bundle execution mode, approval default, max steps, and shell environment. Tool approval mode can be `auto`, `manual`, or `deny`; manual pauses write, shell, and memory tools, and approval events record actor, request time, decision time, latency, and before-file hashes for file edits when available. | CLI options, server request policy, Web profile selector, Web approval queue and replay view. | Demo-ready with documented limits. | Add custom team policy profile storage. |
| Memory | Workspace memory persists under `.deepcodex/memory.md` and can be read from Web, CLI, and server API. `suggest` agent runs do not create workspace memory or session state. | `memory` tool, `/api/memory`, strict read-only tests. | Demo-ready. | Add memory review, redaction, and retention policy. |
| Reference research | Reference agent survey documents studied projects and clean-room constraints. | `docs/reference-agents.md`. | Ready for interview review. | Add a formal license review before external distribution. |

## Product Packages

| Package | Purpose | Current state | Release requirement |
| --- | --- | --- | --- |
| Interview artifact | Demonstrate architecture, product surface, safety model, and roadmap. | Ready after checklist passes. | Keep docs current, run tests, and prepare a short demo path. |
| Local pilot | Let a small internal team run the agent against disposable or low-risk repositories. | Plausible for controlled local trials. | Add OS-level shell sandboxing, project-specific DLP, and documented data handling. |
| Hosted product | Multi-user service with managed workspaces and auth. | Future work. | Add tenancy, RBAC, audit logs, secrets management, and infrastructure isolation. |

## Demo Narrative

1. Start with `npm run dev` and show the Web client connected to the local server.
2. Run a repository inspection prompt in `suggest` mode to demonstrate read-only planning.
3. Switch to `workspace-write` on a disposable branch or sample workspace for a small edit-and-test task.
4. Show the event timeline so tool calls are visible rather than hidden behind a chat transcript.
5. Load sessions, replay a previous run, and export it to show the saved audit trail.
6. Load workspace memory and explain where it is stored.
7. Run `node apps/cli/dist/index.js doctor` and one CLI `ask` command to show parity with the Web client.
8. Close with the security model and roadmap, including gaps that are intentionally not claimed as complete.

## Success Criteria

An interview-ready build should satisfy these criteria:

- Fresh install works from the repository root.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Web, Desktop, and CLI clients can each run a basic prompt.
- Reusable policy profiles can be selected from Web/Desktop and CLI.
- The Web client can load and replay a persisted session history.
- A persisted session can be exported as Markdown or JSON.
- Session history retention can be previewed and applied by count or age.
- Write and edit approvals include file hash audit evidence in the run history.
- Token and cost budgets can be configured from Web, CLI, or environment variables.
- Missing DeepSeek key produces clear demo-mode behavior.
- With a configured key, DeepSeek can perform a bounded workspace inspection.
- The presenter can explain approval modes, path restrictions, memory persistence, and shell limitations.
- Known commercial gaps are documented instead of hidden.
