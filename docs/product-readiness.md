# Product Readiness

DeepCodex is currently an interview-ready local product slice. It is suitable for demonstrating architecture, DeepSeek integration, multi-client operation, and a documented safety model. It should not yet be described as a hosted enterprise product.

## Ready Now

- Clean TypeScript monorepo structure.
- DeepSeek-compatible agent loop with function tools.
- Workspace-scoped file read, write, edit, search, shell, and memory tools.
- Web, Desktop, and CLI clients using the same core agent.
- Local event stream for transparent tool execution.
- Persisted local session history and audit files under `.deepcodex/state/sessions`.
- Web session replay for inspecting saved event timelines from recent runs.
- Markdown and JSON session export through core, server, Web, and CLI surfaces.
- Session history retention pruning by count or age, with dry-run support in CLI and Web/API surfaces.
- Diff output for file writes and edits; `suggest` mode previews write/edit changes without applying them.
- Manual tool approval for workspace write, shell, and memory mutation tools in Web and CLI clients.
- Approval audit events include request time, decision time, decision latency, and actor.
- File write/edit approvals and tool results include SHA-256 file audit metadata when file paths can be resolved.
- Token usage events are recorded when the provider returns usage metadata.
- Run-level token and estimated cost budgets can stop additional tool or model work after provider usage reaches the configured limit.
- Strict read-only `suggest` runs that avoid creating `.deepcodex` memory or session state.
- Demo mode when `DEEPSEEK_API_KEY` is missing.
- Basic workspace guardrails for path traversal and denied folders.
- Configurable denied path patterns with `**` support, default protection for nested env files, generated/build output, reference repos, and session audit state.
- Configurable file-size limits for read, write, edit, and search tools.
- Binary-aware read, edit, and search handling for non-text files.
- Minimal shell environment mode by default, with explicit `inherit` opt-in for trusted workspaces.
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

## Readiness Levels

| Level | Status | Notes |
| --- | --- | --- |
| Interview demo | Ready when checklist passes. | Shows a coherent local coding-agent product with honest limitations. |
| Local pilot | Close, but still controlled. | Has local audit history, retention pruning, diff-producing tools, file hash audit metadata, manual approvals, strict read-only inspection, and minimal shell env; still needs OS-level sandboxed shell. |
| Desktop release | Not ready by default. | Needs packaged installers, signing, and OS smoke tests. |
| Hosted deployment | Future work. | Needs auth, tenancy, isolated execution, audit retention, and secrets controls. |

## Next Commercial Milestones

- Add reusable policy profiles.
- Add redaction policies and richer media/artifact-type handling.
- Add richer generated-asset handling and file-type policies.
- Add managed pricing profiles and per-workspace budget policy templates.
- Add packaged desktop installers and signed releases.
- Add benchmark tasks and regression evals inspired by the reference repos.
- Add auth, RBAC, audit logs, and workspace tenancy before hosted deployment.
