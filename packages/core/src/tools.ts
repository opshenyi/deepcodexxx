import { exec } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createBufferHashSnapshot } from "./file-audit.js";
import { appendWorkspaceMemory, readWorkspaceMemory } from "./memory.js";
import { assertShellCommandAllowed, canWriteFiles, truncateForModel } from "./safety.js";
import type { FileAuditEntry, RuntimeTool, ToolResult, ToolRuntime } from "./types.js";
import { isDeniedByPatterns, resolveWorkspacePath, workspaceRelative } from "./workspace.js";

const execAsync = promisify(exec);

export function createDefaultTools(): RuntimeTool[] {
  return [
    listFilesTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    searchFilesTool,
    runCommandTool,
    readMemoryTool,
    appendMemoryTool
  ];
}

const listFilesTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "list_files",
      description: "List workspace files and directories with a bounded depth.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from the workspace root.", default: "." },
          maxDepth: { type: "number", description: "Maximum recursion depth, up to 4.", default: 2 }
        }
      }
    }
  },
  async run(input, runtime) {
    const args = objectInput(input);
    const start = resolveWorkspacePath(runtime.workspace, stringValue(args.path, "."));
    const maxDepth = Math.min(numberValue(args.maxDepth, 2), 4);
    const entries: string[] = [];
    await walk(start, runtime.workspace.root, maxDepth, entries, runtime.workspace.policy.deniedPaths ?? []);
    return ok(entries.join("\n") || ".");
  }
};

const readFileTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path." }
        },
        required: ["path"]
      }
    }
  },
  async run(input, runtime) {
    const args = objectInput(input);
    const target = resolveWorkspacePath(runtime.workspace, stringValue(args.path));
    const rel = workspaceRelative(runtime.workspace, target);
    if (isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? [])) {
      return fail(`Denied path: ${rel}`);
    }
    const targetStat = await stat(target);
    if (exceedsFileLimit(targetStat.size, runtime)) {
      return fail(`File exceeds maxFileBytes (${runtime.workspace.policy.maxFileBytes}): ${rel}`);
    }
    const content = await readUtf8TextFile(target);
    if (content === undefined) {
      return fail(`File appears to be binary: ${rel}`);
    }
    return ok(truncateForModel(content));
  }
};

const writeFileTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a complete UTF-8 file within the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path." },
          content: { type: "string", description: "Full new file content." }
        },
        required: ["path", "content"]
      }
    }
  },
  async run(input, runtime) {
    const args = objectInput(input);
    const target = resolveWorkspacePath(runtime.workspace, stringValue(args.path));
    const rel = workspaceRelative(runtime.workspace, target);
    if (isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? [])) {
      return fail(`Denied path: ${rel}`);
    }
    const next = stringValue(args.content);
    if (exceedsFileLimit(Buffer.byteLength(next, "utf8"), runtime)) {
      return fail(`Content exceeds maxFileBytes (${runtime.workspace.policy.maxFileBytes}): ${rel}`);
    }
    const previousBuffer = await readFile(target).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    const previous = previousBuffer?.toString("utf8") ?? "";
    const diff = createUnifiedDiff(rel, previous, next);
    const nextBuffer = Buffer.from(next, "utf8");
    const audit = fileAudit(rel, "write", previousBuffer, nextBuffer, false);
    if (!canWriteFiles(runtime.workspace.policy)) {
      return ok(`Preview only. File writes are disabled by the current approval policy.\n\n${diff}`, { files: [audit] });
    }
    await writeFile(target, next, "utf8");
    return ok(`Wrote ${rel} sha256:${audit.after?.sha256?.slice(0, 12) ?? "unknown"}\n\n${diff}`, {
      files: [{ ...audit, applied: true }]
    });
  }
};

const editFileTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace an exact text range in a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path." },
          search: { type: "string", description: "Exact text to replace." },
          replace: { type: "string", description: "Replacement text." }
        },
        required: ["path", "search", "replace"]
      }
    }
  },
  async run(input, runtime) {
    const args = objectInput(input);
    const target = resolveWorkspacePath(runtime.workspace, stringValue(args.path));
    const rel = workspaceRelative(runtime.workspace, target);
    if (isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? [])) {
      return fail(`Denied path: ${rel}`);
    }
    const targetStat = await stat(target);
    if (exceedsFileLimit(targetStat.size, runtime)) {
      return fail(`File exceeds maxFileBytes (${runtime.workspace.policy.maxFileBytes}): ${rel}`);
    }
    const currentBuffer = await readFile(target);
    if (isProbablyBinary(currentBuffer)) {
      return fail(`File appears to be binary: ${rel}`);
    }
    const current = currentBuffer.toString("utf8");
    const search = stringValue(args.search);
    if (!current.includes(search)) {
      return fail(`Search text was not found in ${rel}`);
    }
    const next = current.replace(search, stringValue(args.replace));
    const diff = createUnifiedDiff(rel, current, next);
    const nextBuffer = Buffer.from(next, "utf8");
    const audit = fileAudit(rel, "edit", currentBuffer, nextBuffer, false);
    if (!canWriteFiles(runtime.workspace.policy)) {
      return ok(`Preview only. File edits are disabled by the current approval policy.\n\n${diff}`, { files: [audit] });
    }
    await writeFile(target, next, "utf8");
    return ok(`Edited ${rel}\n\n${diff}`, { files: [{ ...audit, applied: true }] });
  }
};

const searchFilesTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "search_files",
      description: "Search text files in the workspace by substring.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring to search for." },
          path: { type: "string", description: "Relative path to search under.", default: "." }
        },
        required: ["query"]
      }
    }
  },
  async run(input, runtime) {
    const args = objectInput(input);
    const query = stringValue(args.query);
    const start = resolveWorkspacePath(runtime.workspace, stringValue(args.path, "."));
    const files: string[] = [];
    await collectFiles(start, runtime.workspace.root, files, 350, runtime.workspace.policy.deniedPaths ?? []);
    const matches: string[] = [];
    for (const file of files) {
      const rel = workspaceRelative(runtime.workspace, file);
      if (isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? [])) {
        continue;
      }
      const fileStat = await stat(file).catch(() => null);
      if (!fileStat || exceedsFileLimit(fileStat.size, runtime)) {
        continue;
      }
      const content = await readUtf8TextFile(file).catch(() => undefined);
      if (content === undefined) {
        continue;
      }
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.includes(query)) {
          matches.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      });
      if (matches.length >= 120) {
        break;
      }
    }
    return ok(matches.join("\n") || "No matches.");
  }
};

const runCommandTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace and return stdout and stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run." },
          timeoutMs: { type: "number", description: "Timeout in milliseconds.", default: 60000 }
        },
        required: ["command"]
      }
    }
  },
  async run(input, runtime) {
    const args = objectInput(input);
    const command = stringValue(args.command);
    assertShellCommandAllowed(command, runtime.workspace.policy);
    const timeout = Math.min(numberValue(args.timeoutMs, 60_000), 180_000);
    const result = await execAsync(command, {
      cwd: runtime.workspace.root,
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    }).catch((error: unknown) => {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message ?? ""
      };
    });
    return ok(truncateForModel([result.stdout, result.stderr].filter(Boolean).join("\n")));
  }
};

const readMemoryTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "read_memory",
      description: "Read the persistent DeepCodex memory for this workspace.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  async run(_input, runtime) {
    return ok(await readWorkspaceMemory(runtime.workspace));
  }
};

const appendMemoryTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "append_memory",
      description: "Append a durable note to the DeepCodex workspace memory.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string", description: "Memory note to append." }
        },
        required: ["note"]
      }
    }
  },
  async run(input, runtime) {
    const args = objectInput(input);
    if (runtime.workspace.policy.allowStateWrite === false) {
      return fail("Workspace memory writes are disabled by the current approval policy.");
    }
    await appendWorkspaceMemory(runtime.workspace, stringValue(args.note));
    return ok("Memory updated.");
  }
};

async function walk(
  current: string,
  root: string,
  depth: number,
  entries: string[],
  deniedPaths: string[]
): Promise<void> {
  const rel = path.relative(root, current) || ".";
  if (isDeniedByPatterns(rel, deniedPaths)) {
    return;
  }
  const currentStat = await stat(current);
  entries.push(currentStat.isDirectory() ? `${rel}/` : rel);
  if (!currentStat.isDirectory() || depth <= 0) {
    return;
  }
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80)) {
    await walk(path.join(current, child.name), root, depth - 1, entries, deniedPaths);
  }
}

