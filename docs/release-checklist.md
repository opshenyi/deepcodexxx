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
- API key status is understood: `configured` for live demos, `missing` for local demo mode.

## Web Demo Verification

```powershell
npm run dev
```

Checklist:

- `http://127.0.0.1:17361/api/health` returns `ok: true`.
- `http://127.0.0.1:5173` loads the Web client.
- Workspace path can be entered and saved in the browser.
- `suggest` mode can run a repository inspection prompt.
- Event stream shows session start, steps, tool calls, and final output.
- Manual approval events show decision source and latency when a mutating tool is approved or denied.
- `Load memory` returns either existing memory or the empty-memory state.
- `Load sessions` shows recent runs, and `Replay` opens a saved timeline without console errors.
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
node apps/cli/dist/index.js memory --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest "Inspect this repository and list the main product surfaces."
```

Checklist:

- CLI prints configuration through `doctor`.
- `memory` reads workspace memory without crashing.
- `ask` prints session, step, tool, and final output events.
- `--mode suggest` does not allow shell or file write/edit tools.

## Write-Mode Demo Verification

Only run write-mode demos on a disposable branch, sample workspace, or throwaway copy.

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --max-steps 12 "Make a small documentation-only improvement and summarize the change."
```

Checklist:

- The task scope is narrow and reversible.
- The presenter can explain which files changed.
- Tests or typecheck are run after any product-code change.
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
