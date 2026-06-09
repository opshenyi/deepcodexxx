# Built-In Evals

DeepCodex includes a small CLI eval surface for repeatable smoke tasks. These evals are read-only prompts that run through the same shared agent core as normal CLI tasks. They are intended for demo regression checks and product review, not as a full benchmark suite.

## Commands

```powershell
node apps/cli/dist/index.js evals list
node apps/cli/dist/index.js evals show repo-map
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json --require-pass
```

`evals run` forces `suggest` mode and uses the task's `inspection` profile by default, so it does not write files, run shell commands, append memory, or persist session state. The JSON mode emits newline-delimited records: an `eval_started` record, normal agent event records, and an `eval_result` record with the final text, expected signal list, and score.

Scoring is intentionally transparent: DeepCodex checks whether the final answer contains each expected signal, case-insensitively. `--min-score <0-1>` fails the command when the score is below a threshold, and `--require-pass` requires every expected signal. This is useful for CI smoke gates, while deeper semantic scoring remains future work.

## Tasks

| Eval | Purpose | Expected signals |
| --- | --- | --- |
| `repo-map` | Inventory packages, clients, shared core, and runtime boundaries. | `packages/core`, `apps/web`, `apps/desktop`, `apps/cli`, `apps/server` |
| `safety-smoke` | Review policy, approval, shell, DLP, and audit controls. | `approval`, `DLP`, `shell`, `policy`, `audit` |
| `release-evidence` | Review demo docs, verification commands, and documented limitations. | `runbook`, `release checklist`, `product readiness`, `security model` |

## Current Limits

- Scoring is exact expected-signal matching, not semantic grading.
- Historical eval comparisons and richer benchmark reports are future work.
- Live DeepSeek-backed evals require `DEEPSEEK_API_KEY`; without it, the same commands run in local demo mode.
