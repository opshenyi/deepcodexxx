import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { ApprovalPolicy, WorkspaceContext } from "./types.js";

const DEFAULT_POLICY: ApprovalPolicy = {
  mode: "workspace-write",
  allowFileWrite: true,
  allowShell: true,
  allowNetwork: false,
  allowStateWrite: true,
  allowSecretWrites: false,
  allowArchiveListing: false,
  deniedPaths: [
    ".git",
    "**/.git",
    "node_modules",
    "**/node_modules",
    "references/agents",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    ".deepcodex/state",
    "dist",
    "**/dist",
    "build",
    "**/build",
    "coverage",
    "**/coverage",
    ".next",
    "**/.next",
    ".nuxt",
    "**/.nuxt",
    ".turbo",
    "**/.turbo",
    ".cache",
    "**/.cache",
    ".vite",
    "**/.vite",
    ".parcel-cache",
    "**/.parcel-cache"
  ],
  deniedFileExtensions: [
    ".7z",
    ".avi",
    ".bmp",
    ".dll",
    ".doc",
    ".docx",
    ".dylib",
    ".exe",
    ".gif",
    ".gz",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".m4a",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".rar",
    ".so",
    ".tar",
    ".tgz",
    ".wasm",
    ".wav",
    ".webm",
    ".webp",
    ".xls",
    ".xlsx",
    ".zip"
  ],
  maxFileBytes: 512 * 1024,
  shellEnvironment: "minimal"
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
    deniedFileExtensions: uniqueExtensions([
      ...(DEFAULT_POLICY.deniedFileExtensions ?? []),
      ...(policy.deniedFileExtensions ?? [])
    ]),
    redactionPatterns: uniqueDeniedPaths([...(DEFAULT_POLICY.redactionPatterns ?? []), ...(policy.redactionPatterns ?? [])]),
    dlpPatterns: uniqueDeniedPaths([...(DEFAULT_POLICY.dlpPatterns ?? []), ...(policy.dlpPatterns ?? [])]),
    maxFileBytes: policy.maxFileBytes ?? DEFAULT_POLICY.maxFileBytes,
    shellEnvironment: policy.shellEnvironment ?? DEFAULT_POLICY.shellEnvironment
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

export function isDeniedFileExtension(relativePath: string, deniedFileExtensions: string[] = []): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  return Boolean(extension && deniedFileExtensions.map(normalizeExtension).includes(extension));
}

function matchesDeniedPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern.includes("*")) {
    const regex = new RegExp(`^${globPatternToRegexSource(normalizedPattern)}(?:/.*)?$`);
    return regex.test(relativePath);
  }
  return relativePath === normalizedPattern || relativePath.startsWith(`${normalizedPattern}/`);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globPatternToRegexSource(pattern: string): string {
  return pattern
    .split("**")
    .map((part) => part.split("*").map(escapeRegex).join("[^/]*"))
    .join(".*");
}

function uniqueDeniedPaths(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueExtensions(values: string[]): string[] {
  return [...new Set(values.map(normalizeExtension).filter(Boolean))];
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
