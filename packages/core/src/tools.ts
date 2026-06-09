import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFParse, VerbosityLevel } from "pdf-parse";
import { createBufferHashSnapshot } from "./file-audit.js";
import { appendWorkspaceMemory, readWorkspaceMemory } from "./memory.js";
import { findSensitiveText, type SensitiveTextFinding } from "./redaction.js";
import { assertShellCommandAllowed, canWriteFiles, createShellEnvironment, truncateForModel } from "./safety.js";
import type { FileAuditEntry, RuntimeTool, ToolResult, ToolRuntime } from "./types.js";
import { isDeniedByPatterns, isDeniedFileExtension, resolveWorkspacePath, workspaceRelative } from "./workspace.js";

const SHELL_MAX_BUFFER_BYTES = 1024 * 1024 * 4;
const SHELL_COPY_MAX_FILES = 2000;
const SHELL_COPY_MAX_BYTES = 64 * 1024 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_EOCD_MAX_SEARCH_BYTES = ZIP_EOCD_MIN_BYTES + 0xffff;
const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 512 * 1024;
const ZIP_MAX_LISTED_ENTRIES = 200;
const ZIP_MAX_PARSED_ENTRIES = 1000;
const PDF_MAX_EXTRACTED_PAGES = 20;
const PDF_DEFAULT_EXTRACTED_PAGES = 5;
const PDF_MAX_EXTRACTED_CHARS = 40_000;
const PDF_DEFAULT_EXTRACTED_CHARS = 20_000;
const PDF_MAX_START_PAGE = 100_000;

export function createDefaultTools(): RuntimeTool[] {
  return [
    listFilesTool,
    readFileTool,
    inspectArtifactTool,
    extractPdfTextTool,
    listArchiveEntriesTool,
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

const extractPdfTextTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "extract_pdf_text",
      description:
        "Extract bounded text from a local PDF file when policy allows it. Does not return raw bytes, base64 content, images, attachments, or embedded files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative PDF path." },
          startPage: { type: "number", description: "First 1-based page to extract.", default: 1 },
          maxPages: { type: "number", description: "Maximum pages to extract, up to 20.", default: PDF_DEFAULT_EXTRACTED_PAGES },
          maxCharacters: {
            type: "number",
            description: "Maximum text characters returned, up to 40000.",
            default: PDF_DEFAULT_EXTRACTED_CHARS
          }
        },
        required: ["path"]
      }
    }
  },
  async run(input, runtime) {
    if (runtime.workspace.policy.allowPdfTextExtraction !== true) {
      return fail(
        "PDF text extraction is disabled by policy. Enable policy.allowPdfTextExtraction only for trusted workspaces that need bounded PDF text."
      );
    }

    const args = objectInput(input);
    const target = resolveWorkspacePath(runtime.workspace, stringValue(args.path));
    const rel = workspaceRelative(runtime.workspace, target);
    if (isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? [])) {
      return fail(`Denied path: ${rel}`);
    }

    const targetStat = await stat(target);
    if (!targetStat.isFile()) {
      return fail(`PDF text extraction requires a file: ${rel}`);
    }
    if (exceedsFileLimit(targetStat.size, runtime)) {
      return fail(`File exceeds maxFileBytes (${runtime.workspace.policy.maxFileBytes}): ${rel}`);
    }

    const header = await readFileSample(target, Math.min(targetStat.size, 8));
    const extension = path.extname(rel).toLowerCase();
    if (extension !== ".pdf" && !startsWithAscii(header, "%PDF-")) {
      return fail(`PDF text extraction requires a .pdf extension or PDF header: ${rel}`);
    }
    if (!startsWithAscii(header, "%PDF-")) {
      return fail(`PDF header was not found: ${rel}`);
    }

    const startPage = clampPositiveInteger(args.startPage, 1, 1, PDF_MAX_START_PAGE);
    const maxPages = clampPositiveInteger(args.maxPages, PDF_DEFAULT_EXTRACTED_PAGES, 1, PDF_MAX_EXTRACTED_PAGES);
    const maxCharacters = clampPositiveInteger(
      args.maxCharacters,
      PDF_DEFAULT_EXTRACTED_CHARS,
      1,
      PDF_MAX_EXTRACTED_CHARS
    );
    const buffer = await readFile(target);
    const extraction = await extractPdfText(buffer, { startPage, maxPages, maxCharacters });
    if (!extraction.ok) {
      return fail(`PDF text extraction failed for ${rel}: ${extraction.content}`);
    }
    return ok(formatPdfTextExtraction(rel, targetStat.size, extension, extraction.result));
  }
};

