# Security Model

DeepCodex is a local development product. Its current safety model is designed for transparent interview demos and trusted local workspaces, not for hostile multi-tenant execution.

## Trust Boundaries

| Boundary | Current behavior | Commercial requirement |
| --- | --- | --- |
| Local user to DeepCodex server | Server binds to `127.0.0.1` and exposes local HTTP APIs. | Add authentication before any non-local deployment. |
| DeepCodex to workspace files | File tools resolve paths under one workspace root, enforce denied paths and file-size limits, return unified diffs for write/edit operations, and can be paused by manual tool approval with recorded decision metadata and file hashes when available. | Add shell isolation and broader file-type policy. |
| DeepCodex to shell | Shell runs with the user's OS privileges from the workspace directory. | Add OS-level sandboxing or isolated execution workers. |
| DeepCodex to DeepSeek | API key is read from environment and sent as a bearer token to the configured base URL. Token usage is recorded when the provider returns usage metadata, and optional token/cost budgets can stop further work after a limit is reached. | Add secrets management, provider allowlists, and managed pricing policy. |
| Workspace memory and audit state | Memory is stored in `.deepcodex/memory.md`; session audit files are stored in `.deepcodex/state/sessions` and can be pruned by count or age. | Add review and redaction controls. |

## Approval Modes

| Mode | Current enforcement | Recommended demo use |
| --- | --- | --- |
| `suggest` | Shell commands are disabled. File write/edit tools return previews and do not apply changes. Read/search tools remain available. Agent runs do not create `.deepcodex` memory or session state. | Repository inspection, planning, and first-pass interview demo. |
| `workspace-write` | Enables file writes/edits inside workspace path controls and enables shell commands. Dangerous command patterns are blocked unless `full-access` is selected. | Small tasks on a disposable branch or sample repository. |
| `full-access` | Enables file writes/edits inside workspace path controls and allows shell commands with fewer command-pattern restrictions. | Only for controlled demonstrations where the workspace can be reset. |

## Tool Approval Modes

| Mode | Current enforcement | Recommended demo use |
| --- | --- | --- |
| `auto` | Mutating tools execute after workspace policy checks. | Fast demos in disposable workspaces. |
| `manual` | `write_file`, `edit_file`, `run_command`, and `append_memory` emit an approval request and wait for Web or CLI approval before execution. Approval events include request time, decision time, decision latency, actor, and before-file hashes for write/edit tools when available. | Interview demos where the reviewer wants to see safety gates. |
| `deny` | Mutating tool calls are denied after the approval event is recorded with a policy actor. | Dry runs that should prove no mutation can proceed. |

## File Access Controls

Implemented controls:

- Workspace paths are resolved with `path.resolve` and rejected if they escape the workspace root.
- `.git`, `node_modules`, `references/agents`, `.env`, `.env.*`, and `.deepcodex/state` are denied by default for file listing, reading, writing, editing, and search.
- `DEEPCODEX_DENIED_PATHS` can extend the default denied path patterns for controlled environments.
- File read, write, edit, and search tools enforce a configurable file-size limit through `DEEPCODEX_MAX_FILE_BYTES`; the default is 512 KiB.
- File read and edit tools reject files that appear to be binary; search skips binary-looking files.
- File write and edit tools return unified diffs; in `suggest` mode they preview without writing.
- File write and edit approval/tool events include SHA-256 file audit metadata. In preview mode, the proposed after-hash is recorded with `applied: false`; in write mode, before/after hashes are recorded with `applied: true`.
- Search and list operations are bounded to reduce runaway traversal.
- Large tool outputs are truncated before being returned to the model.

Current limitations:

- The shell tool is not constrained by the same path resolver after a command starts.
- A shell command can invoke external programs with the user's local permissions.
- The denial list is intentionally small and should become configurable for real pilots.
- Specialized generated-asset handling is basic.

## Shell Controls

Implemented controls:

- Shell commands are disabled in `suggest` mode.
- Commands run with `cwd` set to the workspace root.
- Shell timeout is capped at 180 seconds.
- A small dangerous-command pattern list requires `full-access`, including destructive delete and hard reset patterns.

Current limitations:

- This is command filtering, not an OS sandbox.
- Network access is not enforced for shell commands.
- Shell review can be per-command in manual approval mode, but shell execution is still not OS-sandboxed after approval.
- The pattern list cannot prove a command is safe.

## Network and Provider Controls

DeepCodex itself calls the configured DeepSeek-compatible endpoint for chat completions. There is no general network tool in the default tool registry, and the runtime policy currently sets `allowNetwork: false`.

Provider usage controls:

- Token budgets can be set with `DEEPCODEX_MAX_SESSION_TOKENS`, CLI flags, or the Web Budget panel.
- Estimated cost budgets can be set with `DEEPCODEX_MAX_SESSION_USD`, but require caller-provided input and output token prices.
- Budget state is emitted in the live event stream, persisted in session history, replayable in Web, and included in exports.
- Budget enforcement happens after provider usage metadata is returned, so it prevents additional work rather than preempting an in-flight model request.

Current limitations:

- Shell commands can still perform network operations if shell execution is allowed.
- The Web client currently assumes the local server runs on `127.0.0.1:17361`.
- CORS is open for local development and should be restricted before hosted use.

## Data Handling

| Data | Storage | Notes |
| --- | --- | --- |
| DeepSeek API key | Environment or `.env` file. | Do not commit `.env`; `.env.example` contains only placeholders. |
| Prompts and tool outputs | In memory during the local run, visible in client event streams, replayable in the Web client, persisted locally under `.deepcodex/state/sessions`, and prunable by retention policy. | Add export review controls and redaction. |
| Workspace memory | `.deepcodex/memory.md` in the selected workspace. | Treat it as project data and review before sharing the workspace. |
| Reference repositories | `references/agents`, ignored by git. | Used for architecture study only; avoid copying source into product code. |

## Security Roadmap

The next security work should prioritize:

- Richer generated-asset handling and file-type policies.
- Policy profile metadata.
- Redaction policy for prompts, tool outputs, and audit exports.
- Managed provider pricing profiles for budget policy.
- Isolated shell execution with filesystem and network controls.
- Auth, RBAC, and tenant isolation before hosted deployment.
- Secrets redaction in event streams and saved logs.
