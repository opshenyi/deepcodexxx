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
| Agent loop | DeepSeek-compatible chat completions loop with tool calls, bounded steps, provider retry/backoff for retryable failures, token usage events, and run-level token/cost budgets when the provider returns usage metadata. Cost budgets can use direct prices or caller-managed pricing profiles. | `packages/core` agent, DeepSeek client, budget controls, pricing profiles, and tool registry. | Demo-ready. | Add richer provider failure classification and fallback model policy. |
| Provider setup | Environment-driven DeepSeek API key and base URL, plus environment or workspace-config defaults for model, approved provider base URLs, approved models, team policy profiles, selected policy profile, pricing profile, max steps, custom redaction/DLP patterns, secret-write policy, shell network access, workspace config SHA-256 provenance, policy-bundle key generation, signing, and verification with key rotation/revocation controls, and env-controlled signed-only enforcement. Missing key falls back to local demo mode. | `.env.example`, `.deepcodex/config.json` loader, policy-bundle keypair/sign/verify CLI, provider policy enforcement, `DeepSeekClient`, CLI `doctor`, CLI `config show/init/generate-keypair/sign-bundle/verify-bundle`, Web `Load config`. | Demo-ready. | Add provider registry, secrets management, and higher-level policy administration UI. |
| Workspace tools | List, read, search, write, edit, shell command, read memory, append memory, metadata-only artifact inspection, and policy-controlled ZIP archive entry listing. Write and edit tools block probable secrets by default before producing diffs, then return unified diffs plus before/after SHA-256 audit metadata for accepted changes; `suggest` mode previews without applying. File tools enforce a configurable size cap, avoid binary-looking files for read/edit/search, skip common generated/build output paths, and deny common media/artifact extensions by default. Shell commands return failed tool results for non-zero exits, timeouts, signals, and output overflow. `inspect_artifact` respects denied paths and returns type hints, size, sample hash, and simple dimensions without raw content. `list_archive_entries` is default-off, reads bounded ZIP central-directory metadata, omits denied entries, and never extracts member content. | Default tool registry in `packages/core`. | Demo-ready for local repositories. | Add policy-controlled OCR, PDF text extraction, richer archive analysis, and malware scanning. |
| Execution transparency | Server sends event-stream updates for session, model usage, budget updates, budget stops, approval request, approval decision, tool start, tool result, final answer, and errors. Events are redacted for common secret patterns and workspace-specific regex patterns before streaming/persistence. Write/edit tools block probable secrets and workspace DLP pattern matches before diff output unless `allowSecretWrites` is explicitly enabled. Sessions are persisted locally, replayable in the Web client, exportable as Markdown or JSON, and prunable by count or age with dry-run support. Web timelines and replays render unified diffs as structured add/remove/header rows while preserving file audit text. | Local HTTP API, Web event timeline and replay view, CLI export/prune, workspace config, and session store. | Demo-ready. | Add structured observability and richer DLP classification. |
| Web client | Browser console for workspace path, runtime server URL, execution mode, prompt, event stream, structured diff review, session replay, audit export, memory, and final output. | `apps/web`. | Demo-ready. | Add saved workspace profiles and richer side-by-side review affordances. |
| Desktop client | Electron shell that hosts the Web experience in dev mode, and production-like launches can bootstrap the built local server before loading the built Web client. | `apps/desktop`, `npm run dev:desktop`, `npm run start:desktop`. | Demo-ready for local development and production-like smoke tests. | Add packaged installers, signing, auto-update policy, and OS-specific QA. |
| CLI client | `doctor`, `ask`, `memory`, and `sessions list/show/export` commands for terminal workflows. `ask --json` emits NDJSON event/result records for automation, and `doctor --json` emits structured diagnostics. | `apps/cli`. | Demo-ready. | Add shell completion and broader CI packaging polish. |
| Workspace safety | Path resolution prevents file tools from escaping the workspace; denied path patterns protect `.git`, `node_modules`, nested env files, generated/build output, reference repos, and session audit state by default; extension policies protect common binary/media/artifact files; file-size limits reduce runaway context and memory usage; shell tools default to a minimal child-process environment, can run in an audited temporary workspace copy, block common network commands unless explicitly enabled, cap runtime, cap output, and terminate process trees on timeout or output overflow. Server CORS can be restricted by origin for browser clients. | `workspace.ts`, `safety.ts`, shell tool tests, server CORS configuration. | MVP-ready. | Add kernel-level sandboxing for shell and broader security regression tests. |
| Approval modes | `suggest`, `workspace-write`, and `full-access` control file and shell behavior. Built-in reusable profiles (`inspection`, `guarded-write`, `full-access-review`) bundle execution mode, approval default, max steps, shell environment, and default network-denied shell policy. Workspace config can define team policy profiles and choose the default profile and approval mode. Tool approval mode can be `auto`, `manual`, or `deny`; manual pauses write, shell, and memory tools, and approval events record actor, request time, decision time, latency, and before-file hashes for file edits when available. | CLI options, server request policy, Web profile selector, Web approval queue and replay view. | Demo-ready with documented limits. | Add kernel-level shell isolation and broader approval analytics. |
| Memory | Workspace memory persists under `.deepcodex/memory.md` and can be read from Web, CLI, and server API. `suggest` agent runs do not create workspace memory or session state. | `memory` tool, `/api/memory`, strict read-only tests. | Demo-ready. | Add memory review, redaction, and retention policy. |
| Reference research | Reference agent survey documents studied projects and clean-room constraints. | `docs/reference-agents.md`. | Ready for interview review. | Add a formal license review before external distribution. |