const listArchiveEntriesTool: RuntimeTool = {
  definition: {
    type: "function",
    function: {
      name: "list_archive_entries",
      description:
        "Safely list ZIP-compatible archive entries as bounded metadata when policy allows it. Does not extract files, decompress content, or return file contents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative ZIP-compatible archive path." },
          maxEntries: { type: "number", description: "Maximum listed entries, up to 200.", default: 80 }
        },
        required: ["path"]
      }
    }
  },
  async run(input, runtime) {
    if (runtime.workspace.policy.allowArchiveListing !== true) {
      return fail(
        "Archive listing is disabled by policy. Enable policy.allowArchiveListing only for trusted workspaces that need ZIP entry metadata."
      );
    }

    const args = objectInput(input);
    const target = resolveWorkspacePath(runtime.workspace, stringValue(args.path));
    const rel = workspaceRelative(runtime.workspace, target);
    if (isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? [])) {
      return fail(`Denied path: ${rel}`);
    }

    const targetStat = await stat(target);
    if (!targetStat.isFile()) {
      return fail(`Archive listing requires a file: ${rel}`);
    }

    const maxEntries = Math.min(Math.max(Math.floor(numberValue(args.maxEntries, 80)), 1), ZIP_MAX_LISTED_ENTRIES);
    const manifest = await readZipManifest(target, rel, targetStat.size, maxEntries, runtime);
    if (!manifest.ok) {
      return fail(manifest.content);
    }
    return ok(formatZipManifest(manifest.manifest));
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
    const execution = await prepareShellExecution(runtime);
    try {
      const result = await runShellCommand(command, {
        cwd: execution.cwd,
        env: createShellEnvironment(runtime.workspace.policy),
        timeout
      });
      if (result.timedOut || result.outputOverflow || result.code !== 0 || result.signal) {
        return fail(truncateForModel(formatShellFailure(result, timeout)), execution.audit);
      }
      return ok(truncateForModel([result.stdout, result.stderr].filter(Boolean).join("\n")), execution.audit);
    } finally {
      await execution.cleanup();
    }
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

function clampPositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const requested = Math.floor(numberValue(value, fallback));
  if (!Number.isFinite(requested)) {
    return fallback;
  }
  return Math.min(Math.max(requested, min), max);
}

function normalizeShellTimeout(value: unknown): number {
  const requested = Math.floor(numberValue(value, 60_000));
  if (requested <= 0) {
    return 60_000;
  }
  return Math.min(Math.max(requested, 100), 180_000);
}

interface ShellExecutionContext {
  cwd: string;
  audit?: ToolResult["audit"];
  cleanup: () => Promise<void>;
}

interface WorkspaceCopyReport {
  copiedFiles: number;
  copiedBytes: number;
  skippedEntries: number;
  maxFiles: number;
  maxBytes: number;
}

async function prepareShellExecution(runtime: ToolRuntime): Promise<ShellExecutionContext> {
  if (runtime.workspace.policy.shellExecutionMode !== "workspace-copy") {
    return {
      cwd: runtime.workspace.root,
      cleanup: async () => undefined
    };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "deepcodex-shell-"));
  const copyRoot = path.join(tempRoot, "workspace");
  let report: WorkspaceCopyReport;
  try {
    await mkdir(copyRoot, { recursive: true });
    report = await copyWorkspaceForShell(runtime.workspace.root, copyRoot, runtime);
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    cwd: copyRoot,
    audit: {
      shell: {
        executionMode: "workspace-copy",
        copiedFiles: report.copiedFiles,
        copiedBytes: report.copiedBytes,
        skippedEntries: report.skippedEntries,
        maxFiles: report.maxFiles,
        maxBytes: report.maxBytes,
        workspaceCopyRemoved: true
      }
    },
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };
}

async function copyWorkspaceForShell(sourceRoot: string, targetRoot: string, runtime: ToolRuntime): Promise<WorkspaceCopyReport> {
  const report: WorkspaceCopyReport = {
    copiedFiles: 0,
    copiedBytes: 0,
    skippedEntries: 0,
    maxFiles: SHELL_COPY_MAX_FILES,
    maxBytes: SHELL_COPY_MAX_BYTES
  };
  await copyWorkspaceEntry(sourceRoot, targetRoot, sourceRoot, runtime, report);
  return report;
}

