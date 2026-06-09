# Release and Demo Checklist

Use this checklist before presenting DeepCodex as an interview artifact or sharing a local pilot build.

## Scope Check

- Confirm the release scope: interview demo, local pilot, or hosted prototype.
- Confirm no secrets are present in `.env.example`, docs, screenshots, or terminal history.
- Confirm reference repositories remain under `references/agents` and are not copied into product code.
- Confirm known limitations from `docs/security-model.md` are acceptable for the demo audience.

## Build Verification

Run from the repository root:

```powershell
npm install
npm run typecheck
npm test
npm run build
node apps/cli/dist/index.js doctor
```

Expected result:

- TypeScript project references pass.
- Vitest test suite passes.
- Build completes for all workspaces with build scripts.
- CLI `doctor` reports the intended DeepSeek base URL and model.
- CLI `doctor` reports configured budget environment values when present.
- CLI `doctor` reports shell environment mode, defaulting to `minimal`.
- CLI `profiles list` reports `inspection`, `guarded-write`, and `full-access-review`.
- CLI `pricing list` reports configured pricing profiles, or clearly says none are configured.
- API key status is understood: `configured` for live demos, `missing` for local demo mode.

## Web Demo Verification

```powershell
npm run dev
```

Checklist:

- `http://127.0.0.1:17361/api/health` returns `ok: true`.
- `http://127.0.0.1:5173` loads the Web client.
- Workspace path can be entered and saved in the browser.
- Policy profile selector can switch between Inspection, Guarded write, and Full access review.
- `suggest` mode can run a repository inspection prompt.
- Event stream shows session start, steps, tool calls, and final output.
- Manual approval events show decision source and latency when a mutating tool is approved or denied.
- Write/edit approval and tool result events show file hash audit metadata when a file path is involved.
- Budget controls can be set in the sidebar and budget events appear when provider usage metadata is available.
- Pricing profile selector appears in the Budget panel when pricing profiles are configured.
- Event stream and exports redact common secret patterns in tool output and assistant text.
- `Load memory` returns either existing memory or the empty-memory state.
- `Load sessions` shows recent runs, `Replay` opens a saved timeline, and `Export` creates a Markdown audit file without console errors.
- Audit retention dry-run can preview sessions that would be pruned before deletion is applied.
- A missing API key produces the documented local demo response.

Suggested safe prompt:

```text
Inspect this repository and summarize the safest next implementation step. Do not modify files.
```

## Desktop Demo Verification

```powershell
npm run dev:desktop
```

Checklist:

- Server and Web client both start.
- Electron window opens the DeepCodex experience.
- The same workspace and prompt used in the Web demo can run from Desktop.
- Window close and process shutdown do not leave confusing orphaned terminals for the presenter.

## CLI Demo Verification

```powershell
npm run build
node apps/cli/dist/index.js doctor
node apps/cli/dist/index.js profiles list
node apps/cli/dist/index.js pricing list
node apps/cli/dist/index.js memory --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --profile inspection "Inspect this repository and list the main product surfaces."
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest --max-session-tokens 20000 "Inspect this repository with a token budget."
```

Checklist:

- CLI prints configuration through `doctor`.
- `memory` reads workspace memory without crashing.
- `ask` prints session, step, tool, and final output events.
- Budgeted `ask` prints budget status when the provider returns usage metadata.
- `--mode suggest` does not allow shell or file write/edit tools.
- Shell-capable demos use `--shell-env minimal` unless a trusted task explicitly needs inherited environment variables.

## Write-Mode Demo Verification

Only run write-mode demos on a disposable branch, sample workspace, or throwaway copy.

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --max-steps 12 "Make a small documentation-only improvement and summarize the change."
```

Checklist:

- The task scope is narrow and reversible.
- The presenter can explain which files changed.
- Tests or typecheck are run after any product-code change.
- Session replay/export includes before/after file hash audit metadata for write/edit tools.
- Retention prune is dry-run first if the workspace contains useful demo history.
- Generated memory is reviewed before sharing the workspace.

## Go/No-Go Criteria

| Check | Go | No-go |
| --- | --- | --- |
| Build | `typecheck`, tests, and build pass. | Any required verification fails without explanation. |
| DeepSeek | API key status matches the planned demo mode. | Presenter expects live model behavior but `doctor` reports missing key. |
| Ports | Web and server are available at `5173` and `17361`. | Port conflict blocks Web or Desktop demo. |
| Safety | Demo starts in `suggest` mode and write mode uses disposable workspace. | Write/full-access mode is run on important uncommitted work. |
| Docs | Commercial gaps and security limits are documented. | Demo claims hosted, sandboxed, or enterprise features that are not implemented. |

## Release Notes Template

```markdown
# DeepCodex Release Notes

## Scope

- Release type:
- Intended audience:
- Supported clients:

## Verification

- npm run typecheck:
- npm test:
- npm run build:
- CLI doctor:
- Web smoke test:
- Desktop smoke test:

## Known Limitations

- 

## Demo Script

- 
```

## Post-Demo Cleanup

- Stop server, Web, Desktop, and CLI processes.
- Remove or archive disposable workspaces.
- Review `.deepcodex/memory.md` before sharing a workspace.
- Remove temporary screenshots or logs that include prompts, file paths, or API status.
