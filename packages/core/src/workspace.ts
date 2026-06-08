import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { ApprovalPolicy, WorkspaceContext } from "./types.js";

const DEFAULT_POLICY: ApprovalPolicy = {
  mode: "workspace-write",
  allowFileWrite: true,
  allowShell: true,
  allowNetwork: false,
  allowStateWrite: true,
  deniedPaths: [".git", "node_modules", "references/agents", ".env", ".env.*", ".deepcodex/state"],
  maxFileBytes: 512 * 1024
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

  const selectedMode = policy.mode ?? DEFAULT_POLICY.mode;
  const effectivePolicy = {
    ...DEFAULT_POLICY,
    ...policy,
    mode: selectedMode,
    allowStateWrite:
      selectedMode === "suggest" && policy.allowStateWrite === undefined
        ? false
        : (policy.allowStateWrite ?? DEFAULT_POLICY.allowStateWrite),
    deniedPaths: uniqueDeniedPaths([...(DEFAULT_POLICY.deniedPaths ?? []), ...(policy.deniedPaths ?? [])]),
    maxFileBytes: policy.maxFileBytes ?? DEFAULT_POLICY.maxFileBytes
  };

  const memoryDir = path.join(root, ".deepcodex");
  if (effectivePolicy.allowStateWrite !== false) {
    await mkdir(memoryDir, { recursive: true });
  }

  return {
    root,
    memoryPath: path.join(memoryDir, "memory.md"),
    policy: effectivePolicy
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
  return isDeniedByPatterns(relativePath, DEFAULT_POLICY.deniedPaths ?? []);
}

export function isDeniedByPatterns(relativePath: string, deniedPaths: string[]): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return deniedPaths.some((pattern) => matchesDeniedPattern(normalized, pattern));
}

function matchesDeniedPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern.includes("*")) {
    const regex = new RegExp(`^${normalizedPattern.split("*").map(escapeRegex).join("[^/]*")}(?:/.*)?$`);
    return regex.test(relativePath);
  }
  return relativePath === normalizedPattern || relativePath.startsWith(`${normalizedPattern}/`);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function uniqueDeniedPaths(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