async function copyWorkspaceEntry(
  source: string,
  target: string,
  sourceRoot: string,
  runtime: ToolRuntime,
  report: WorkspaceCopyReport
): Promise<void> {
  const rel = path.relative(sourceRoot, source) || ".";
  if (rel !== "." && isDeniedByPatterns(rel, runtime.workspace.policy.deniedPaths ?? [])) {
    report.skippedEntries += 1;
    return;
  }

  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink()) {
    report.skippedEntries += 1;
    return;
  }
  if (sourceInfo.isDirectory()) {
    await mkdir(target, { recursive: true });
    const children = await readdir(source, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      await copyWorkspaceEntry(path.join(source, child.name), path.join(target, child.name), sourceRoot, runtime, report);
    }
    return;
  }
  if (!sourceInfo.isFile()) {
    report.skippedEntries += 1;
    return;
  }
  if (isDeniedFileExtension(rel, runtime.workspace.policy.deniedFileExtensions ?? [])) {
    report.skippedEntries += 1;
    return;
  }
  if (exceedsFileLimit(sourceInfo.size, runtime)) {
    report.skippedEntries += 1;
    return;
  }
  if (report.copiedFiles >= report.maxFiles || report.copiedBytes + sourceInfo.size > report.maxBytes) {
    report.skippedEntries += 1;
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  report.copiedFiles += 1;
  report.copiedBytes += sourceInfo.size;
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
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore"
    });
    if (result.error) {
      child.kill("SIGTERM");
    }
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

function fail(content: string, audit?: ToolResult["audit"]): ToolResult {
  return audit ? { ok: false, content, audit } : { ok: false, content };
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
  return readFileRange(target, 0, bytes);
}

