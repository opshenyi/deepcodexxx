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
| Agent loop | DeepSeek-compatible chat completions loop with tool calls and bounded steps. | `packages/core` agent, DeepSeek client, and tool registry. | Demo-ready. | Add retry policy, cost controls, and persisted run records. |
| Provider setup | Environment-driven DeepSeek API key, base URL, and model. Missing key falls back to local demo mode. | `.env.example`, `DeepSeekClient`, CLI `doctor`. | Demo-ready. | Add provider registry, per-workspace model policy, and token budget enforcement. |
| Workspace tools | List, read, search, write, edit, shell command, read memory, append memory. Write and edit tools return unified diffs; `suggest` mode previews without applying. | Default tool registry in `packages/core`. | Demo-ready for local repositories. | Add richer file type handling and stronger binary/large-file behavior. |
| Execution transparency | Server sends event-stream updates for session, approval request, approval decision, tool start, tool result, final answer, and errors. Sessions are persisted locally for audit review. | Local HTTP API, Web event timeline, and session store. | Demo-ready. | Add session replay UI, exportable audit logs, and structured observability. |
| Web client | Browser console for workspace path, execution mode, prompt, event stream, memory, and final output. | `apps/web`. | Demo-ready. | Add saved sessions, diff viewer, and configurable server URL. |
| Desktop client | Electron shell that hosts the Web experience after server and Web are available. | `apps/desktop`, `npm run dev:desktop`. | Demo-ready for local development. | Add packaged installers, signing, auto-update policy, and OS-specific QA. |
| CLI client | `doctor`, `ask`, and `memory` commands for terminal workflows. | `apps/cli`. | Demo-ready. | Add shell completion, config profiles, JSON output, and non-interactive CI mode. |
| Workspace safety | Path resolution prevents file tools from escaping the workspace; `.git`, `node_modules`, and `references/agents` are denied. | `workspace.ts`, safety tests. | MVP-ready. | Add OS-level sandboxing for shell, approval queues, and security regression tests. |
| Approval modes | `suggest`, `workspace-write`, and `full-access` control file and shell behavior. Tool approval mode can be `auto`, `manual`, or `deny`; manual pauses write, shell, and memory tools. | CLI options, server request policy, Web approval queue. | Demo-ready with documented limits. | Add richer approval audit metadata and team policy profiles. |
| Memory | Workspace memory persists under `.deepcodex/memory.md` and can be read from Web, CLI, and server API. `suggest` agent runs do not create workspace memory or session state. | `memory` tool, `/api/memory`, strict read-only tests. | Demo-ready. | Add memory review, redaction, and retention policy. |
| Reference research | Reference agent survey documents studied projects and clean-room constraints. | `docs/reference-agents.md`. | Ready for interview review. | Add a formal license review before external distribution. |

## Product Packages

| Package | Purpose | Current state | Release requirement |
| --- | --- | --- | --- |
| Interview artifact | Demonstrate architecture, product surface, safety model, and roadmap. | Ready after checklist passes. | Keep docs current, run tests, and prepare a short demo path. |
| Local pilot | Let a small internal team run the agent against disposable or low-risk repositories. | Plausible for controlled local trials. | Add approval audit metadata, session replay UI, shell isolation, and documented data handling. |
| Hosted product | Multi-user service with managed workspaces and auth. | Future work. | Add tenancy, RBAC, audit logs, secrets management, and infrastructure isolation. |

## Demo Narrative

1. Start with `npm run dev` and show the Web client connected to the local server.
2. Run a repository inspection prompt in `suggest` mode to demonstrate read-only planning.
3. Switch to `workspace-write` on a disposable branch or sample workspace for a small edit-and-test task.
4. Show the event timeline so tool calls are visible rather than hidden behind a chat transcript.
5. Load workspace memory and explain where it is stored.
6. Run `node apps/cli/dist/index.js doctor` and one CLI `ask` command to show parity with the Web client.
7. Close with the security model and roadmap, including gaps that are intentionally not claimed as complete.

## Success Criteria

An interview-ready build should satisfy these criteria:

- Fresh install works from the repository root.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Web, Desktop, and CLI clients can each run a basic prompt.
- Missing DeepSeek key produces clear demo-mode behavior.
- With a configured key, DeepSeek can perform a bounded workspace inspection.
- The presenter can explain approval modes, path restrictions, memory persistence, and shell limitations.
- Known commercial gaps are documented instead of hidden.
