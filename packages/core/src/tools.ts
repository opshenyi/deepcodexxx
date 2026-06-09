import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBufferHashSnapshot } from "./file-audit.js";
import { appendWorkspaceMemory, readWorkspaceMemory } from "./memory.js";
import { findSensitiveText, type SensitiveTextFinding } from "./redaction.js";
import { assertShellCommandAllowed, canWriteFiles, createShellEnvironment, truncateForModel } from "./safety.js";
import type { FileAuditEntry, RuntimeTool, ToolResult, ToolRuntime } from "./types.js";
import { isDeniedByPatterns, isDeniedFileExtension, resolveWorkspacePath, workspaceRelative } from "./workspace.js";

const SHELL_MAX_BUFFER_BYTES = 1024 * 1024 * 4;

export function createDefaultTools(): RuntimeTool[] {
  return [
    listFilesTool,
    readFileTool,
    inspectArtifactTool,
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
    await walk(
      start,
      runtime.workspace.root,
      maxDepth,
      entries,
      runtime.workspace.policy.deniedPaths ?? [],
      runtime.workspace.policy.deniedFileExtensions ?? []
    );
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
    const denial = filePolicyDenial(rel, runtime);
    if (denial) {
      return fail(denial);
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

const inspectArtifactTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "inspect_artifact",
      description:
        "Safely inspect a non-text artifact or media file by returning metadata only. Does not return raw bytes, text extraction, or base64 content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative artifact path." }
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
    if (!targetStat.isFile()) {
      return fail(`Artifact inspection requires a file: ${rel}`);
    }

    const sample = await readFileSample(target, Math.min(targetStat.size, 64 * 1024));
    const detected = detectArtifact(sample, rel);
    const sampleHash = createBufferHashSnapshot(sample);
    const lines = [
      `Artifact: ${rel}`,
      `Bytes: ${targetStat.size}`,
      `Extension: ${path.extname(rel).toLowerCase() || "(none)"}`,
      `Detected type: ${detected.type}`,
      `Binary-looking: ${isProbablyBinary(sample) ? "yes" : "no"}`,
      detected.dimensions ? `Dimensions: ${detected.dimensions.width}x${detected.dimensions.height}` : "",
      `Sample SHA-256: ${sampleHash.sha256}`,
      `Sample bytes: ${sample.length}`,
      "Raw content: not returned by policy."
    ].filter(Boolean);

    return ok(lines.join("\n"));
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
    const denial = filePolicyDenial(rel, runtime);
    if (denial) {
      return fail(denial);
    }
    const next = stringValue(args.content);
    if (exceedsFileLimit(Buffer.byteLength(next, "utf8"), runtime)) {
      return fail(`Content exceeds maxFileBytes (${runtime.workspace.policy.maxFileBytes}): ${rel}`);
    }
    const secretDenial = secretWriteDenial(next, runtime);
    if (secretDenial) {
      return fail(secretDenial);
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
    const denial = filePolicyDenial(rel, runtime);
    if (denial) {
      return fail(denial);
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
    const secretDenial = secretWriteDenial(next, runtime);
    if (secretDenial) {
      return fail(secretDenial);
    }
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
    await collectFiles(
      start,
      runtime.workspace.root,
      files,
      350,
      runtime.workspace.policy.deniedPaths ?? [],
      runtime.workspace.policy.deniedFileExtensions ?? []
    );
    const matches: string[] = [];
    for (const file of files) {
      const rel = workspaceRelative(runtime.workspace, file);
      if (
        isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? []) ||
        isDeniedFileExtension(rel, runtime.workspace.policy.deniedFileExtensions ?? [])
      ) {
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
    const timeout = normalizeShellTimeout(args.timeoutMs);
    const result = await runShellCommand(command, {
      cwd: runtime.workspace.root,
      env: createShellEnvironment(runtime.workspace.policy),
      timeout
    });
    if (result.timedOut || result.outputOverflow || result.code !== 0 || result.signal) {
      return fail(truncateForModel(formatShellFailure(result, timeout)));
    }
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
  deniedPaths: string[],
  deniedFileExtensions: string[]
): Promise<void> {
  const rel = path.relative(root, current) || ".";
  if (isDeniedByPatterns(rel, deniedPaths)) {
    return;
  }
  const currentStat = await stat(current);
  if (!currentStat.isDirectory() && isDeniedFileExtension(rel, deniedFileExtensions)) {
    return;
  }
  entries.push(currentStat.isDirectory() ? `${rel}/` : rel);
  if (!currentStat.isDirectory() || depth <= 0) {
    return;
  }
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80)) {
    await walk(path.join(current, child.name), root, depth - 1, entries, deniedPaths, deniedFileExtensions);
  }
}

async function collectFiles(
  current: string,
  root: string,
  files: string[],
  limit: number,
  deniedPaths: string[],
  deniedFileExtensions: string[]
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
    if (isDeniedFileExtension(rel, deniedFileExtensions)) {
      return;
    }
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
    await collectFiles(path.join(current, child.name), root, files, limit, deniedPaths, deniedFileExtensions);
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

function normalizeShellTimeout(value: unknown): number {
  const requested = Math.floor(numberValue(value, 60_000));
  if (requested <= 0) {
    return 60_000;
  }
  return Math.min(Math.max(requested, 100), 180_000);
}

interface ShellCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputOverflow: boolean;
}

function runShellCommand(
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }
): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputOverflow = false;
    let finished = false;
    let timeoutTimer: NodeJS.Timeout;
    let hardStopTimer: NodeJS.Timeout | undefined;

    const finish = (result: Omit<ShellCommandResult, "stdout" | "stderr" | "timedOut" | "outputOverflow">) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutTimer);
      if (hardStopTimer) {
        clearTimeout(hardStopTimer);
      }
      resolve({ stdout, stderr, timedOut, outputOverflow, ...result });
    };

    const stop = () => {
      terminateProcessTree(child);
      hardStopTimer = setTimeout(() => finish({ code: null, signal: "SIGTERM" }), 2_000);
      hardStopTimer.unref?.();
    };

    const appendOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (outputOverflow) {
        return;
      }
      const remaining = SHELL_MAX_BUFFER_BYTES - outputBytes;
      if (remaining <= 0) {
        outputOverflow = true;
        stop();
        return;
      }
      const next = chunk.subarray(0, Math.max(0, remaining)).toString("utf8");
      if (stream === "stdout") {
        stdout += next;
      } else {
        stderr += next;
      }
      outputBytes += chunk.length;
      if (chunk.length > remaining) {
        outputOverflow = true;
        stop();
      }
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeout);

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error) => {
      stderr ||= error.message;
      finish({ code: null, signal: null });
    });
    child.on("close", (code, signal) => finish({ code, signal }));
  });
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) {
    child.kill("SIGTERM");
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.on("error", () => child.kill("SIGTERM"));
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const forceKill = setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 500);
  forceKill.unref?.();
}

