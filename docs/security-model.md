# Security Model

DeepCodex is a local development product. Its current safety model is designed for transparent interview demos and trusted local workspaces, not for hostile multi-tenant execution.

## Trust Boundaries

| Boundary | Current behavior | Commercial requirement |
| --- | --- | --- |
| Local user to DeepCodex server | Server binds to `127.0.0.1` and exposes local HTTP APIs. | Add authentication before any non-local deployment. |
| DeepCodex to workspace files | File tools resolve paths under one workspace root and return unified diffs for write/edit operations. | Add interactive diff approval and stricter read-only mode. |
| DeepCodex to shell | Shell runs with the user's OS privileges from the workspace directory. | Add OS-level sandboxing or isolated execution workers. |
| DeepCodex to DeepSeek | API key is read from environment and sent as a bearer token to the configured base URL. | Add secrets management, provider allowlists, and token accounting. |
| Workspace memory | Memory is stored in `.deepcodex/memory.md` inside the target workspace. | Add retention, review, redaction, and export controls. |

## Approval Modes

| Mode | Current enforcement | Recommended demo use |
| --- | --- | --- |
| `suggest` | Shell commands are disabled. File write/edit tools return previews and do not apply changes. Read/search tools remain available. Workspace memory may still be created as product state. | Repository inspection, planning, and first-pass interview demo. |
| `workspace-write` | Enables file writes/edits inside workspace path controls and enables shell commands. Dangerous command patterns are blocked unless `full-access` is selected. | Small tasks on a disposable branch or sample repository. |
| `full-access` | Enables file writes/edits inside workspace path controls and allows shell commands with fewer command-pattern restrictions. | Only for controlled demonstrations where the workspace can be reset. |

## File Access Controls

Implemented controls:

- Workspace paths are resolved with `path.resolve` and rejected if they escape the workspace root.
- `.git`, `node_modules`, and `references/agents` are denied for file listing, reading, writing, editing, and search.
- File write and edit tools return unified diffs; in `suggest` mode they preview without writing.
- Search and list operations are bounded to reduce runaway traversal.
- Large tool outputs are truncated before being returned to the model.

Current limitations:

- The shell tool is not constrained by the same path resolver after a command starts.
- A shell command can invoke external programs with the user's local permissions.
- The denial list is intentionally small and should become configurable for real pilots.
- Binary and large-file handling is basic.

## Shell Controls

Implemented controls:

- Shell commands are disabled in `suggest` mode.
- Commands run with `cwd` set to the workspace root.
- Shell timeout is capped at 180 seconds.
- A small dangerous-command pattern list requires `full-access`, including destructive delete and hard reset patterns.

Current limitations:

- This is command filtering, not an OS sandbox.
- Network access is not enforced for shell commands.
- Command review is mode-level rather than per-command approval.
- The pattern list cannot prove a command is safe.

## Network and Provider Controls

DeepCodex itself calls the configured DeepSeek-compatible endpoint for chat completions. There is no general network tool in the default tool registry, and the runtime policy currently sets `allowNetwork: false`.

Current limitations:

- Shell commands can still perform network operations if shell execution is allowed.
- The Web client currently assumes the local server runs on `127.0.0.1:17361`.
- CORS is open for local development and should be restricted before hosted use.

## Data Handling

| Data | Storage | Notes |
| --- | --- | --- |
| DeepSeek API key | Environment or `.env` file. | Do not commit `.env`; `.env.example` contains only placeholders. |
| Prompts and tool outputs | In memory during the local run, visible in client event streams, and persisted locally under `.deepcodex/state/sessions`. | Add session replay UI, retention controls, and redaction. |
| Workspace memory | `.deepcodex/memory.md` in the selected workspace. | Treat it as project data and review before sharing the workspace. |
| Reference repositories | `references/agents`, ignored by git. | Used for architecture study only; avoid copying source into product code. |

## Security Roadmap

The next security work should prioritize:

- Per-tool human approval with exact command and diff preview.
- Strict read-only mode that does not create or append workspace memory.
- Configurable denied paths and file-size limits.
- Structured audit log for approvals and file hashes.
- Isolated shell execution with filesystem and network controls.
- Auth, RBAC, and tenant isolation before hosted deployment.
- Secrets redaction in event streams and saved logs.
