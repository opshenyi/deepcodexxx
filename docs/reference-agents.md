# Reference Agent Survey

This directory uses shallow clones under `references/agents` for architecture study only. Product code in DeepCodex is original and should not copy source from these projects.

## Pulled Repositories

| Project | Repository | License signal | Why it matters |
| --- | --- | --- | --- |
| Codex | https://github.com/openai/codex | Apache-2.0 | Terminal-first coding agent, sandbox, approvals, memory, evals. |
| OpenCode | https://github.com/anomalyco/opencode | MIT | Open coding agent with provider abstraction and app surface. |
| OpenHands | https://github.com/OpenHands/OpenHands | Mixed/declared in repo | Long-horizon autonomous software engineer with UI and runtime isolation. |
| Cline | https://github.com/cline/cline | Apache-2.0 | IDE extension UX, tool approvals, file edit loop. |
| Roo Code | https://github.com/RooCodeInc/Roo-Code | Apache-2.0 | Multi-agent IDE workflow and mode switching. |
| Continue | https://github.com/continuedev/continue | Apache-2.0 | Source-controlled AI checks and developer workflow integration. |
| Aider | https://github.com/Aider-AI/aider | Apache-2.0 | Git-aware terminal pair programming and patch discipline. |
| SWE-agent | https://github.com/SWE-agent/SWE-agent | MIT | Issue-to-fix loop, benchmarks, command execution. |
| GPT Engineer | https://github.com/AntonOsika/gpt-engineer | MIT | Code generation workflow and project scaffolding. |
| Tabby | https://github.com/TabbyML/tabby | Repo license required | Self-hosted coding assistant and enterprise deployment patterns. |
| Goose | https://github.com/aaif-goose/goose | Apache-2.0 | Extensible tool agent, desktop and CLI surfaces. |
| Gemini CLI | https://github.com/google-gemini/gemini-cli | Apache-2.0 | Modern CLI agent with policy, memory, and tool contracts. |
| Qwen Code | https://github.com/QwenLM/qwen-code | Apache-2.0 | Terminal coding agent with non-OpenAI model focus. |
| Void | https://github.com/voideditor/void | Apache-2.0 | AI-native editor surface. |
| Devika | https://github.com/stitionai/devika | MIT | Agentic software engineer reference implementation. |
| smol developer | https://github.com/smol-ai/developer | MIT | Embeddable developer agent library pattern. |

## Design Takeaways

- Keep the agent core separate from clients so Web, Desktop, and CLI use the same tool loop.
- Treat shell and file writes as policy-controlled capabilities, not model privileges.
- Persist memory in the target workspace, and keep product-level memory in this repository.
- Surface every tool call as an event stream. This makes the product inspectable and interview-friendly.
- Prefer a provider abstraction around the OpenAI-compatible DeepSeek API so model upgrades require configuration, not code rewrites.
- Use shallow reference clones only for research. Avoid license bleed by writing clean-room implementation notes and original code.

