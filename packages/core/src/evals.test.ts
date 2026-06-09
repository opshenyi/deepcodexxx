import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareEvalRunRecords,
  createEvalRunReport,
  createEvalRunRecord,
  evalScoreFailed,
  listEvalRunRecords,
  readEvalRunRecord,
  resolveEvalTask,
  resolveEvalTasks,
  scoreEvalResult,
  writeEvalRunRecord
} from "./evals.js";
import { createWorkspaceContext } from "./workspace.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("eval records and reports", () => {
  it("resolves built-in and workspace eval tasks without allowing replacement", () => {
    const tasks = resolveEvalTasks({
      evals: [
        {
          id: "workspace-smoke",
          label: "Workspace smoke",
          description: "Project-specific smoke task.",
          prompt: "Inspect the workspace.",
          profile: "inspection",
          maxSteps: 2,
          expectedSignals: ["workspace"]
        }
      ]
    });

    expect(tasks.map((task) => task.id)).toContain("repo-map");
    expect(resolveEvalTask("workspace-smoke", { evals: tasks.filter((task) => task.source === "workspace") }).source).toBe(
      "workspace"
    );
    expect(() =>
      resolveEvalTasks({
        evals: [
          {
            id: "repo-map",
            label: "Replacement",
            description: "Should not replace built-in tasks.",
            prompt: "Noop",
            profile: "inspection",
            maxSteps: 1,
            expectedSignals: ["noop"]
          }
        ]
      })
    ).toThrow(/cannot replace/);
  });

  it("scores exact signals and applies thresholds", () => {
    const task = resolveEvalTask("repo-map");
    const score = scoreEvalResult(task, "The product has packages/core, apps/web, apps/desktop, and apps/cli.");

    expect(score.matchedSignals).toEqual(["packages/core", "apps/web", "apps/desktop", "apps/cli"]);
    expect(score.missingSignals).toEqual(["apps/server"]);
    expect(score.score).toBe(0.8);
    expect(score.passed).toBe(false);
    expect(evalScoreFailed(score, 0.9)).toBe(true);
    expect(evalScoreFailed(score, 0.8)).toBe(false);
  });

  it("writes, lists, reads, compares, and reports eval records", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, { mode: "suggest" });
    const task = resolveEvalTask("repo-map");
    const firstScore = scoreEvalResult(task, "packages/core apps/web apps/desktop");
    const secondScore = scoreEvalResult(task, "packages/core apps/web apps/desktop apps/cli apps/server");
    const first = createEvalRunRecord(task, {
      workspaceRoot: workspace.root,
      model: "deepseek-chat",
      sessionId: "session-alpha",
      finalText: "packages/core apps/web apps/desktop",
      score: firstScore,
      scoreThreshold: 0.8,
      createdAt: "2026-06-09T01:00:00.000Z"
    });
    const second = createEvalRunRecord(task, {
      workspaceRoot: workspace.root,
      model: "deepseek-chat",
      sessionId: "session-beta",
      finalText: "packages/core apps/web apps/desktop apps/cli apps/server",
      score: secondScore,
      scoreThreshold: 0.8,
      createdAt: "2026-06-09T02:00:00.000Z"
    });

    await writeEvalRunRecord(workspace, first);
    await writeEvalRunRecord(workspace, second);
    await mkdir(path.join(tempDir, ".deepcodex", "state", "evals"), { recursive: true });
    await writeFile(path.join(tempDir, ".deepcodex", "state", "evals", "broken.json"), "{", "utf8");

    const records = await listEvalRunRecords(workspace);
    expect(records.map((record) => record.id)).toEqual([second.id, first.id]);
    await expect(readEvalRunRecord(workspace, first.id)).resolves.toMatchObject({ id: first.id });

    const comparison = compareEvalRunRecords(first, second);
    expect(comparison.scoreDelta).toBeCloseTo(0.4);
    expect(comparison.matchedSignalsAdded).toEqual(["apps/cli", "apps/server"]);
    expect(comparison.thresholdStatusChanged).toBe(true);

    const report = await createEvalRunReport(workspace, { recentLimit: 1, generatedAt: "2026-06-09T03:00:00.000Z" });
    expect(report.totalRuns).toBe(2);
    expect(report.averageScore).toBeCloseTo(0.8);
    expect(report.passRate).toBe(0.5);
    expect(report.thresholdPassRate).toBe(0.5);
    expect(report.recentRuns).toHaveLength(1);
    expect(report.recentRuns[0]).toMatchObject({
      id: second.id,
      finalTextLength: second.finalText.length
    });
    expect(report.byEval[0]).toMatchObject({
      evalId: "repo-map",
      totalRuns: 2,
      latestRunId: second.id,
      previousRunId: first.id,
      latestScore: 1,
      scoreDeltaFromPrevious: 0.4
    });
    expect(JSON.stringify(report)).not.toContain(second.finalText);
  });
});
