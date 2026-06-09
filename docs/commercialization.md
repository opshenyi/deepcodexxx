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
| Agent loop | DeepSeek-compatible chat completions loop with tool calls, bounded steps, provider retry/backoff for retryable failures, policy-controlled fallback models after retry exhaustion, token usage events, and run-level token/cost budgets when the provider returns usage metadata. Cost budgets can use direct prices or caller-managed pricing profiles. | `packages/core` agent, DeepSeek client, budget controls, pricing profiles, and tool registry. | Demo-ready. | Add richer provider failure classification and provider registry metadata. |
| Provider setup | Environment-driven DeepSeek API key and base URL, plus environment or workspace-config defaults for model, fallback models, approved provider base URLs, approved models, team policy profiles, selected policy profile, pricing profile, max steps, custom redaction/DLP patterns, secret-write policy, shell network access, shell command allow/deny patterns, workspace config SHA-256 provenance, policy-bundle key generation, signing, verification, trust package export, Web/Desktop status display, key rotation/revocation controls, and env-controlled signed-only enforcement. Missing key falls back to local demo mode. | `.env.example`, `.deepcodex/config.json` loader, policy-bundle keypair/sign/verify/export CLI, server verification API, provider policy enforcement, `DeepSeekClient`, CLI `doctor`, CLI `config show/init/generate-keypair/sign-bundle/verify-bundle/export-trust-package`, Web `Load config`, Web Policy bundle panel. | Demo-ready. | Add provider registry, secrets management, and managed trust package distribution channels. |
| Workspace tools | List, read, search, write, edit, shell command, read memory, append memory, metadata-only artifact inspection, policy-controlled ZIP archive entry listing, and policy-controlled PDF text extraction. Write and edit tools block probable secrets by default before producing diffs, then return unified diffs plus before/after SHA-256 audit metadata for accepted changes; `suggest` mode previews without applying. File tools enforce a configurable size cap, avoid binary-looking files for read/edit/search, skip common generated/build output paths, and deny common media/artifact extensions by default. Shell commands return failed tool results for non-zero exits, timeouts, signals, and output overflow. `inspect_artifact` respects denied paths and returns type hints, size, sample hash, and simple dimensions without raw content. `list_archive_entries` is default-off, reads bounded ZIP central-directory metadata, omits denied entries, and never extracts member content. `extract_pdf_text` is default-off, respects denied paths and `maxFileBytes`, caps pages and characters, and never returns raw PDF bytes, images, attachments, or embedded files. | Default tool registry in `packages/core`. | Demo-ready for local repositories. | Add policy-controlled OCR, richer archive analysis, and malware scanning. |
| Execution transparency | Server sends event-stream updates for session, provider fallback selection, model usage, budget updates, budget stops, approval request, approval decision, tool start, tool result, final answer, and errors. Events are redacted for common secret patterns and workspace-specific regex patterns before streaming/persistence. Write/edit tools block probable secrets and workspace DLP pattern matches before diff output unless `allowSecretWrites` is explicitly enabled. Sessions are persisted locally, replayable in the Web client, exportable as Markdown or JSON, and prunable by count or age with dry-run support. Web timelines and replays render provider fallback and unified diffs as structured rows, with a split before/after review mode for focused file changes while preserving file audit text. Release evidence reports aggregate config, policy, eval, security scan, provider-key, and session signals for demo/CI artifacts; distribution preflight reports check delivery readiness across scripts, clients, CLI bin/completion readiness, artifacts, docs, Desktop bootstrap, and ignored local state. Web/Desktop can download Markdown release evidence and preflight reports from the same server exporters used by CLI/API. | Local HTTP API, Web event timeline and replay view, release evidence and preflight API/panels/downloads, CLI export/prune, workspace config, and session store. | Demo-ready. | Add structured observability and richer DLP classification. |
| Web client | Browser console for workspace path, runtime server URL, saved workspace profiles, execution mode, prompt, event stream, unified/split structured diff review, workspace policy summary, release evidence report/download, distribution preflight report/download, policy-bundle trust status, eval evidence report, security scan, session replay, audit export, memory, and final output. | `apps/web`. | Demo-ready. | Add richer review analytics, semantic eval scoring, and team-shared profile distribution. |
| Desktop client | Electron shell that hosts the Web experience in dev mode, and production-like launches can bootstrap the built local server before loading the built Web client. | `apps/desktop`, `npm run dev:desktop`, `npm run start:desktop`. | Demo-ready for local development and production-like smoke tests. | Add packaged installers, signing, auto-update policy, and OS-specific QA. |
| CLI client | `doctor`, `ask`, `memory`, `evals`, `release evidence`, `release preflight`, `security scan`, `sessions list/show/export`, and `completion` commands for terminal workflows. `ask --json` emits NDJSON event/result records for automation, `doctor --json` emits structured diagnostics with optional CI requirement gates for API key, workspace config, and trusted policy bundle, CLI completion emits bash/zsh/PowerShell scripts or a JSON spec, and CLI evals provide built-in plus workspace-defined read-only smoke tasks with exact expected-signal scoring, optional recorded history, run-to-run comparison, and aggregated release reports. | `apps/cli`, `docs/evals.md`. | Demo-ready. | Add packaged binary polish, semantic eval scoring, and larger benchmark suites. |
| Workspace safety | Path resolution prevents file tools from escaping the workspace; denied path patterns protect `.git`, `node_modules`, nested env files, generated/build output, reference repos, and session audit state by default; extension policies protect common binary/media/artifact files; file-size limits reduce runaway context and memory usage; read-only security scans can report existing probable-secret metadata without returning values; shell tools default to a minimal child-process environment, can run in an audited temporary workspace copy, enforce workspace-configured command allow/deny regex gates, block common network commands unless explicitly enabled, cap runtime, cap output, and terminate process trees on timeout or output overflow. Server CORS can be restricted by origin for browser clients. | `workspace.ts`, `safety.ts`, sensitive scan tests, shell tool tests, server CORS configuration. | MVP-ready. | Add kernel-level sandboxing for shell and broader security regression tests. |
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
2. Load workspace config and show the Workspace policy panel so reviewer-visible policy matches the selected repository.
3. Run a repository inspection prompt in `suggest` mode to demonstrate read-only planning.
4. Switch to `workspace-write` on a disposable branch or sample workspace for a small edit-and-test task.
5. Show the event timeline so tool calls are visible rather than hidden behind a chat transcript.
6. Load sessions, replay a previous run, and export it to show the saved audit trail.
7. Load release evidence, distribution preflight, eval evidence, and security scan panels to show release signals, delivery checks, and preflight safety checks; download the Markdown evidence reports for a reviewer handoff.
8. Load workspace memory and explain where it is stored.
9. Run `node apps/cli/dist/index.js doctor` and one CLI `ask` command to show parity with the Web client.
10. Close with the security model and roadmap, including gaps that are intentionally not claimed as complete.

