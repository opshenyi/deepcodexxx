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

const NETWORK_COMMAND_PATTERNS = [
  /\b(curl|wget|aria2c|ftp|sftp|ssh|scp|rsync|telnet|nc|ncat|netcat|ping|nslookup|dig|tracert|traceroute)\b/i,
  /\b(iwr|irm)\b/i,
  /\binvoke-(webrequest|restmethod)\b/i,
  /\bgit\s+(clone|fetch|pull|push|ls-remote|submodule\s+update)\b/i,
  /\bgh\s+(repo\s+clone|pr\s+checkout|release|auth)\b/i,
  /\bnpm\s+(install|i|ci|add|publish|login)\b/i,
  /\bpnpm\s+(install|i|add|dlx|publish)\b/i,
  /\byarn\s+(install|add|dlx|npm|publish)\b/i,
  /\bbun\s+(install|add|x)\b/i,
  /\bpip3?\s+install\b/i,
  /\bpython3?\s+-m\s+pip\s+install\b/i,
  /\buv\s+(pip\s+)?install\b/i,
  /\bpoetry\s+(add|install|publish)\b/i,
  /\bgo\s+(get|install)\b/i,
  /\bcargo\s+(install|publish)\b/i,
  /\bdocker\s+(pull|push|run|compose)\b/i
];

export function canWriteFiles(policy: ApprovalPolicy): boolean {
  return policy.mode !== "suggest" && policy.allowFileWrite !== false;
}

export function canRunShell(policy: ApprovalPolicy): boolean {
  return policy.mode !== "suggest" && policy.allowShell === true;
}

export function canUseNetwork(policy: ApprovalPolicy): boolean {
  return policy.allowNetwork === true;
}

export function assertShellCommandAllowed(command: string, policy: ApprovalPolicy): void {
  if (!canRunShell(policy)) {
    throw new Error("Shell execution is disabled by the current approval policy.");
  }
  if (policy.mode !== "full-access" && DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
    throw new Error("Shell command requires full-access mode.");
  }
  if (!canUseNetwork(policy) && NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
    throw new Error("Shell command requires network-enabled policy.");
  }
}

export function createShellEnvironment(policy: ApprovalPolicy): NodeJS.ProcessEnv {
  if (policy.shellEnvironment === "inherit") {
    return { ...process.env };
  }

  const allowed = new Set([
    "ALLUSERSPROFILE",
    "APPDATA",
    "COMSPEC",
    "ComSpec",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "Path",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SystemDrive",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
    "windir"
  ]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key)));
}

export function truncateForModel(value: string, maxLength = 20_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = value.slice(0, Math.floor(maxLength * 0.7));
  const tail = value.slice(-Math.floor(maxLength * 0.25));
  return `${head}\n\n[output truncated]\n\n${tail}`;
}
