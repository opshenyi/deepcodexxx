import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appendWorkspaceMemory, readWorkspaceMemory } from "./memory.js";
import { assertShellCommandAllowed, canWriteFiles, truncateForModel } from "./safety.js";
import type { RuntimeTool, ToolResult, ToolRuntime } from "./types.js";
import { isDeniedWorkspacePath, resolveWorkspacePath, workspaceRelative } from "./workspace.js";

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
    await walk(start, runtime.workspace.root, maxDepth, entries);
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
    if (isDeniedWorkspacePath(rel)) {
      return fail(`Denied path: ${rel}`);
    }
    return ok(truncateForModel(await readFile(target, "utf8")));
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
    if (isDeniedWorkspacePath(rel)) {
      return fail(`Denied path: ${rel}`);
    }
    const next = stringValue(args.content);
    const previous = await readFile(target, "utf8").catch(() => "");
    const diff = createUnifiedDiff(rel, previous, next);
    if (!canWriteFiles(runtime.workspace.policy)) {
      return ok(`Preview only. File writes are disabled by the current approval policy.\n\n${diff}`);
    }
    await writeFile(target, next, "utf8");
    const hash = createHash("sha256").update(next).digest("hex").slice(0, 12);
    return ok(`Wrote ${rel} sha256:${hash}\n\n${diff}`);
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
    if (isDeniedWorkspacePath(rel)) {
      return fail(`Denied path: ${rel}`);
    }
    const current = await readFile(target, "utf8");
    const search = stringValue(args.search);
    if (!current.includes(search)) {
      return fail(`Search text was not found in ${rel}`);
    }
    const next = current.replace(search, stringValue(args.replace));
    const diff = createUnifiedDiff(rel, current, next);
    if (!canWriteFiles(runtime.workspace.policy)) {
      return ok(`Preview only. File edits are disabled by the current approval policy.\n\n${diff}`);
    }
    await writeFile(target, next, "utf8");
    return ok(`Edited ${rel}\n\n${diff}`);
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
    await collectFiles(start, runtime.workspace.root, files, 350);
    const matches: string[] = [];
    for (const file of files) {
      const rel = workspaceRelative(runtime.workspace, file);
      if (isDeniedWorkspacePath(rel)) {
        continue;
      }
      const content = await readFile(file, "utf8").catch(() => "");
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
    await appendWorkspaceMemory(runtime.workspace, stringValue(args.note));
    return ok("Memory updated.");
  }
};

async function walk(current: string, root: string, depth: number, entries: string[]): Promise<void> {
  const rel = path.relative(root, current) || ".";
  if (isDeniedWorkspacePath(rel)) {
    return;
  }
  const currentStat = await stat(current);
  entries.push(currentStat.isDirectory() ? `${rel}/` : rel);
  if (!currentStat.isDirectory() || depth <= 0) {
    return;
  }
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80)) {
    await walk(path.join(current, child.name), root, depth - 1, entries);
  }
}

async function collectFiles(current: string, root: string, files: string[], limit: number): Promise<void> {
  if (files.length >= limit) {
    return;
  }
  const rel = path.relative(root, current) || ".";
  if (isDeniedWorkspacePath(rel)) {
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
    await collectFiles(path.join(current, child.name), root, files, limit);
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

function ok(content: string): ToolResult {
  return { ok: true, content };
}

function fail(content: string): ToolResult {
  return { ok: false, content };
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
