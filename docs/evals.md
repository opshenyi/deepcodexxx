# Built-In Evals

DeepCodex includes a small CLI eval surface for repeatable smoke tasks. These evals are read-only prompts that run through the same shared agent core as normal CLI tasks. They are intended for demo regression checks and product review, not as a full benchmark suite.

## Commands

```powershell
node apps/cli/dist/index.js evals list
node apps/cli/dist/index.js evals show repo-map
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex
node apps/cli/dist/index.js evals run repo-map --workspace D:\Coding\DeepCodex --json
```

`evals run` forces `suggest` mode and uses the task's `inspection` profile by default, so it does not write files, run shell commands, append memory, or persist session state. The JSON mode emits newline-delimited records: an `eval_started` record, normal agent event records, and an `eval_result` record with the final text and expected signal list.

## Tasks

| Eval | Purpose | Expected signals |
| --- | --- | --- |
| `repo-map` | Inventory packages, clients, shared core, and runtime boundaries. | `packages/core`, `apps/web`, `apps/desktop`, `apps/cli`, `apps/server` |
| `safety-smoke` | Review policy, approval, shell, DLP, and audit controls. | `approval`, `DLP`, `shell`, `policy`, `audit` |
| `release-evidence` | Review demo docs, verification commands, and documented limitations. | `runbook`, `release checklist`, `product readiness`, `security model` |

## Current Limits

- Eval output is not automatically scored yet.
- Expected signals are emitted as review hints for humans or future automation.
- Live DeepSeek-backed evals require `DEEPSEEK_API_KEY`; without it, the same commands run in local demo mode.
