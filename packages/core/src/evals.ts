import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BudgetPolicy, WorkspaceContext } from "./types.js";
import type { WorkspaceConfig, WorkspaceEvalTask } from "./workspace-config.js";

export type EvalTaskSource = "built-in" | "workspace";

export type EvalTask = WorkspaceEvalTask & {
  source: EvalTaskSource;
};

export interface EvalScore {
  matchedSignals: string[];
  missingSignals: string[];
  totalSignals: number;
  score: number;
  passed: boolean;
}

export interface EvalRunRecord {
  id: string;
  evalId: string;
  source?: EvalTaskSource;
  label: string;
  workspace: string;
  model: string;
  sessionId: string;
  createdAt: string;
  prompt: string;
  expectedSignals: string[];
  score: EvalScore;
  scoreThreshold?: number;
  thresholdPassed: boolean;
  finalText: string;
}

export interface EvalRunRecordInput {
  workspaceRoot: string;
  model: string;
  sessionId: string;
  finalText: string;
  score: EvalScore;
  scoreThreshold?: number;
  createdAt?: string;
}

export interface EvalRunRecordWriteResult {
  path: string;
  record: EvalRunRecord;
}

export interface EvalRunComparison {
  leftRunId: string;
  rightRunId: string;
  sameEval: boolean;
  evalId: string;
  rightEvalId: string;
  leftScore: number;
  rightScore: number;
  scoreDelta: number;
  leftPassed: boolean;
  rightPassed: boolean;
  thresholdStatusChanged: boolean;
  matchedSignalsAdded: string[];
  matchedSignalsRemoved: string[];
  missingSignalsAdded: string[];
  missingSignalsRemoved: string[];
  finalTextLengthDelta: number;
}

export interface EvalRunSummary {
  id: string;
  evalId: string;
  source?: EvalTaskSource;
  label: string;
  model: string;
  sessionId: string;
  createdAt: string;
  expectedSignals: string[];
  score: EvalScore;
  scoreThreshold?: number;
  thresholdPassed: boolean;
  finalTextLength: number;
}

export interface EvalTaskReport {
  evalId: string;
  label: string;
  source?: EvalTaskSource;
  totalRuns: number;
  averageScore: number;
  bestScore: number;
  worstScore: number;
  latestRunId?: string;
  latestCreatedAt?: string;
  latestScore?: number;
  latestPassed?: boolean;
  latestThresholdPassed?: boolean;
  previousRunId?: string;
  scoreDeltaFromPrevious?: number;
  passChangedFromPrevious?: boolean;
  thresholdStatusChangedFromPrevious?: boolean;
}

export interface EvalRunReport {
  workspace: string;
  generatedAt: string;
  totalRuns: number;
  averageScore: number;
  passRate: number;
  thresholdPassRate: number;
  recentRuns: EvalRunSummary[];
  byEval: EvalTaskReport[];
  latestComparison?: EvalRunComparison;
}

export interface EvalRunReportOptions {
  recentLimit?: number;
  generatedAt?: string;
}

export const builtInEvalTasks: EvalTask[] = [
  {
    source: "built-in",
    id: "repo-map",
    label: "Repository map",
    description: "Read-only inventory of package layout, clients, and core runtime boundaries.",
    prompt:
      "Inspect this repository in read-only mode. Summarize the package layout, clients, shared core, and runtime boundaries. Do not modify files.",
    profile: "inspection",
    maxSteps: 6,
    budget: { maxTokens: 60000 } satisfies BudgetPolicy,
    expectedSignals: ["packages/core", "apps/web", "apps/desktop", "apps/cli", "apps/server"]
  },
  {
    source: "built-in",
    id: "safety-smoke",
    label: "Safety controls",
    description: "Read-only review of policy, approval, shell, DLP, and audit controls.",
    prompt:
      "Inspect this repository in read-only mode. Summarize the implemented safety controls and identify the highest-risk remaining safety gap. Do not modify files.",
    profile: "inspection",
    maxSteps: 8,
    budget: { maxTokens: 80000 } satisfies BudgetPolicy,
    expectedSignals: ["approval", "DLP", "shell", "policy", "audit"]
  },
  {
    source: "built-in",
    id: "release-evidence",
    label: "Release evidence",
    description: "Read-only check of docs, scripts, and demo readiness evidence.",
    prompt:
      "Inspect this repository in read-only mode. Summarize the release and demo evidence available to an interviewer, including verification commands and documented limitations. Do not modify files.",
    profile: "inspection",
    maxSteps: 6,
    budget: { maxTokens: 60000 } satisfies BudgetPolicy,
    expectedSignals: ["runbook", "release checklist", "product readiness", "security model"]
  }
];