async function readFileRange(target: string, offset: number, bytes: number): Promise<Buffer> {
  if (bytes <= 0) {
    return Buffer.alloc(0);
  }
  const handle = await open(target, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const result = await handle.read(buffer, 0, bytes, offset);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

interface PdfTextExtractionOptions {
  startPage: number;
  maxPages: number;
  maxCharacters: number;
}

interface PdfTextExtractionResult {
  totalPages: number;
  pagesExtracted: number;
  requestedStartPage: number;
  requestedEndPage: number;
  originalCharacters: number;
  returnedCharacters: number;
  truncated: boolean;
  text: string;
}

async function extractPdfText(
  buffer: Buffer,
  options: PdfTextExtractionOptions
): Promise<{ ok: true; result: PdfTextExtractionResult } | { ok: false; content: string }> {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    verbosity: VerbosityLevel.ERRORS,
    stopAtErrors: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true
  });
  try {
    const requestedEndPage = options.startPage + options.maxPages - 1;
    const textResult = await parser.getText({ first: options.startPage, last: requestedEndPage });
    const text = textResult.pages
      .map((page) => `Page ${page.num}\n${page.text.trimEnd()}`)
      .join("\n\n")
      .trim();
    const truncatedText = truncateForModel(text, options.maxCharacters);
    const truncated = text.length > options.maxCharacters;
    return {
      ok: true,
      result: {
        totalPages: textResult.total,
        pagesExtracted: textResult.pages.length,
        requestedStartPage: options.startPage,
        requestedEndPage,
        originalCharacters: text.length,
        returnedCharacters: truncatedText.length,
        truncated,
        text: truncatedText
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: message };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function formatPdfTextExtraction(
  relativePath: string,
  bytes: number,
  extension: string,
  result: PdfTextExtractionResult
): string {
  const text = result.text || "(no text extracted)";
  return [
    `PDF: ${relativePath}`,
    `Bytes: ${bytes}`,
    `Extension: ${extension || "(none)"}`,
    `Total pages: ${result.totalPages}`,
    `Pages requested: ${result.requestedStartPage}-${result.requestedEndPage}`,
    `Pages extracted: ${result.pagesExtracted}`,
    `Characters returned: ${result.returnedCharacters}`,
    `Characters before truncation: ${result.originalCharacters}`,
    `Truncated: ${result.truncated ? "yes" : "no"}`,
    "Raw bytes: not returned by policy.",
    "Images and attachments: not extracted.",
    "",
    "Text:",
    text
  ].join("\n");
}

interface ZipEndOfCentralDirectory {
  entriesTotal: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
  eocdOffset: number;
}

interface ZipEntryMetadata {
  name: string;
  directory: boolean;
  compressedSize: number | "zip64";
  uncompressedSize: number | "zip64";
  compressionMethod: number;
  encrypted: boolean;
  unsafePath: boolean;
}

interface ZipManifest {
  archivePath: string;
  bytes: number;
  extension: string;
  entriesDeclared: number;
  entriesParsed: number;
  entriesListed: ZipEntryMetadata[];
  visibleEntriesOmitted: number;
  deniedEntriesOmitted: number;
  centralDirectoryBytesRead: number;
  centralDirectoryBytesDeclared: number;
  truncated: boolean;
}

async function readZipManifest(
  target: string,
  relativePath: string,
  fileSize: number,
  maxEntries: number,
  runtime: ToolRuntime
): Promise<{ ok: true; manifest: ZipManifest } | { ok: false; content: string }> {
  const tailBytes = Math.min(fileSize, ZIP_EOCD_MAX_SEARCH_BYTES);
  const tail = await readFileRange(target, Math.max(0, fileSize - tailBytes), tailBytes);
  const eocd = findZipEndOfCentralDirectory(tail, fileSize);
  if (!eocd.ok) {
    return { ok: false, content: eocd.content };
  }
  if (eocd.eocd.centralDirectoryOffset + eocd.eocd.centralDirectorySize > eocd.eocd.eocdOffset) {
    return { ok: false, content: `Invalid ZIP central directory bounds: ${relativePath}` };
  }

  const centralDirectoryBytesRead = Math.min(eocd.eocd.centralDirectorySize, ZIP_MAX_CENTRAL_DIRECTORY_BYTES);
  const centralDirectory = await readFileRange(
    target,
    eocd.eocd.centralDirectoryOffset,
    centralDirectoryBytesRead
  );
  const parsed = parseZipCentralDirectory(
    centralDirectory,
    eocd.eocd.entriesTotal,
    maxEntries,
    runtime.workspace.policy.deniedPaths ?? []
  );

  return {
    ok: true,
    manifest: {
      archivePath: relativePath,
      bytes: fileSize,
      extension: path.extname(relativePath).toLowerCase() || "(none)",
      entriesDeclared: eocd.eocd.entriesTotal,
      entriesParsed: parsed.entriesParsed,
      entriesListed: parsed.entriesListed,
      visibleEntriesOmitted: parsed.visibleEntriesOmitted,
      deniedEntriesOmitted: parsed.deniedEntriesOmitted,
      centralDirectoryBytesRead,
      centralDirectoryBytesDeclared: eocd.eocd.centralDirectorySize,
      truncated:
        centralDirectoryBytesRead < eocd.eocd.centralDirectorySize ||
        parsed.entriesParsed < eocd.eocd.entriesTotal ||
        parsed.visibleEntriesOmitted > 0
    }
  };
}

function findZipEndOfCentralDirectory(
  buffer: Buffer,
  fileSize: number
): { ok: true; eocd: ZipEndOfCentralDirectory } | { ok: false; content: string } {
  for (let offset = buffer.length - ZIP_EOCD_MIN_BYTES; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) {
      continue;
    }
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength !== buffer.length) {
      continue;
    }

    const diskNumber = buffer.readUInt16LE(offset + 4);
    const centralDirectoryDisk = buffer.readUInt16LE(offset + 6);
    const entriesOnDisk = buffer.readUInt16LE(offset + 8);
    const entriesTotal = buffer.readUInt16LE(offset + 10);
    const centralDirectorySize = buffer.readUInt32LE(offset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(offset + 16);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entriesTotal) {
      return { ok: false, content: "Multi-disk ZIP archives are not supported by the safe archive manifest reader." };
    }
    if (entriesTotal === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
      return { ok: false, content: "ZIP64 archives are not supported by the safe archive manifest reader." };
    }

    return {
      ok: true,
      eocd: {
        entriesTotal,
        centralDirectorySize,
        centralDirectoryOffset,
        eocdOffset: fileSize - buffer.length + offset
      }
    };
  }
  return { ok: false, content: "ZIP end-of-central-directory record was not found." };
}

function parseZipCentralDirectory(
  buffer: Buffer,
  declaredEntries: number,
  maxEntries: number,
  deniedPaths: string[]
): {
  entriesParsed: number;
  entriesListed: ZipEntryMetadata[];
  visibleEntriesOmitted: number;
  deniedEntriesOmitted: number;
} {
  let offset = 0;
  let entriesParsed = 0;
  let visibleEntries = 0;
  let deniedEntriesOmitted = 0;
  const entriesListed: ZipEntryMetadata[] = [];
  const maxParsedEntries = Math.min(declaredEntries, ZIP_MAX_PARSED_ENTRIES);

  while (offset + 46 <= buffer.length && entriesParsed < maxParsedEntries) {
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSizeRaw = buffer.readUInt32LE(offset + 20);
    const uncompressedSizeRaw = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const entryEnd = offset + 46 + fileNameLength + extraFieldLength + fileCommentLength;
    if (entryEnd > buffer.length) {
      break;
    }

    const nameBuffer = buffer.subarray(offset + 46, offset + 46 + fileNameLength);
    const rawName = decodeZipEntryName(nameBuffer, flags);
    const policyPath = archiveEntryPathForPolicy(rawName);
    if (policyPath && isDeniedByPatterns(policyPath, deniedPaths)) {
      deniedEntriesOmitted += 1;
    } else {
      visibleEntries += 1;
      if (entriesListed.length < maxEntries) {
        const displayName = sanitizeArchiveEntryName(rawName);
        entriesListed.push({
          name: displayName,
          directory: rawName.endsWith("/") || (externalAttributes & 0x10) !== 0,
          compressedSize: compressedSizeRaw === 0xffffffff ? "zip64" : compressedSizeRaw,
          uncompressedSize: uncompressedSizeRaw === 0xffffffff ? "zip64" : uncompressedSizeRaw,
          compressionMethod,
          encrypted: (flags & 0x1) !== 0,
          unsafePath: isUnsafeArchivePath(rawName)
        });
      }
    }

    entriesParsed += 1;
    offset = entryEnd;
  }

  return {
    entriesParsed,
    entriesListed,
    visibleEntriesOmitted: Math.max(0, visibleEntries - entriesListed.length),
    deniedEntriesOmitted
  };
}

function decodeZipEntryName(buffer: Buffer, flags: number): string {
  return (flags & 0x800) !== 0 ? buffer.toString("utf8") : buffer.toString("latin1");
}

function archiveEntryPathForPolicy(value: string): string {
  return value.replaceAll("\\", "/").replace(/^[A-Za-z]:/, "").replace(/^\/+/, "");
}

function sanitizeArchiveEntryName(value: string): string {
  const printable = value.replaceAll("\\", "/").replace(/[\u0000-\u001f\u007f]/g, "?");
  if (!printable) {
    return "(empty name)";
  }
  return printable.length > 180 ? `${printable.slice(0, 177)}...` : printable;
}

function isUnsafeArchivePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  );
}

