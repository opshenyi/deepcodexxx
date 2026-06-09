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
| Current interview slice | Demonstrate an end-to-end local coding agent product. | DeepSeek client, tool loop, token accounting, budget controls, managed pricing profiles, reusable policy profiles, workspace guardrails, generated/build output deny patterns, media/artifact extension policy, approval metadata, file hash auditing, event redaction, audit export/retention, minimal shell environment, memory, Web session replay, Desktop, CLI, docs. | Checklist passes and limitations are documented. |
| Phase 1: safer local agent | Make local write-mode use easier to trust. | OS-level shell sandboxing, purpose-built media/artifact preview tools, custom team policy profile storage. | User can approve each write or shell command with a visible diff or command body, and review the decision later. |
| Phase 2: product operations | Make demos repeatable and measurable. | Structured run history, managed pricing profiles, benchmark tasks, regression evals. | A release can compare behavior across model/config changes. |
| Phase 3: desktop release | Move beyond development Electron launch. | Packaged installers, signing, update policy, crash reporting plan, OS-specific smoke tests. | A reviewer can install and run Desktop without starting dev servers manually. |
| Phase 4: team pilot | Support controlled internal use. | Config profiles, shared policy templates, project-specific DLP, team documentation, pilot feedback loop. | A small team can run DeepCodex on approved repositories with documented support boundaries. |
| Phase 5: hosted product | Add enterprise service foundations. | Auth, RBAC, tenancy, isolated execution workers, managed workspaces, audit retention, provider allowlists. | Hosted deployment can be reviewed against a real security checklist. |

## Near-Term Backlog

| Item | Why it matters | Suggested owner area |
| --- | --- | --- |
| Diff viewer UI | Lets users inspect generated diffs with better affordances. | Web, CLI. |
| Media/artifact preview tools | Safely summarize selected non-text artifacts without exposing raw binary content to the model. | Core, config. |
| Per-workspace model policy | Lets teams pin approved models and budgets by repository. | Provider config, clients. |
| CLI JSON output | Enables automation and CI-style checks. | CLI. |
| Desktop packaging | Turns the desktop client into a deliverable artifact. | Desktop, release. |

## Decision Points

Before claiming broader commercial readiness, decide:

- Whether shell execution will be sandboxed locally, remotely, or both.
- Whether hosted workspaces are managed by DeepCodex or connected to customer machines.
- Which DeepSeek models are supported and how fallback models are selected.
- How long prompts, tool outputs, and memory should be retained.
- Which approval events must be auditable for team pilots.

## Deferred Work

The following items are intentionally deferred until the local safety model is stronger:

- Multi-agent autonomous planning.
- Background repository monitors.
- Hosted multi-tenant execution.
- Automatic dependency upgrades.
- Unattended full-access runs.
