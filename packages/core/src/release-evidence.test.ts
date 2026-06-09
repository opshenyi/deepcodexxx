import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvalRunRecord, resolveEvalTask, scoreEvalResult, writeEvalRunRecord } from "./evals.js";
import {
  createReleaseEvidenceReport,
  exportReleaseEvidenceReport,
  parseReleaseEvidenceFormat
} from "./release-evidence.js";
import { createWorkspaceContext } from "./workspace.js";
import { writeWorkspaceConfigTemplate } from "./workspace-config.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("release evidence report", () => {
  it("aggregates config, eval, security, and session evidence without secret values", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "config.txt"), "DEEPSEEK_API_KEY=release-secret\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir, { mode: "suggest" });
    const task = resolveEvalTask("repo-map");
    const score = scoreEvalResult(task, "packages/core apps/web apps/desktop apps/cli apps/server");
    await writeEvalRunRecord(
      workspace,
      createEvalRunRecord(task, {
        workspaceRoot: workspace.root,
        model: "deepseek-chat",
        sessionId: "session-release",
        finalText: "packages/core apps/web apps/desktop apps/cli apps/server",
        score,
        scoreThreshold: 1,
        createdAt: "2026-06-09T01:00:00.000Z"
      })
    );

    const report = await createReleaseEvidenceReport(tempDir, {
      deepSeekConfigured: false,
      signedPolicyRequired: false,
      generatedAt: "2026-06-09T02:00:00.000Z",
      evalReport: { generatedAt: "2026-06-09T02:00:00.000Z" },
      securityScan: { maxFiles: 20, maxFindings: 20 }
    });

    expect(report.generatedAt).toBe("2026-06-09T02:00:00.000Z");
    expect(report.workspaceConfig).toMatchObject({
      exists: true,
      sha256: workspaceConfig.sha256
    });
    expect(report.evals.totalRuns).toBe(1);
    expect(report.securityScan.findings).toHaveLength(1);
    expect(report.securityScan.findings[0]).toMatchObject({
      path: "src/config.txt",
      line: 1,
      type: "secret-assignment",
      label: "DEEPSEEK_API_KEY"
    });
    expect(report.checks.find((check) => check.id === "eval-evidence")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "security-scan")?.status).toBe("warn");
    expect(JSON.stringify(report)).not.toContain("release-secret");
  });

  it("marks untrusted policy bundles as failures when signed policy is required", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeWorkspaceConfigTemplate(tempDir);

    const report = await createReleaseEvidenceReport(tempDir, {
      signedPolicyRequired: true,
      generatedAt: "2026-06-09T02:00:00.000Z"
    });

    expect(report.summary.ready).toBe(false);
    expect(report.checks.find((check) => check.id === "policy-bundle")?.status).toBe("fail");
  });

  it("exports release evidence as markdown or json", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeWorkspaceConfigTemplate(tempDir);
    const report = await createReleaseEvidenceReport(tempDir, {
      generatedAt: "2026-06-09T02:00:00.000Z"
    });

    expect(parseReleaseEvidenceFormat(undefined)).toBe("markdown");
    expect(parseReleaseEvidenceFormat("json")).toBe("json");
    expect(() => parseReleaseEvidenceFormat("xml")).toThrow(/format/);
    expect(exportReleaseEvidenceReport(report, "markdown")).toContain("# DeepCodex Release Evidence");
    expect(JSON.parse(exportReleaseEvidenceReport(report, "json"))).toMatchObject({
      generatedAt: "2026-06-09T02:00:00.000Z"
    });
  });
});
