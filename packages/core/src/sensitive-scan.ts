import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { findSensitiveText } from "./redaction.js";
import type { WorkspaceContext } from "./types.js";
import { isDeniedByPatterns, isDeniedFileExtension, workspaceRelative } from "./workspace.js";

const DEFAULT_MAX_SCAN_FILES = 500;
const DEFAULT_MAX_SCAN_FINDINGS = 200;
const BINARY_SAMPLE_BYTES = 4096;

export interface SensitiveTextScanOptions {
  maxFiles?: number;
  maxFindings?: number;
}

export interface SensitiveTextScanFinding {
  path: string;
  line: number;
  type: string;
  label: string;
}

export interface SensitiveTextScanResult {
  scannedFiles: number;
  filesWithFindings: number;
  findings: SensitiveTextScanFinding[];
  maxFiles: number;
  maxFindings: number;
  truncated: boolean;
  skipped: {
    denied: number;
    oversized: number;
    binary: number;
    unreadable: number;
  };
}

export async function scanWorkspaceSensitiveText(
  workspace: WorkspaceContext,
  options: SensitiveTextScanOptions = {}
): Promise<SensitiveTextScanResult> {
  const maxFiles = clampScanLimit(options.maxFiles, DEFAULT_MAX_SCAN_FILES, 1, 5_000);
  const maxFindings = clampScanLimit(options.maxFindings, DEFAULT_MAX_SCAN_FINDINGS, 1, 2_000);
  const result: SensitiveTextScanResult = {
    scannedFiles: 0,
    filesWithFindings: 0,
    findings: [],
    maxFiles,
    maxFindings,
    truncated: false,
    skipped: {
      denied: 0,
      oversized: 0,
      binary: 0,
      unreadable: 0
    }
  };

  await scanPath(workspace.root, workspace, result);
  return result;
}

async function scanPath(current: string, workspace: WorkspaceContext, result: SensitiveTextScanResult): Promise<void> {
  if (result.scannedFiles >= result.maxFiles || result.findings.length >= result.maxFindings) {
    result.truncated = true;
    return;
  }

  const rel = normalizedRelativePath(workspace, current);
  if (isDeniedByPatterns(rel, workspace.policy.deniedPaths ?? [])) {
    result.skipped.denied += 1;
    return;
  }

  const currentStat = await stat(current).catch(() => null);
  if (!currentStat) {
    result.skipped.unreadable += 1;
    return;
  }
  if (currentStat.isDirectory()) {
    const children = await readdir(current, { withFileTypes: true }).catch(() => undefined);
    if (!children) {
      result.skipped.unreadable += 1;
      return;
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      await scanPath(path.join(current, child.name), workspace, result);
      if (result.truncated) {
        return;
      }
    }
    return;
  }
  if (!currentStat.isFile()) {
    result.skipped.unreadable += 1;
    return;
  }
  if (isDeniedFileExtension(rel, workspace.policy.deniedFileExtensions ?? [])) {
    result.skipped.denied += 1;
    return;
  }
  if (exceedsScanFileLimit(currentStat.size, workspace)) {
    result.skipped.oversized += 1;
    return;
  }

  const buffer = await readFile(current).catch(() => undefined);
  if (!buffer) {
    result.skipped.unreadable += 1;
    return;
  }
  if (isProbablyBinary(buffer)) {
    result.skipped.binary += 1;
    return;
  }

  result.scannedFiles += 1;
  const content = buffer.toString("utf8");
  const findings = findSensitiveText(content, { additionalPatterns: workspace.policy.dlpPatterns });
  if (findings.length === 0) {
    return;
  }
  result.filesWithFindings += 1;
  for (const finding of findings) {
    if (result.findings.length >= result.maxFindings) {
      result.truncated = true;
      return;
    }
    result.findings.push({
      path: rel,
      line: lineNumberAtIndex(content, finding.index),
      type: finding.type,
      label: finding.label
    });
  }
}

function normalizedRelativePath(workspace: WorkspaceContext, absolutePath: string): string {
  return workspaceRelative(workspace, absolutePath).replaceAll("\\", "/") || ".";
}

function exceedsScanFileLimit(size: number, workspace: WorkspaceContext): boolean {
  const limit = workspace.policy.maxFileBytes;
  return typeof limit === "number" && Number.isFinite(limit) && limit >= 0 && size > limit;
}

function lineNumberAtIndex(value: string, index: number): number {
  let line = 1;
  for (let offset = 0; offset < value.length && offset < index; offset += 1) {
    if (value[offset] === "\n") {
      line += 1;
    }
  }
  return line;
}

function clampScanLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
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
