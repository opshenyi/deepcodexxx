import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceContext, isDeniedWorkspacePath, resolveWorkspacePath } from "./workspace.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("workspace boundaries", () => {
  it("rejects paths that escape the workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    expect(() => resolveWorkspacePath(workspace, "../outside.txt")).toThrow(/escapes workspace/);
  });

  it("resolves workspace-local paths", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    expect(resolveWorkspacePath(workspace, "src/index.ts")).toBe(path.join(tempDir, "src", "index.ts"));
  });

  it("denies generated and reference directories", () => {
    expect(isDeniedWorkspacePath(".git/config")).toBe(true);
    expect(isDeniedWorkspacePath("node_modules/react/index.js")).toBe(true);
    expect(isDeniedWorkspacePath("references/agents/openai-codex/README.md")).toBe(true);
    expect(isDeniedWorkspacePath("apps/web/src/main.tsx")).toBe(false);
  });
});