function formatShellFailure(result: ShellCommandResult, timeout: number): string {
  const status = result.outputOverflow
    ? `Command output exceeded ${SHELL_MAX_BUFFER_BYTES} bytes and was stopped.`
    : result.timedOut
      ? `Command timed out or was terminated after ${timeout}ms.`
      : result.signal
        ? `Command was terminated by signal ${result.signal}.`
        : `Command failed${result.code === null ? "." : ` with exit code ${result.code}.`}`;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return output ? `${status}\n${output}` : `${status}\nNo output captured.`;
}

function ok(content: string, audit?: ToolResult["audit"]): ToolResult {
  return audit ? { ok: true, content, audit } : { ok: true, content };
}

function fail(content: string): ToolResult {
  return { ok: false, content };
}

function filePolicyDenial(relativePath: string, runtime: ToolRuntime): string | undefined {
  if (isDeniedByPatterns(relativePath, runtime.workspace.policy.deniedPaths ?? [])) {
    return `Denied path: ${relativePath}`;
  }
  if (isDeniedFileExtension(relativePath, runtime.workspace.policy.deniedFileExtensions ?? [])) {
    return `Denied file extension: ${relativePath}`;
  }
  return undefined;
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

function secretWriteDenial(content: string, runtime: ToolRuntime): string | undefined {
  if (runtime.workspace.policy.allowSecretWrites === true) {
    return undefined;
  }
  const findings = findSensitiveText(content, {
    additionalPatterns: runtime.workspace.policy.dlpPatterns
  });
  if (findings.length === 0) {
    return undefined;
  }
  return `Potential secret content blocked by DLP policy: ${formatSensitiveFindings(findings)}. Use environment variables or enable allowSecretWrites only for a trusted workspace policy.`;
}

function formatSensitiveFindings(findings: SensitiveTextFinding[]): string {
  const summary = findings
    .slice(0, 5)
    .map((finding) => `${finding.type}:${finding.label}`)
    .join(", ");
  return findings.length > 5 ? `${summary}, and ${findings.length - 5} more` : summary;
}

async function readUtf8TextFile(target: string): Promise<string | undefined> {
  const buffer = await readFile(target);
  if (isProbablyBinary(buffer)) {
    return undefined;
  }
  return buffer.toString("utf8");
}

async function readFileSample(target: string, bytes: number): Promise<Buffer> {
  if (bytes <= 0) {
    return Buffer.alloc(0);
  }
  const handle = await open(target, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const result = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
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

function detectArtifact(buffer: Buffer, relativePath: string): { type: string; dimensions?: { width: number; height: number } } {
  if (isPng(buffer)) {
    return {
      type: "image/png",
      dimensions:
        buffer.length >= 24
          ? {
              width: buffer.readUInt32BE(16),
              height: buffer.readUInt32BE(20)
            }
          : undefined
    };
  }
  if (isGif(buffer)) {
    return {
      type: "image/gif",
      dimensions:
        buffer.length >= 10
          ? {
              width: buffer.readUInt16LE(6),
              height: buffer.readUInt16LE(8)
            }
          : undefined
    };
  }
  const jpegDimensions = readJpegDimensions(buffer);
  if (jpegDimensions || isJpeg(buffer)) {
    return { type: "image/jpeg", dimensions: jpegDimensions };
  }
  if (startsWithAscii(buffer, "%PDF-")) {
    return { type: "application/pdf" };
  }
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return { type: "application/zip" };
  }
  if (buffer.length >= 8 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return { type: "video/mp4-or-quicktime" };
  }
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "RIFF") {
    return { type: "riff-container" };
  }
  const extension = path.extname(relativePath).toLowerCase();
  return { type: extension ? `unknown (${extension})` : "unknown" };
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isGif(buffer: Buffer): boolean {
  return startsWithAscii(buffer, "GIF87a") || startsWithAscii(buffer, "GIF89a");
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (!isJpeg(buffer)) {
    return undefined;
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) {
      return undefined;
    }
    if (marker && marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

function startsWithAscii(buffer: Buffer, value: string): boolean {
  return buffer.length >= value.length && buffer.toString("ascii", 0, value.length) === value;
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
