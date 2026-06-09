import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidSessionIdError,
  createSessionRecorder,
  exportSessionHistory,
  listSessionHistories,
  parseSessionExportFormat,
  pruneSessionHistories,
  readSessionHistory,
  sessionDirectory
} from "./session-store.js";
import { createWorkspaceContext } from "./workspace.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("session store", () => {
  it("records agent events to the workspace session history", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    const recorder = createSessionRecorder(workspace);

    await recorder.record({
      type: "session_started",
      sessionId: "session-1",
      workspace: workspace.root,
      model: "deepseek-chat"
    });
    await recorder.record({ type: "step", index: 1, maxSteps: 1 });
    await recorder.record({
      type: "model_usage",
      model: "deepseek-chat",
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20
    });
    await recorder.record({
      type: "budget_updated",
      budget: {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        maxTokens: 50,
        remainingTokens: 30
      }
    });
    await recorder.record({ type: "final", content: "done" });

    const filePath = path.join(sessionDirectory(workspace), "session-1.json");
    const raw = JSON.parse(await readFile(filePath, "utf8")) as {
      eventCount: number;
      events: Array<{ sequence: number; timestamp: string }>;
    };
    expect(raw.eventCount).toBe(5);
    expect(raw.events[0]?.sequence).toBe(1);
    expect(raw.events[0]?.timestamp).toEqual(expect.any(String));

    const session = await readSessionHistory(workspace, "session-1");
    expect(session.status).toBe("completed");
    expect(session.finalContent).toBe("done");
    expect(session.tokenUsage).toEqual({ promptTokens: 12, completionTokens: 8, totalTokens: 20 });
    expect(session.budget).toMatchObject({ totalTokens: 20, maxTokens: 50, remainingTokens: 30 });

    const summaries = await listSessionHistories(workspace);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      sessionId: "session-1",
      status: "completed",
      eventCount: 5,
      tokenUsage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      budget: { promptTokens: 12, completionTokens: 8, totalTokens: 20, maxTokens: 50, remainingTokens: 30 },
      lastEventType: "final"
    });
  });

  it("exports session history as markdown and json", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    const recorder = createSessionRecorder(workspace);

    await recorder.record({
      type: "session_started",
      sessionId: "session-export",
      workspace: workspace.root,
      model: "deepseek-chat"
    });
    await recorder.record({
      type: "tool_approval_requested",
      approvalId: "approval-1",
      name: "write_file",
      input: { path: "README.md" },
      risk: "workspace-write",
      reason: "write_file can change files in the selected workspace.",
      requestedAt: "2026-06-09T00:00:00.000Z",
      fileAudits: [
        {
          path: "README.md",
          operation: "write",
          before: { exists: true, sha256: "a".repeat(64), bytes: 10 }
        }
      ]
    });
    await recorder.record({
      type: "tool_approval_resolved",
      approvalId: "approval-1",
      name: "write_file",
      approved: true,
      reason: "Approved in test.",
      requestedAt: "2026-06-09T00:00:00.000Z",
      resolvedAt: "2026-06-09T00:00:01.250Z",
      decisionLatencyMs: 1250,
      actor: "test-suite",
      fileAudits: [
        {
          path: "README.md",
          operation: "write",
          before: { exists: true, sha256: "a".repeat(64), bytes: 10 }
        }
      ]
    });
    await recorder.record({
      type: "tool_finished",
      name: "write_file",
      ok: true,
      output: "Wrote README.md",
      audit: {
        files: [
          {
            path: "README.md",
            operation: "write",
            before: { exists: true, sha256: "a".repeat(64), bytes: 10 },
            after: { exists: true, sha256: "b".repeat(64), bytes: 12 },
            applied: true
          }
        ]
      }
    });
    await recorder.record({ type: "final", content: "done" });

    const session = await readSessionHistory(workspace, "session-export");
    const markdown = exportSessionHistory(session, "markdown");
    expect(markdown).toContain("# DeepCodex Session Export");
    expect(markdown).toContain("session-export");
    expect(markdown).toContain("Approval approved for write_file by test-suite in 1250ms.");
    expect(markdown).toContain("fileAudits");
    expect(markdown).toContain("Wrote README.md");
    expect(markdown).toContain("- Token Budget: none");
    expect(markdown).toContain("## Final Response");

    const json = JSON.parse(exportSessionHistory(session, "json")) as { sessionId: string; eventCount: number };
    expect(json.sessionId).toBe("session-export");
    expect(json.eventCount).toBe(5);
  });

  it("parses session export formats", () => {
    expect(parseSessionExportFormat(undefined)).toBe("markdown");
    expect(parseSessionExportFormat("markdown")).toBe("markdown");
    expect(parseSessionExportFormat("json")).toBe("json");
    expect(() => parseSessionExportFormat("xml")).toThrow(/format must be markdown or json/);
  });

  it("rejects session ids that could escape the session directory", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);

    await expect(readSessionHistory(workspace, "../outside")).rejects.toBeInstanceOf(InvalidSessionIdError);
  });

  it("prunes old session history files with dry-run support", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    await mkdir(sessionDirectory(workspace), { recursive: true });
    await writeSessionFixture(workspace.root, "old-session", "2026-01-01T00:00:00.000Z");
    await writeSessionFixture(workspace.root, "mid-session", "2026-02-01T00:00:00.000Z");
    await writeSessionFixture(workspace.root, "new-session", "2026-03-01T00:00:00.000Z");

    const dryRun = await pruneSessionHistories(workspace, { maxSessions: 2, dryRun: true });

    expect(dryRun).toEqual({
      scanned: 3,
      retained: 2,
      deleted: ["old-session"],
      dryRun: true
    });
    expect(await listSessionHistories(workspace)).toHaveLength(3);

    const pruned = await pruneSessionHistories(workspace, { maxSessions: 2 });

    expect(pruned).toMatchObject({ scanned: 3, retained: 2, deleted: ["old-session"], dryRun: false });
    expect((await listSessionHistories(workspace)).map((session) => session.sessionId)).toEqual([
      "new-session",
      "mid-session"
    ]);
  });
});

async function writeSessionFixture(root: string, sessionId: string, updatedAt: string) {
  await writeFile(
    path.join(root, ".deepcodex", "state", "sessions", `${sessionId}.json`),
    `${JSON.stringify(
      {
        sessionId,
        workspace: root,
        model: "deepseek-chat",
        status: "completed",
        createdAt: updatedAt,
        updatedAt,
        eventCount: 0,
        events: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
