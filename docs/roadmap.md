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
| Current interview slice | Demonstrate an end-to-end local coding agent product. | DeepSeek client with retry/backoff and approved fallback models, provider/model allowlists, tool loop, workspace config defaults, saved Web workspace profiles, SHA-256 provenance, policy-bundle key generation/signing/verification with Web/Desktop trust status, trust package export, key rotation/revocation controls, signed-only policy enforcement, custom team policy profiles, token accounting, budget controls, managed pricing profiles, reusable policy profiles, workspace guardrails, generated/build output deny patterns, media/artifact extension policy, metadata-only artifact inspection, default-off archive manifest listing, default-off bounded PDF text extraction, existing-secret security scan, release evidence reports, distribution preflight reports, approval metadata, file hash auditing, unified/split structured Web diff review, built-in and workspace-specific event redaction, write-time DLP blocking, audit export/retention, minimal shell environment, optional workspace-copy shell execution, network-aware and workspace-configurable shell command policy, failed shell status propagation, CLI JSON, CLI completion scripts, CI preflight diagnostics, built-in and workspace-defined read-only smoke evals with exact signal scoring, optional local history, cross-run comparison reports, aggregate eval evidence reports, memory, Web session replay, Desktop production-like server bootstrap, CLI, docs. | Checklist passes and limitations are documented. |
| Phase 1: safer local agent | Make local write-mode use easier to trust. | Kernel-level shell sandboxing or remote isolated execution workers, managed policy trust package distribution and audit reporting, policy-controlled OCR and richer archive/document analysis. | User can approve each write or shell command with a visible diff or command body, review the decision later, and understand when shell network access or direct workspace shell execution was intentionally enabled. |
| Phase 2: product operations | Make demos repeatable and measurable. | Semantic eval scoring, larger benchmark suites, hosted trend analytics, managed pricing profile evidence. | A release can compare behavior across model/config changes with stronger quality signals. |
| Phase 3: desktop release | Move beyond production-like Electron launch. | Packaged installers, signing, update policy, crash reporting plan, OS-specific smoke tests. | A reviewer can install and run Desktop without starting dev servers manually. |
| Phase 4: team pilot | Support controlled internal use. | Config profiles, shared policy templates, richer DLP classification, team documentation, pilot feedback loop. | A small team can run DeepCodex on approved repositories with documented support boundaries. |
| Phase 5: hosted product | Add enterprise service foundations. | Auth, RBAC, tenancy, isolated execution workers, managed workspaces, audit retention, provider allowlists. | Hosted deployment can be reviewed against a real security checklist. |

## Near-Term Backlog

| Item | Why it matters | Suggested owner area |
| --- | --- | --- |
| Policy-controlled artifact extraction | Builds on default-off PDF text extraction with safe OCR and richer archive/document analysis after the metadata-only inspection and archive-manifest paths. | Core, config. |
| Policy bundle distribution workflow | Builds on signing, verification, Web/Desktop status, and key rotation/revocation primitives with safer distribution and audit reporting. | Provider config, clients. |
| Kernel-level shell sandbox | Builds on workspace-copy execution with stronger filesystem and network controls. | Core, execution. |
| CLI packaging polish | Builds on `ask --json`, `doctor --json`, strict doctor requirement gates, session JSON surfaces, and shell completion with packaged binary polish. | CLI. |
| Desktop packaging | Turns the desktop client into a deliverable artifact. | Desktop, release. |

## Decision Points

Before claiming broader commercial readiness, decide:

- Whether shell execution will be sandboxed locally, remotely, or both.
- Whether hosted workspaces are managed by DeepCodex or connected to customer machines.
- Which DeepSeek models should be certified for team/shared policy bundles.
- Whether fallback selection needs richer health scoring, latency thresholds, or per-task model classes.
- How long prompts, tool outputs, and memory should be retained.
- Which approval events must be auditable for team pilots.

## Deferred Work

The following items are intentionally deferred until the local safety model is stronger:

- Multi-agent autonomous planning.
- Background repository monitors.
- Hosted multi-tenant execution.
- Automatic dependency upgrades.
- Unattended full-access runs.
