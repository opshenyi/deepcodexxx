import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidSessionIdError,
  createSessionRecorder,
  listSessionHistories,
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
    await recorder.record({ type: "final", content: "done" });

    const filePath = path.join(sessionDirectory(workspace), "session-1.json");
    const raw = JSON.parse(await readFile(filePath, "utf8")) as {
      eventCount: number;
      events: Array<{ sequence: number; timestamp: string }>;
    };
    expect(raw.eventCount).toBe(3);
    expect(raw.events[0]?.sequence).toBe(1);
    expect(raw.events[0]?.timestamp).toEqual(expect.any(String));

    const session = await readSessionHistory(workspace, "session-1");
    expect(session.status).toBe("completed");
    expect(session.finalContent).toBe("done");

    const summaries = await listSessionHistories(workspace);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      sessionId: "session-1",
      status: "completed",
      eventCount: 3,
      lastEventType: "final"
    });
  });

  it("rejects session ids that could escape the session directory", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);

    await expect(readSessionHistory(workspace, "../outside")).rejects.toBeInstanceOf(InvalidSessionIdError);
  });
});
