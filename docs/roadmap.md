# Roadmap

The roadmap prioritizes safety and product evidence before broader automation. DeepCodex should remain honest about what is implemented locally and what is still required for commercial deployment.

## Principles

- Keep one shared agent core for Web, Desktop, and CLI.
- Make tool execution visible and reviewable.
- Prefer explicit approvals over broad autonomy.
- Keep provider configuration external to code.
- Treat hosted deployment as a separate security milestone, not a default assumption.

## Phases

| Phase | Goal | Work items | Exit criteria |
| --- | --- | --- | --- |
| Current interview slice | Demonstrate an end-to-end local coding agent product. | DeepSeek client with retry/backoff, provider/model allowlists, tool loop, workspace config defaults, SHA-256 provenance, policy-bundle key generation/signing/verification with Web/Desktop trust status, key rotation/revocation controls, signed-only policy enforcement, custom team policy profiles, token accounting, budget controls, managed pricing profiles, reusable policy profiles, workspace guardrails, generated/build output deny patterns, media/artifact extension policy, metadata-only artifact inspection, default-off archive manifest listing, approval metadata, file hash auditing, structured Web diff review, built-in and workspace-specific event redaction, write-time DLP blocking, audit export/retention, minimal shell environment, optional workspace-copy shell execution, network-aware shell command policy, failed shell status propagation, CLI JSON, CI preflight diagnostics, built-in read-only smoke evals, memory, Web session replay, Desktop production-like server bootstrap, CLI, docs. | Checklist passes and limitations are documented. |
| Phase 1: safer local agent | Make local write-mode use easier to trust. | Kernel-level shell sandboxing or remote isolated execution workers, policy-bundle distribution workflows beyond the current status panel, policy-controlled OCR/PDF extraction and richer archive analysis. | User can approve each write or shell command with a visible diff or command body, review the decision later, and understand when shell network access or direct workspace shell execution was intentionally enabled. |
| Phase 2: product operations | Make demos repeatable and measurable. | Automatic eval scoring, historical eval comparisons, benchmark task expansion, managed pricing profile evidence. | A release can compare behavior across model/config changes. |
| Phase 3: desktop release | Move beyond production-like Electron launch. | Packaged installers, signing, update policy, crash reporting plan, OS-specific smoke tests. | A reviewer can install and run Desktop without starting dev servers manually. |
| Phase 4: team pilot | Support controlled internal use. | Config profiles, shared policy templates, richer DLP classification, team documentation, pilot feedback loop. | A small team can run DeepCodex on approved repositories with documented support boundaries. |
| Phase 5: hosted product | Add enterprise service foundations. | Auth, RBAC, tenancy, isolated execution workers, managed workspaces, audit retention, provider allowlists. | Hosted deployment can be reviewed against a real security checklist. |

## Near-Term Backlog

| Item | Why it matters | Suggested owner area |
| --- | --- | --- |
| Side-by-side review mode | Builds on the structured Web diff blocks with richer approval and comparison affordances. | Web. |
| Policy-controlled artifact extraction | Adds safe OCR, PDF text extraction, and richer archive analysis after the metadata-only inspection and archive-manifest paths. | Core, config. |
| Policy bundle distribution workflow | Builds on signing, verification, Web/Desktop status, and key rotation/revocation primitives with safer distribution and audit reporting. | Provider config, clients. |
| Kernel-level shell sandbox | Builds on workspace-copy execution with stronger filesystem and network controls. | Core, execution. |
| CLI packaging polish | Builds on `ask --json`, `doctor --json`, strict doctor requirement gates, and session JSON surfaces with shell completion and packaged binary polish. | CLI. |
| Desktop packaging | Turns the desktop client into a deliverable artifact. | Desktop, release. |

## Decision Points

Before claiming broader commercial readiness, decide:

- Whether shell execution will be sandboxed locally, remotely, or both.
- Whether hosted workspaces are managed by DeepCodex or connected to customer machines.
- Which DeepSeek models are supported and how fallback models are selected.
- Whether retry exhaustion should trigger fallback model selection or fail closed.
- How long prompts, tool outputs, and memory should be retained.
- Which approval events must be auditable for team pilots.

## Deferred Work

The following items are intentionally deferred until the local safety model is stronger:

- Multi-agent autonomous planning.
- Background repository monitors.
- Hosted multi-tenant execution.
- Automatic dependency upgrades.
- Unattended full-access runs.