## Success Criteria

An interview-ready build should satisfy these criteria:

- Fresh install works from the repository root.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Web, Desktop, and CLI clients can each run a basic prompt.
- Desktop production-like launch can start the local server without a separate server terminal.
- Reusable policy profiles can be selected from Web/Desktop and CLI.
- Workspace-defined team policy profiles can be listed from CLI/API and loaded into Web/Desktop controls.
- The Web client can load and replay a persisted session history.
- The Web client renders persisted unified diffs as structured review blocks, can switch to split before/after review, and keeps file audit metadata readable.
- The Web client can save, apply, and remove local workspace profiles for workspace/server/policy setup.
- A persisted session can be exported as Markdown or JSON.
- Session history retention can be previewed and applied by count or age.
- Write and edit approvals include file hash audit evidence in the run history.
- Token and cost budgets can be configured from Web, CLI, or environment variables.
- Pricing profiles can be listed from CLI/API and selected for cost-budget runs.
- CLI `doctor --json --require-*` can fail CI preflights when required API key, workspace config, or trusted policy bundle conditions are not met.
- Evals can run repeatable built-in and workspace-defined read-only smoke tasks, emit machine-readable eval records, optionally persist local eval history, compare recorded runs, aggregate reports through CLI/API/Web, and fail CI gates with `--min-score` or `--require-pass`.
- Release evidence reports can aggregate config, policy, eval, security scan, provider-key, and session signals into one JSON or Markdown artifact.
- Distribution preflight reports can check scripts, build outputs, CLI bin/completion readiness, Desktop bootstrap safety, docs, and ignored local-state paths from CLI/API/Web.
- Web/Desktop can download Markdown release evidence and distribution preflight reports from the right rail.
- CLI shell completion scripts can be generated for PowerShell, bash, and zsh, with a JSON spec for packaging checks.
- Workspace config can be shown from CLI and loaded from Web to apply repository defaults.
- PDF text extraction stays blocked by default, can be enabled through Web/CLI/env/workspace policy, and returns bounded text without raw bytes.
- Workspace config SHA-256 can be recorded from CLI/API/Web to identify the policy file used in a demo.
- Signed policy bundles can be created from CLI and verify that the active config SHA-256 was signed by a trusted Ed25519 public key.
- Web/Desktop can display the selected workspace policy-bundle verification result without handling signing private keys in the browser runtime.
- `DEEPCODEX_REQUIRE_SIGNED_POLICY=true` can require trusted policy-bundle verification before CLI/server agent runs.
- Provider/model allowlists can block unapproved base URLs, primary model ids, or fallback model ids before a run starts.
- Shell network access defaults to blocked and can be enabled explicitly for trusted package install or remote git tasks.
- Workspace shell command allow/deny policies can restrict team profiles to approved command sets without bypassing built-in dangerous/network gates.
- Probable secret writes are blocked by default and can be enabled only through explicit trusted policy.
- Existing probable-secret scans can run from CLI and Web/Desktop without echoing matched secret values.
- Missing DeepSeek key produces clear demo-mode behavior.
- With a configured key, DeepSeek can perform a bounded workspace inspection.
- Retryable provider failures are retried with bounded exponential backoff and can move to approved fallback models before surfacing a clear error.
- The presenter can explain approval modes, path restrictions, memory persistence, and shell limitations.
- Known commercial gaps are documented instead of hidden.