## Product Packages

| Package | Purpose | Current state | Release requirement |
| --- | --- | --- | --- |
| Interview artifact | Demonstrate architecture, product surface, safety model, and roadmap. | Ready after checklist passes. | Keep docs current, run tests, and prepare a short demo path. |
| Local pilot | Let a small internal team run the agent against disposable or low-risk repositories. | Plausible for controlled local trials. | Add kernel-level shell sandboxing, project-specific DLP, and documented data handling. |
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
- Desktop production-like launch can start the local server without a separate server terminal.
- Reusable policy profiles can be selected from Web/Desktop and CLI.
- Workspace-defined team policy profiles can be listed from CLI/API and loaded into Web/Desktop controls.
- The Web client can load and replay a persisted session history.
- The Web client renders persisted unified diffs as structured review blocks while keeping file audit metadata readable.
- A persisted session can be exported as Markdown or JSON.
- Session history retention can be previewed and applied by count or age.
- Write and edit approvals include file hash audit evidence in the run history.
- Token and cost budgets can be configured from Web, CLI, or environment variables.
- Pricing profiles can be listed from CLI/API and selected for cost-budget runs.
- Workspace config can be shown from CLI and loaded from Web to apply repository defaults.
- Workspace config SHA-256 can be recorded from CLI/API/Web to identify the policy file used in a demo.
- Signed policy bundles can be created from CLI and verify that the active config SHA-256 was signed by a trusted Ed25519 public key.
- `DEEPCODEX_REQUIRE_SIGNED_POLICY=true` can require trusted policy-bundle verification before CLI/server agent runs.
- Provider/model allowlists can block unapproved base URLs or model ids before a run starts.
- Shell network access defaults to blocked and can be enabled explicitly for trusted package install or remote git tasks.
- Probable secret writes are blocked by default and can be enabled only through explicit trusted policy.
- Missing DeepSeek key produces clear demo-mode behavior.
- With a configured key, DeepSeek can perform a bounded workspace inspection.
- Retryable provider failures are retried with bounded exponential backoff before surfacing a clear error.
- The presenter can explain approval modes, path restrictions, memory persistence, and shell limitations.
- Known commercial gaps are documented instead of hidden.
