import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FileAuditEntry, FileHashSnapshot, WorkspaceContext } from "./types.js";
import { isDeniedByPatterns, resolveWorkspacePath, workspaceRelative } from "./workspace.js";

export function createBufferHashSnapshot(buffer: Buffer): FileHashSnapshot {
  return {
    exists: true,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.byteLength
  };
}

export async function createFileHashSnapshot(target: string): Promise<FileHashSnapshot> {
  const buffer = await readFile(target).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  return buffer ? createBufferHashSnapshot(buffer) : { exists: false };
}

export async function createApprovalFileAudits(
  toolName: string,
  input: unknown,
  workspace: WorkspaceContext
): Promise<FileAuditEntry[] | undefined> {
  const operation = fileOperationForTool(toolName);
  if (!operation) {
    return undefined;
  }

  const pathInput = readPathInput(input);
  if (!pathInput) {
    return undefined;
  }

  try {
    const target = resolveWorkspacePath(workspace, pathInput);
    const rel = workspaceRelative(workspace, target);
    if (isDeniedByPatterns(rel, workspace.policy.deniedPaths ?? [])) {
      return [
        {
          path: rel,
          operation,
          before: { exists: false, error: `Denied path: ${rel}` }
        }
      ];
    }
    return [{ path: rel, operation, before: await createFileHashSnapshot(target) }];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ path: pathInput, operation, before: { exists: false, error: message } }];
  }
}

function fileOperationForTool(toolName: string): FileAuditEntry["operation"] | undefined {
  switch (toolName) {
    case "write_file":
      return "write";
    case "edit_file":
      return "edit";
    default:
      return undefined;
  }
}

function readPathInput(input: unknown): string | undefined {
  const value = typeof input === "string" ? parseJsonObject(input)?.path : input && typeof input === "object" ? (input as { path?: unknown }).path : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
