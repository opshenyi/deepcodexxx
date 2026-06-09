import { createEvalRunReport, type EvalRunReport, type EvalRunReportOptions } from "./evals.js";
import {
  type PolicyBundleVerificationOptions,
  type PolicyBundleVerificationResult,
  verifyWorkspacePolicyBundle
} from "./policy-bundle.js";
import {
  scanWorkspaceSensitiveText,
  type SensitiveTextScanOptions,
  type SensitiveTextScanResult
} from "./sensitive-scan.js";
import { listSessionHistories, type SessionSummary } from "./session-store.js";
import type { ApprovalPolicy, WorkspaceContext } from "./types.js";
import { readWorkspaceConfig, type WorkspaceConfigReadResult } from "./workspace-config.js";
import { createWorkspaceContext } from "./workspace.js";

export type ReleaseEvidenceStatus = "pass" | "warn" | "fail" | "info";
export type ReleaseEvidenceFormat = "json" | "markdown";

export interface ReleaseEvidenceCheck {
  id: string;
  label: string;
  status: ReleaseEvidenceStatus;
  detail: string;
}

export interface ReleaseEvidenceProviderStatus {
  deepSeekConfigured?: boolean;
}

export interface ReleaseEvidenceSessionSummary {
  total: number;
  recent: SessionSummary[];
}

export interface ReleaseEvidenceSummary {
  ready: boolean;
  pass: number;
  warn: number;
  fail: number;
  info: number;
}

export interface ReleaseEvidenceReport {
  generatedAt: string;
  workspace: string;
  provider: ReleaseEvidenceProviderStatus;
  signedPolicyRequired: boolean;
  workspaceConfig: WorkspaceConfigReadResult;
  policyBundle: PolicyBundleVerificationResult;
  evals: EvalRunReport;
  securityScan: SensitiveTextScanResult;
  sessions: ReleaseEvidenceSessionSummary;
  checks: ReleaseEvidenceCheck[];
  summary: ReleaseEvidenceSummary;
}

export interface CreateReleaseEvidenceReportOptions {
  generatedAt?: Date | string;
  policyBundleVerification?: PolicyBundleVerificationOptions;
  signedPolicyRequired?: boolean;
  deepSeekConfigured?: boolean;
  evalReport?: EvalRunReportOptions;
  securityScan?: SensitiveTextScanOptions;
  recentSessionLimit?: number;
}

export async function createReleaseEvidenceReport(
  workspaceInput: string,
  options: CreateReleaseEvidenceReportOptions = {}
): Promise<ReleaseEvidenceReport> {
  const workspaceConfig = await readWorkspaceConfig(workspaceInput);
  const workspace = await createReleaseEvidenceWorkspace(workspaceConfig.path, workspaceConfig);
  const [policyBundle, evals, securityScan, sessions] = await Promise.all([
    verifyWorkspacePolicyBundle(workspace.root, options.policyBundleVerification),
    createEvalRunReport(workspace, options.evalReport),
    scanWorkspaceSensitiveText(workspace, options.securityScan),
    listSessionHistories(workspace)
  ]);
  const recentLimit = clampReportLimit(options.recentSessionLimit, 8, 1, 100);
  const generatedAt = normalizeReportDate(options.generatedAt ?? new Date(), "generatedAt");
  const provider: ReleaseEvidenceProviderStatus = {
    deepSeekConfigured: options.deepSeekConfigured
  };
  const signedPolicyRequired = options.signedPolicyRequired ?? false;
  const reportBase = {
    generatedAt,
    workspace: workspace.root,
    provider,
    signedPolicyRequired,
    workspaceConfig,
    policyBundle,
    evals,
    securityScan,
    sessions: {
      total: sessions.length,
      recent: sessions.slice(0, recentLimit)
    }
  };
  const checks = createReleaseEvidenceChecks(reportBase);
  return {
    ...reportBase,
    checks,
    summary: summarizeChecks(checks)
  };
}

export function exportReleaseEvidenceReport(
  report: ReleaseEvidenceReport,
  format: ReleaseEvidenceFormat = "markdown"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  return renderReleaseEvidenceMarkdown(report);
}

export function parseReleaseEvidenceFormat(value: unknown): ReleaseEvidenceFormat {
  if (value === undefined || value === null || value === "" || value === "markdown") {
    return "markdown";
  }
  if (value === "json") {
    return "json";
  }
  throw new Error("format must be markdown or json");
}

async function createReleaseEvidenceWorkspace(
  workspaceConfigPath: string,
  workspaceConfig: WorkspaceConfigReadResult
): Promise<WorkspaceContext> {
  const workspaceRoot = workspaceConfigPath.replace(/[\\/]?\.deepcodex[\\/]config\.json$/, "");
  const configPolicy = workspaceConfig.config.policy ?? {};
  const policy: ApprovalPolicy = {
    ...configPolicy,
    mode: "suggest",
    allowFileWrite: false,
    allowShell: false,
    allowStateWrite: false,
    allowNetwork: false
  };
  return createWorkspaceContext(workspaceRoot, policy);
}

