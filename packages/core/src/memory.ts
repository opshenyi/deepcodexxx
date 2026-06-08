import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./types.js";

const DEFAULT_MEMORY = `# DeepCodex Workspace Memory

## Product Context
- DeepCodex is a DeepSeek-powered coding agent with workspace tools.
- Keep outputs concise, implementation-oriented, and suitable for commercial software work.

## Working Rules
- Prefer small, reviewable changes.
- Inspect existing files before editing.
- Run relevant verification when the workspace provides it.
`;

export async function readWorkspaceMemory(workspace: WorkspaceContext): Promise<string> {
  try {
    return await readFile(workspace.memoryPath, "utf8");
  } catch {
    if (workspace.policy.allowStateWrite === false) {
      return DEFAULT_MEMORY;
    }
    await mkdir(path.dirname(workspace.memoryPath), { recursive: true });
    await writeFile(workspace.memoryPath, DEFAULT_MEMORY, "utf8");
    return DEFAULT_MEMORY;
  }
}

export async function appendWorkspaceMemory(workspace: WorkspaceContext, note: string): Promise<string> {
  if (workspace.policy.allowStateWrite === false) {
    throw new Error("Workspace state writes are disabled by the current approval policy.");
  }
  const current = await readWorkspaceMemory(workspace);
  const next = `${current.trim()}\n\n## Note ${new Date().toISOString()}\n${note.trim()}\n`;
  await mkdir(path.dirname(workspace.memoryPath), { recursive: true });
  await writeFile(workspace.memoryPath, next, "utf8");
  return next;
}
