# Product Readiness

DeepCodex is currently an interview-ready local product slice. It is suitable for demonstrating architecture, DeepSeek integration, multi-client operation, and a documented safety model. It should not yet be described as a hosted enterprise product.

## Ready Now

- Clean TypeScript monorepo structure.
- DeepSeek-compatible agent loop with function tools.
- DeepSeek-compatible provider retry/backoff for retryable status codes and network failures.
- Workspace-scoped file read, write, edit, search, shell, and memory tools.
- Web, Desktop, and CLI clients using the same core agent.
- Desktop production-like startup can bootstrap the built local server and load the built Web client.
- Web client can use the default local API base, `VITE_DEEPCODEX_SERVER_URL`, or a saved runtime Server URL from the sidebar.
- Server CORS can remain permissive for local development or be restricted by `DEEPCODEX_CORS_ORIGINS` for controlled demos.
- Workspace-level `.deepcodex/config.json` defaults for model, provider base URL, provider/model allowlists, custom team policy profiles, default policy profile, approval mode, max steps, budget, pricing profile, file policy additions, custom redaction/DLP patterns, secret-write policy, shell environment, shell network access, and retention.
- Workspace config SHA-256 fingerprints in CLI/API/Web config loading for policy provenance.
- Optional signed policy-bundle verification for the active workspace config SHA-256 through core, CLI, and server API.
- CLI policy-bundle key generation and signing workflow for creating an Ed25519 keypair and signing `.deepcodex/policy-bundle.json` from the active workspace config with an external private key.
- Web/Desktop policy-bundle status panel that checks the selected workspace through the local server and shows trust, signature, issuer, expiry, config hash, bundle hash, signing-key hash, and verification reason.
- Env-controlled signed-only policy enforcement for CLI/server agent runs.
- Policy-bundle trust policy supports multiple trusted public keys, bundle revocation, signing-key revocation, and trusted issuer allowlists.
- Built-in reusable policy profiles for inspection, guarded write, and full-access review runs, plus workspace-defined team policy profiles.
- Provider/model allowlists that block unapproved base URLs or model selections before an agent run.
- Local event stream for transparent tool execution.
- Persisted local session history and audit files under `.deepcodex/state/sessions`.
- Web session replay for inspecting saved event timelines from recent runs.
- Structured Web diff rendering for live event output, approval details, and session replay, with multi-file unified diffs split into readable blocks.
- Markdown and JSON session export through core, server, Web, and CLI surfaces.
- CLI `ask --json` and `doctor --json` for machine-readable event streams and environment diagnostics, with optional `doctor --require-*` gates that return non-zero exit codes for CI preflight requirements.
- Built-in read-only CLI smoke evals for repository mapping, safety review, and release-evidence review, with exact expected-signal scoring, CI threshold flags, and optional recorded local eval history.
- Session history retention pruning by count or age, with dry-run support in CLI and Web/API surfaces.
- Event redaction for common secret assignments, bearer headers, and token literals before streaming/persistence.
- Workspace-specific custom redaction regex patterns for project identifiers or secret formats not covered by built-ins.
- Write-time DLP blocking for probable secrets and workspace-defined DLP patterns before file diffs or writes are returned.
- Diff output for file writes and edits; `suggest` mode previews write/edit changes without applying them.
- Manual tool approval for workspace write, shell, and memory mutation tools in Web and CLI clients.
- Approval audit events include request time, decision time, decision latency, and actor.
- File write/edit approvals and tool results include SHA-256 file audit metadata when file paths can be resolved.
- Token usage events are recorded when the provider returns usage metadata.
- Run-level token and estimated cost budgets can stop additional tool or model work after provider usage reaches the configured limit.
- Caller-managed pricing profiles can provide reusable input/output token prices for cost estimates without hard-coding provider prices.
- Strict read-only `suggest` runs that avoid creating `.deepcodex` memory or session state.
- Demo mode when `DEEPSEEK_API_KEY` is missing.
- Basic workspace guardrails for path traversal and denied folders.
- Configurable denied path patterns with `**` support, default protection for nested env files, generated/build output, reference repos, and session audit state.
- Configurable denied media/artifact extensions with default protection for common binary, archive, Office/PDF, executable, library, and WebAssembly file types.
- Safe `inspect_artifact` tool for metadata-only inspection of non-text artifacts without exposing raw bytes to the model.
- Default-off `list_archive_entries` tool for bounded ZIP-compatible archive manifests without extraction, decompression, or member content exposure.
- Configurable file-size limits for read, write, edit, and search tools.
- Binary-aware read, edit, and search handling for non-text files.
- Minimal shell environment mode by default, with explicit `inherit` opt-in for trusted workspaces.
- Optional audited `workspace-copy` shell execution mode that runs commands from a bounded temporary workspace snapshot and removes it after execution.
- Network-aware shell command policy blocks common package install, git network, and network utility commands by default unless network access is explicitly enabled.
- Shell command non-zero exits, timeouts, termination signals, and output overflows are surfaced as failed tool results instead of successful output text.
- Reference repositories documented for architecture study.
- Commercialization, runbook, security model, release checklist, and roadmap docs.

## Interview-Ready Evidence

| Evidence | Where to review | What it demonstrates |
| --- | --- | --- |
| Capability matrix | `docs/commercialization.md` | Implemented product surface and commercial gaps. |
| Runtime instructions | `docs/runbook.md` | Web, Desktop, CLI, and DeepSeek setup. |
| Security model | `docs/security-model.md` | Trust boundaries, approval modes, and known limits. |
| Release checklist | `docs/release-checklist.md` | Repeatable demo and smoke-test path. |
| Roadmap | `docs/roadmap.md` | Sequenced path from interview artifact to pilot and hosted product. |
| Reference survey | `docs/reference-agents.md` | Clean-room research notes and product influences. |
| Built-in evals | `docs/evals.md` | Repeatable read-only CLI smoke tasks, scoring behavior, CI thresholds, optional local history, and current scoring limits. |

## Readiness Levels

| Level | Status | Notes |
| --- | --- | --- |
| Interview demo | Ready when checklist passes. | Shows a coherent local coding-agent product with honest limitations. |
| Local pilot | Close, but still controlled. | Has local audit history, workspace config defaults, retention pruning, diff-producing tools, Web diff review, write-time secret blocking, file hash audit metadata, manual approvals, strict read-only inspection, minimal shell env, audited workspace-copy shell execution, and default shell network blocking; still needs kernel-level shell sandboxing for high-trust pilots. |
| Desktop release | Closer, but not installer-ready. | Has production-like local server bootstrap; still needs packaged installers, signing, and OS smoke tests. |
| Hosted deployment | Future work. | Needs auth, tenancy, isolated execution, audit retention, and secrets controls. |

## Next Commercial Milestones

- Add higher-level policy-bundle distribution workflows and richer provider fallback policy.
- Add richer DLP classification and policy-controlled OCR/PDF extraction.
- Add richer generated-asset handling and file-type policies.
- Add kernel-level shell sandboxing or remote isolated execution workers.
- Add packaged desktop installers, signed releases, and auto-update policy.
- Add benchmark tasks and regression evals inspired by the reference repos.
- Add auth, RBAC, audit logs, and workspace tenancy before hosted deployment.
