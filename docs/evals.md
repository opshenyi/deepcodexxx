# CLI Evals

DeepCodex includes a small CLI eval surface for repeatable smoke tasks. Evals are read-only prompts that run through the same shared agent core as normal CLI tasks. They are intended for demo regression checks and product review, not as a full benchmark suite.

The CLI includes built-in tasks and can also load workspace-defined tasks from `.deepcodex/config.json` under the `evals` array.

## Commands

```powershell
node apps/cli/dist/index.js evals list --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals show repo-map --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json --require-pass
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json --record
node apps/cli/dist/index.js evals history --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals show-run <run-id> --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals compare <baseline-run-id> <candidate-run-id> --workspace D:\Coding\DeepCodex
```

`evals run` forces `suggest` mode and uses the task's configured profile for budget and policy defaults, so it does not write files, run shell commands, append memory, or persist session state. The JSON mode emits newline-delimited records: an `eval_started` record, normal agent event records, and an `eval_result` record with the final text, expected signal list, source, and score.

Scoring is intentionally transparent: DeepCodex checks whether the final answer contains each expected signal, case-insensitively. `--min-score <0-1>` fails the command when the score is below a threshold, and `--require-pass` requires every expected signal. This is useful for CI smoke gates, while deeper semantic scoring remains future work.

Use `--record` when you want local eval evidence. Recorded evals are written to `.deepcodex/state/evals` in the selected workspace. That path is denied to agent file tools by default, and evals do not write records unless the flag is explicit.

Use `evals compare` to inspect two recorded runs. The comparison reports score delta, pass-state changes, expected-signal additions/removals, and final-answer length delta. It is a compact regression report for review and CI artifacts.

## Tasks

Built-in tasks:

| Eval | Purpose | Expected signals |
| --- | --- | --- |
| `repo-map` | Inventory packages, clients, shared core, and runtime boundaries. | `packages/core`, `apps/web`, `apps/desktop`, `apps/cli`, `apps/server` |
| `safety-smoke` | Review policy, approval, shell, DLP, and audit controls. | `approval`, `DLP`, `shell`, `policy`, `audit` |
| `release-evidence` | Review demo docs, verification commands, and documented limitations. | `runbook`, `release checklist`, `product readiness`, `security model` |

Workspace task example:

```json
{
  "evals": [
    {
      "id": "workspace-release-smoke",
      "label": "Workspace release smoke",
      "description": "Team-owned read-only release evidence check for this repository.",
      "prompt": "Inspect this repository in read-only mode. Summarize release evidence, verification commands, and remaining documented risks. Do not modify files.",
      "profile": "inspection",
      "maxSteps": 6,
      "budget": {
        "maxTokens": 60000
      },
      "expectedSignals": ["release checklist", "runbook", "product readiness"]
    }
  ]
}
```

Workspace eval ids must be unique, file-name safe, and cannot replace built-in eval ids.

## Current Limits

- Scoring is exact expected-signal matching, not semantic grading.
- Comparison charts and richer benchmark reports are future work.
- Live DeepSeek-backed evals require `DEEPSEEK_API_KEY`; without it, the same commands run in local demo mode.