async function collectFiles(
  current: string,
  root: string,
  files: string[],
  limit: number,
  deniedPaths: string[]
): Promise<void> {
  if (files.length >= limit) {
    return;
  }
  const rel = path.relative(root, current) || ".";
  if (isDeniedByPatterns(rel, deniedPaths)) {
    return;
  }
  const currentStat = await stat(current);
  if (currentStat.isFile()) {
    files.push(current);
    return;
  }
  if (!currentStat.isDirectory()) {
    return;
  }
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= limit) {
      break;
    }
    await collectFiles(path.join(current, child.name), root, files, limit, deniedPaths);
  }
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    return JSON.parse(input) as Record<string, unknown>;
  }
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ok(content: string, audit?: ToolResult["audit"]): ToolResult {
  return audit ? { ok: true, content, audit } : { ok: true, content };
}

function fail(content: string): ToolResult {
  return { ok: false, content };
}

function fileAudit(
  relativePath: string,
  operation: FileAuditEntry["operation"],
  beforeBuffer: Buffer | undefined,
  afterBuffer: Buffer,
  applied: boolean
): FileAuditEntry {
  return {
    path: relativePath,
    operation,
    before: beforeBuffer ? createBufferHashSnapshot(beforeBuffer) : { exists: false },
    after: createBufferHashSnapshot(afterBuffer),
    applied
  };
}

function exceedsFileLimit(size: number, runtime: ToolRuntime): boolean {
  const limit = runtime.workspace.policy.maxFileBytes;
  return typeof limit === "number" && Number.isFinite(limit) && limit >= 0 && size > limit;
}

async function readUtf8TextFile(target: string): Promise<string | undefined> {
  const buffer = await readFile(target);
  if (isProbablyBinary(buffer)) {
    return undefined;
  }
  return buffer.toString("utf8");
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length === 0) {
    return false;
  }
  if (sample.includes(0)) {
    return true;
  }
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.08;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function createUnifiedDiff(relativePath: string, before: string, after: string): string {
  if (before === after) {
    return `diff -- ${relativePath}\n(no changes)`;
  }

  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const rows = buildLineDiff(beforeLines, afterLines);
  const body = rows
    .slice(0, 240)
    .map((row) => `${row.kind}${row.value}`)
    .join("\n");
  const truncated = rows.length > 240 ? "\n[diff truncated]" : "";
  return `diff -- ${relativePath}\n--- a/${relativePath}\n+++ b/${relativePath}\n${body}${truncated}`;
}

function buildLineDiff(
  before: string[],
  after: string[]
): Array<{ kind: " " | "+" | "-"; value: string }> {
  const table: number[][] = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const rows: Array<{ kind: " " | "+" | "-"; value: string }> = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: " ", value: before[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      rows.push({ kind: "-", value: before[i]! });
      i += 1;
    } else {
      rows.push({ kind: "+", value: after[j]! });
      j += 1;
    }
  }
  while (i < before.length) {
    rows.push({ kind: "-", value: before[i]! });
    i += 1;
  }
  while (j < after.length) {
    rows.push({ kind: "+", value: after[j]! });
    j += 1;
  }
  return compactUnchangedRuns(rows);
}

function compactUnchangedRuns(rows: Array<{ kind: " " | "+" | "-"; value: string }>) {
  const compacted: Array<{ kind: " " | "+" | "-"; value: string }> = [];
  let unchangedRun: string[] = [];

  const flush = () => {
    if (unchangedRun.length <= 8) {
      compacted.push(...unchangedRun.map((value) => ({ kind: " " as const, value })));
    } else {
      compacted.push(
        ...unchangedRun.slice(0, 3).map((value) => ({ kind: " " as const, value })),
        { kind: " " as const, value: `[${unchangedRun.length - 6} unchanged lines]` },
        ...unchangedRun.slice(-3).map((value) => ({ kind: " " as const, value }))
      );
    }
    unchangedRun = [];
  };

  for (const row of rows) {
    if (row.kind === " ") {
      unchangedRun.push(row.value);
      continue;
    }
    flush();
    compacted.push(row);
  }
  flush();
  return compacted;
}