function formatZipManifest(manifest: ZipManifest): string {
  const lines = [
    `Archive: ${manifest.archivePath}`,
    `Bytes: ${manifest.bytes}`,
    `Extension: ${manifest.extension}`,
    `Format: ZIP central directory`,
    `Entries declared: ${manifest.entriesDeclared}`,
    `Entries parsed: ${manifest.entriesParsed}`,
    `Entries listed: ${manifest.entriesListed.length}`,
    `Denied entries omitted: ${manifest.deniedEntriesOmitted}`,
    `Visible entries omitted: ${manifest.visibleEntriesOmitted}`,
    `Central directory bytes read: ${manifest.centralDirectoryBytesRead}`,
    `Central directory bytes declared: ${manifest.centralDirectoryBytesDeclared}`,
    `Truncated: ${manifest.truncated ? "yes" : "no"}`,
    "Raw content: not returned by policy.",
    "Extraction: not performed."
  ];

  if (manifest.entriesListed.length === 0) {
    return [...lines, "", "Entries: none listed."].join("\n");
  }

  return [
    ...lines,
    "",
    "Entries:",
    ...manifest.entriesListed.map((entry) => {
      const flags = [
        entry.encrypted ? "encrypted" : "",
        entry.unsafePath ? "unsafe-path" : ""
      ].filter(Boolean);
      const suffix = flags.length > 0 ? ` | flags=${flags.join(",")}` : "";
      return `- ${entry.name} | ${entry.directory ? "directory" : "file"} | compressed=${formatZipSize(
        entry.compressedSize
      )} | uncompressed=${formatZipSize(entry.uncompressedSize)} | method=${zipCompressionMethodLabel(
        entry.compressionMethod
      )}${suffix}`;
    })
  ].join("\n");
}

function formatZipSize(value: number | "zip64"): string {
  return value === "zip64" ? "zip64" : String(value);
}

function zipCompressionMethodLabel(method: number): string {
  switch (method) {
    case 0:
      return "store";
    case 8:
      return "deflate";
    case 12:
      return "bzip2";
    case 14:
      return "lzma";
    case 93:
      return "zstd";
    default:
      return `method-${method}`;
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