function createReleaseEvidenceChecks(input: Omit<ReleaseEvidenceReport, "checks" | "summary">): ReleaseEvidenceCheck[] {
  const checks: ReleaseEvidenceCheck[] = [
    {
      id: "deepseek-api-key",
      label: "DeepSeek API key",
      status: input.provider.deepSeekConfigured === undefined ? "info" : input.provider.deepSeekConfigured ? "pass" : "warn",
      detail:
        input.provider.deepSeekConfigured === undefined
          ? "Provider key status was not supplied by this caller."
          : input.provider.deepSeekConfigured
            ? "DeepSeek API key is configured for live demos."
            : "DeepSeek API key is missing; the product will use local demo mode."
    },
    {
      id: "workspace-config",
      label: "Workspace config",
      status: input.workspaceConfig.exists ? "pass" : "warn",
      detail: input.workspaceConfig.exists
        ? `Config present with SHA-256 ${input.workspaceConfig.sha256 ?? "unknown"}.`
        : ".deepcodex/config.json is missing; built-in and environment defaults will be used."
    },
    {
      id: "policy-bundle",
      label: "Policy bundle",
      status: input.policyBundle.ok ? "pass" : input.signedPolicyRequired ? "fail" : "warn",
      detail: input.policyBundle.reason
    },
    {
      id: "eval-evidence",
      label: "Eval evidence",
      status: input.evals.totalRuns > 0 ? "pass" : "warn",
      detail:
        input.evals.totalRuns > 0
          ? `${input.evals.totalRuns} recorded eval run(s), average score ${input.evals.averageScore.toFixed(2)}.`
          : "No recorded eval runs found."
    },
    {
      id: "security-scan",
      label: "Security scan",
      status: input.securityScan.findings.length === 0 ? "pass" : "warn",
      detail:
        input.securityScan.findings.length === 0
          ? `Scanned ${input.securityScan.scannedFiles} file(s); no probable secrets found.`
          : `${input.securityScan.findings.length} probable secret signal(s) found in ${input.securityScan.filesWithFindings} file(s).`
    },
    {
      id: "session-history",
      label: "Session history",
      status: input.sessions.total > 0 ? "pass" : "info",
      detail:
        input.sessions.total > 0
          ? `${input.sessions.total} persisted session(s) available for audit replay.`
          : "No persisted sessions found."
    }
  ];
  return checks;
}

function summarizeChecks(checks: ReleaseEvidenceCheck[]): ReleaseEvidenceSummary {
  const summary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    info: checks.filter((check) => check.status === "info").length
  };
  return {
    ...summary,
    ready: summary.fail === 0
  };
}

function renderReleaseEvidenceMarkdown(report: ReleaseEvidenceReport): string {
  return [
    "# DeepCodex Release Evidence",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Workspace: ${report.workspace}`,
    `- Ready: ${report.summary.ready ? "yes" : "no"}`,
    `- Checks: ${report.summary.pass} pass / ${report.summary.warn} warn / ${report.summary.fail} fail / ${report.summary.info} info`,
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.status} | ${escapeMarkdownCell(check.label)} | ${escapeMarkdownCell(check.detail)} |`),
    "",
    "## Policy",
    "",
    `- Config: ${report.workspaceConfig.exists ? report.workspaceConfig.path : "missing"}`,
    `- Config SHA-256: ${report.workspaceConfig.sha256 ?? "not available"}`,
    `- Signed policy required: ${report.signedPolicyRequired ? "yes" : "no"}`,
    `- Policy bundle: ${report.policyBundle.exists ? report.policyBundle.path : "missing"}`,
    `- Policy bundle status: ${report.policyBundle.ok ? "trusted" : report.policyBundle.signatureVerified ? "untrusted" : "failed"}`,
    `- Policy bundle reason: ${report.policyBundle.reason}`,
    "",
    "## Evals",
    "",
    `- Runs: ${report.evals.totalRuns}`,
    `- Average score: ${report.evals.averageScore.toFixed(2)}`,
    `- Pass rate: ${Math.round(report.evals.passRate * 100)}%`,
    `- Threshold pass rate: ${Math.round(report.evals.thresholdPassRate * 100)}%`,
    "",
    "## Security Scan",
    "",
    `- Scanned files: ${report.securityScan.scannedFiles}`,
    `- Files with findings: ${report.securityScan.filesWithFindings}`,
    `- Findings: ${report.securityScan.findings.length}`,
    `- Truncated: ${report.securityScan.truncated ? "yes" : "no"}`,
    "",
    "## Sessions",
    "",
    `- Persisted sessions: ${report.sessions.total}`,
    ...report.sessions.recent.map(
      (session) =>
        `- ${session.sessionId}: ${session.status}, ${session.eventCount} events, ${session.updatedAt}`
    ),
    ""
  ].join("\n");
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function normalizeReportDate(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid date.`);
  }
  return date.toISOString();
}

function clampReportLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}