export function resolveEvalTasks(config?: WorkspaceConfig): EvalTask[] {
  const builtInIds = new Set(builtInEvalTasks.map((task) => task.id));
  const workspaceTasks = (config?.evals ?? []).map((task): EvalTask => ({ ...task, source: "workspace" }));
  for (const task of workspaceTasks) {
    if (builtInIds.has(task.id)) {
      throw new Error(`Workspace eval '${task.id}' cannot replace a built-in eval.`);
    }
  }
  return [...builtInEvalTasks, ...workspaceTasks];
}

export function resolveEvalTask(evalId: string, config?: WorkspaceConfig): EvalTask {
  const task = resolveEvalTasks(config).find((entry) => entry.id === evalId);
  if (!task) {
    throw new Error(`Unknown eval '${evalId}'. Run 'deepcodex evals list --workspace <path>' to see available evals.`);
  }
  return task;
}

export function scoreEvalResult(task: EvalTask, finalText: string): EvalScore {
  const normalizedFinalText = normalizeEvalText(finalText);
  const matchedSignals = task.expectedSignals.filter((signal) => normalizedFinalText.includes(normalizeEvalText(signal)));
  const missingSignals = task.expectedSignals.filter((signal) => !matchedSignals.includes(signal));
  const totalSignals = task.expectedSignals.length;
  const score = totalSignals === 0 ? 1 : matchedSignals.length / totalSignals;
  return {
    matchedSignals,
    missingSignals,
    totalSignals,
    score,
    passed: missingSignals.length === 0
  };
}

export function evalScoreFailed(score: EvalScore, scoreThreshold: number | undefined): boolean {
  return scoreThreshold !== undefined && score.score < scoreThreshold;
}

export function createEvalRunRecord(task: EvalTask, input: EvalRunRecordInput): EvalRunRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: createEvalRunId(task.id, input.sessionId, createdAt),
    evalId: task.id,
    source: task.source,
    label: task.label,
    workspace: input.workspaceRoot,
    model: input.model,
    sessionId: input.sessionId,
    createdAt,
    prompt: task.prompt,
    expectedSignals: task.expectedSignals,
    score: input.score,
    scoreThreshold: input.scoreThreshold,
    thresholdPassed: !evalScoreFailed(input.score, input.scoreThreshold),
    finalText: input.finalText
  };
}

