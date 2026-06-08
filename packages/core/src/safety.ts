import type { ApprovalPolicy } from "./types.js";

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brmdir\s+\/s\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bformat\b/i,
  /\bdiskpart\b/i,
  /\bshutdown\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\b/i
];

export function canWriteFiles(policy: ApprovalPolicy): boolean {
  return policy.mode !== "suggest" && policy.allowFileWrite !== false;
}

export function canRunShell(policy: ApprovalPolicy): boolean {
  return policy.mode !== "suggest" && policy.allowShell === true;
}

export function assertShellCommandAllowed(command: string, policy: ApprovalPolicy): void {
  if (!canRunShell(policy)) {
    throw new Error("Shell execution is disabled by the current approval policy.");
  }
  if (policy.mode !== "full-access" && DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
    throw new Error("Shell command requires full-access mode.");
  }
}

export function truncateForModel(value: string, maxLength = 20_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = value.slice(0, Math.floor(maxLength * 0.7));
  const tail = value.slice(-Math.floor(maxLength * 0.25));
  return `${head}\n\n[output truncated]\n\n${tail}`;
}

