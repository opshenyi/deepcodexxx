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
node apps/cli/dist/index.js doctor --json
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
```

Expected result:

- TypeScript project references pass.
- Vitest test suite passes.
- Build completes for all workspaces with build scripts.
- CLI `doctor` reports the intended DeepSeek base URL and model.
- CLI `doctor --json` emits parseable diagnostics with `ok`, `requirementFailures`, and policy-bundle verification detail.
- CLI `doctor --json --require-*` exits non-zero when a requested API-key, workspace-config, or trusted-policy-bundle condition is not met; run the strict flags that match the planned demo workspace.
- CLI `doctor` reports provider retry settings.
- CLI `doctor` reports provider allowlist counts when workspace policy defines them.
- CLI `doctor` reports configured budget environment values when present.
- CLI `doctor` reports shell environment mode, defaulting to `minimal`.
- CLI `doctor` reports shell execution mode, defaulting to `direct`.
- CLI `doctor` reports shell network access, defaulting to `blocked`.
- CLI `doctor` reports archive listing, defaulting to `blocked`.
- CLI `doctor` reports a workspace config SHA-256 when a config file exists.
- CLI `doctor` reports policy bundle status.
- CLI `doctor` reports whether signed policy is required.
- CLI `doctor` reports workspace config status, and `config show` reports either a valid config or a clear missing state.
- If `DEEPCODEX_CORS_ORIGINS` is configured, allowed browser origins receive a CORS allow header and unlisted origins do not.
- CLI `config generate-keypair --private-key <pem> --public-key <pem>` creates Ed25519 key files, prints the public key SHA-256, and refuses accidental overwrite unless `--force` is used.
- CLI `config sign-bundle --workspace <path> --private-key <pem> --issuer <name>` creates `.deepcodex/policy-bundle.json` for the active config and refuses accidental overwrite unless `--force` is used.
- CLI `config verify-bundle --workspace <path> --public-key <pem> [<pem>...]` verifies a signed policy bundle when one is present.
- Policy-bundle trust policy can be tested with multiple trusted keys, revoked bundle hashes, revoked key hashes, and trusted issuer filters.
- With `DEEPCODEX_REQUIRE_SIGNED_POLICY=true`, CLI/server runs fail before model execution when the signed bundle is missing or untrusted.
- CLI `profiles list --workspace <path>` includes any workspace-defined team profiles.
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
- Server URL can be reviewed in the sidebar, saved, and used for memory/session/config calls without console errors.
- `Load config` applies `.deepcodex/config.json` defaults when the selected workspace has one.
- `Load config` displays a short SHA-256 when the selected workspace has a config file.
- The right-rail Policy bundle panel refreshes after `Load config`, can be refreshed independently, and reports missing, trusted, untrusted, or failed bundle status with verification details.
- Policy profile selector can switch between Inspection, Guarded write, Full access review, and workspace-defined team profiles.
- Shell execution selector can switch between direct workspace and temporary-copy execution.
- `suggest` mode can run a repository inspection prompt.
- Event stream shows session start, steps, tool calls, and final output.
- Manual approval events show decision source and latency when a mutating tool is approved or denied.
- Write/edit approval and tool result events show file hash audit metadata when a file path is involved.
- Budget controls can be set in the sidebar and budget events appear when provider usage metadata is available.
- A workspace provider allowlist rejects unapproved base URLs or models before a run starts.
- Pricing profile selector appears in the Budget panel when pricing profiles are configured.
- Event stream and exports redact common secret patterns in tool output and assistant text.
- Workspace-specific redaction patterns from `.deepcodex/config.json` redact configured matches before streaming or persistence.
- Workspace-specific DLP patterns from `.deepcodex/config.json` block configured matches before write/edit diffs or file changes.
- Write/edit tools block probable secret content before showing a diff or applying a file change.
- Artifact inspection returns metadata only and does not expose raw bytes, base64 content, or denied paths.
- Archive listing remains blocked by default; when enabled for a trusted ZIP fixture, entry manifests omit denied entries and do not expose member contents.
- Shell network commands such as package install or remote git are blocked unless network access is explicitly enabled for a trusted run.
- A deliberately failing verification command appears as a failed tool result, not a successful tool event with stderr text.
- With `shellExecutionMode` set to `workspace-copy` for a trusted fixture, shell commands run from a temporary snapshot, leave the real workspace unchanged for relative-path writes, and show `Shell audit` metadata.
- `Load memory` returns either existing memory or the empty-memory state.
- `Load sessions` shows recent runs, `Replay` opens a saved timeline, and `Export` creates a Markdown audit file without console errors.
- Saved live or replay events containing unified diffs render as structured diff blocks, including multi-file diffs, and following `File audit` metadata remains readable.
- Audit retention dry-run can preview sessions that would be pruned before deletion is applied.
- A missing API key produces the documented local demo response.

Suggested safe prompt:

```text
Inspect this repository and summarize the safest next implementation step. Do not modify files.
```

## Desktop Demo Verification

```powershell
npm run dev:desktop
npm run start:desktop
```

Checklist:

- Server and Web client both start.
- Electron window opens the DeepCodex experience.
- Production-like Desktop launch starts the built local server when no server is already healthy.
- The same workspace and prompt used in the Web demo can run from Desktop.
- Window close and process shutdown do not leave confusing orphaned terminals for the presenter.

## CLI Demo Verification

```powershell
npm run build
node apps/cli/dist/index.js doctor
node apps/cli/dist/index.js config show --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js profiles list
node apps/cli/dist/index.js pricing list
node apps/cli/dist/index.js evals list
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json --max-steps 1
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json --max-steps 1 --min-score 0
node apps/cli/dist/index.js memory --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --profile inspection "Inspect this repository and list the main product surfaces."
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --profile inspection --json "Inspect this repository and list the main product surfaces."
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode suggest --max-session-tokens 20000 "Inspect this repository with a token budget."
```

Checklist:

- CLI prints configuration through `doctor`.
- CLI can show workspace defaults through `config show`.
- CLI can list workspace-defined team policy profiles through `profiles list --workspace`.
- CLI can list built-in evals and run `evals run repo-map --json` as a read-only smoke task with score output and optional CI thresholds.
- `memory` reads workspace memory without crashing.
- `ask` prints session, step, tool, and final output events.
- `ask --json` emits newline-delimited JSON records that can be parsed by automation.
- Budgeted `ask` prints budget status when the provider returns usage metadata.
- `--mode suggest` does not allow shell or file write/edit tools.
- Shell-capable demos use `--shell-env minimal` unless a trusted task explicitly needs inherited environment variables.
- Safer verification demos can use `--shell-execution-mode workspace-copy` when command side effects should stay out of the selected workspace.
- Network-capable shell demos use `--allow-network` only after the command has been reviewed.
- Archive manifest demos use `--allow-archive-listing` only for trusted ZIP-compatible fixtures.

## Write-Mode Demo Verification

Only run write-mode demos on a disposable branch, sample workspace, or throwaway copy.

```powershell
node apps/cli/dist/index.js ask --workspace D:\Coding\DeepCodex --mode workspace-write --max-steps 12 "Make a small documentation-only improvement and summarize the change."
```

Checklist:

- The task scope is narrow and reversible.
- The presenter can explain which files changed.
- Tests or typecheck are run after any product-code change.
- Write/edit DLP failures do not echo the raw secret value in the event stream.
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
- Desktop production-like smoke test:

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