export async function writeEvalRunRecord(
  workspace: WorkspaceContext,
  record: EvalRunRecord
): Promise<EvalRunRecordWriteResult> {
  const filePath = evalRunFilePath(workspace, record.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { path: filePath, record };
}

export async function listEvalRunRecords(workspace: WorkspaceContext): Promise<EvalRunRecord[]> {
  const directory = evalRunDirectory(workspace);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry): Promise<EvalRunRecord | undefined> => {
        try {
          return await readEvalRunRecord(workspace, entry.name.slice(0, -".json".length));
        } catch {
          return undefined;
        }
      })
  );
  return records
    .filter((record): record is EvalRunRecord => Boolean(record))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function readEvalRunRecord(workspace: WorkspaceContext, runId: string): Promise<EvalRunRecord> {
  const filePath = evalRunFilePath(workspace, runId);
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Eval run not found: ${runId}`);
    }
    throw error;
  });
  return parseEvalRunRecord(raw, filePath);
}

export function compareEvalRunRecords(left: EvalRunRecord, right: EvalRunRecord): EvalRunComparison {
  return {
    leftRunId: left.id,
    rightRunId: right.id,
    sameEval: left.evalId === right.evalId,
    evalId: left.evalId,
    rightEvalId: right.evalId,
    leftScore: left.score.score,
    rightScore: right.score.score,
    scoreDelta: right.score.score - left.score.score,
    leftPassed: left.score.passed,
    rightPassed: right.score.passed,
    thresholdStatusChanged: left.thresholdPassed !== right.thresholdPassed,
    matchedSignalsAdded: listAdded(left.score.matchedSignals, right.score.matchedSignals),
    matchedSignalsRemoved: listRemoved(left.score.matchedSignals, right.score.matchedSignals),
    missingSignalsAdded: listAdded(left.score.missingSignals, right.score.missingSignals),
    missingSignalsRemoved: listRemoved(left.score.missingSignals, right.score.missingSignals),
    finalTextLengthDelta: right.finalText.length - left.finalText.length
  };
}

export async function createEvalRunReport(
  workspace: WorkspaceContext,
  options: EvalRunReportOptions = {}
): Promise<EvalRunReport> {
  const records = await listEvalRunRecords(workspace);
  return createEvalRunReportFromRecords(workspace.root, records, options);
}

export function createEvalRunReportFromRecords(
  workspaceRoot: string,
  records: EvalRunRecord[],
  options: EvalRunReportOptions = {}
): EvalRunReport {
  const recentLimit = clampReportLimit(options.recentLimit, 8, 1, 100);
  const totalRuns = records.length;
  const averageScore = totalRuns === 0 ? 0 : average(records.map((record) => record.score.score));
  const passRate = totalRuns === 0 ? 0 : records.filter((record) => record.score.passed).length / totalRuns;
  const thresholdPassRate =
    totalRuns === 0 ? 0 : records.filter((record) => record.thresholdPassed).length / totalRuns;
  return {
    workspace: workspaceRoot,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    totalRuns,
    averageScore,
    passRate,
    thresholdPassRate,
    recentRuns: records.slice(0, recentLimit).map(summarizeEvalRunRecord),
    byEval: createEvalTaskReports(records),
    latestComparison: records.length >= 2 ? compareEvalRunRecords(records[1]!, records[0]!) : undefined
  };
}

export function summarizeEvalRunRecord(record: EvalRunRecord): EvalRunSummary {
  return {
    id: record.id,
    evalId: record.evalId,
    source: record.source,
    label: record.label,
    model: record.model,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    expectedSignals: record.expectedSignals,
    score: record.score,
    scoreThreshold: record.scoreThreshold,
    thresholdPassed: record.thresholdPassed,
    finalTextLength: record.finalText.length
  };
}

function createEvalTaskReports(records: EvalRunRecord[]): EvalTaskReport[] {
  const groups = new Map<string, EvalRunRecord[]>();
  for (const record of records) {
    groups.set(record.evalId, [...(groups.get(record.evalId) ?? []), record]);
  }
  return [...groups.values()]
    .map((runs) => {
      const latest = runs[0];
      if (!latest) {
        throw new Error("Eval report group has no runs.");
      }
      const previous = runs[1];
      const scores = runs.map((record) => record.score.score);
      return {
        evalId: latest.evalId,
        label: latest.label,
        source: latest.source,
        totalRuns: runs.length,
        averageScore: average(scores),
        bestScore: Math.max(...scores),
        worstScore: Math.min(...scores),
        latestRunId: latest.id,
        latestCreatedAt: latest.createdAt,
        latestScore: latest.score.score,
        latestPassed: latest.score.passed,
        latestThresholdPassed: latest.thresholdPassed,
        previousRunId: previous?.id,
        scoreDeltaFromPrevious: previous ? latest.score.score - previous.score.score : undefined,
        passChangedFromPrevious: previous ? latest.score.passed !== previous.score.passed : undefined,
        thresholdStatusChangedFromPrevious: previous ? latest.thresholdPassed !== previous.thresholdPassed : undefined
      };
    })
    .sort((left, right) => (right.latestCreatedAt ?? "").localeCompare(left.latestCreatedAt ?? ""));
}

function parseEvalRunRecord(raw: string, filePath: string): EvalRunRecord {
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as Partial<EvalRunRecord>;
  if (
    !parsed.id ||
    !parsed.evalId ||
    !parsed.sessionId ||
    !parsed.createdAt ||
    !Array.isArray(parsed.expectedSignals) ||
    !parsed.score
  ) {
    throw new Error(`Invalid eval run record: ${filePath}`);
  }
  return parsed as EvalRunRecord;
}

function normalizeEvalText(value: string): string {
  return value.toLocaleLowerCase();
}

function listAdded(left: string[], right: string[]): string[] {
  const leftSet = new Set(left);
  return right.filter((value) => !leftSet.has(value));
}

function listRemoved(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function evalRunDirectory(workspace: WorkspaceContext): string {
  return path.join(workspace.root, ".deepcodex", "state", "evals");
}

function evalRunFilePath(workspace: WorkspaceContext, runId: string): string {
  assertValidEvalRunId(runId);
  return path.join(evalRunDirectory(workspace), `${runId}.json`);
}

function createEvalRunId(evalId: string, sessionId: string, createdAt: string): string {
  const timestamp = createdAt.replace(/[^0-9A-Za-z]/g, "");
  return `${timestamp}-${evalId}-${sessionId.slice(0, 8)}`;
}

function assertValidEvalRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(`Invalid eval run id: ${runId}`);
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampReportLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
