import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { ApprovalPolicy, WorkspaceContext } from "./types.js";

const DEFAULT_POLICY: ApprovalPolicy = {
  mode: "workspace-write",
  allowFileWrite: true,
  allowShell: true,
  allowNetwork: false
};

export async function createWorkspaceContext(
  workspaceInput: string,
  policy: ApprovalPolicy = DEFAULT_POLICY
): Promise<WorkspaceContext> {
  const root = path.resolve(workspaceInput || process.cwd());
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${root}`);
  }

  const memoryDir = path.join(root, ".deepcodex");
  await mkdir(memoryDir, { recursive: true });

  return {
    root,
    memoryPath: path.join(memoryDir, "memory.md"),
    policy: {
      ...DEFAULT_POLICY,
      ...policy
    }
  };
}

export function resolveWorkspacePath(workspace: WorkspaceContext, inputPath = "."): string {
  const normalized = inputPath.trim() || ".";
  const resolved = path.resolve(workspace.root, normalized);
  const relative = path.relative(workspace.root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolved;
}

export function workspaceRelative(workspace: WorkspaceContext, absolutePath: string): string {
  return path.relative(workspace.root, absolutePath) || ".";
}

export function isDeniedWorkspacePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === "references/agents" ||
    normalized.startsWith("references/agents/")
  );
}

