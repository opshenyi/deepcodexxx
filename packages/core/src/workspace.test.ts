import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceContext,
  isDeniedByPatterns,
  isDeniedFileExtension,
  isDeniedWorkspacePath,
  resolveWorkspacePath
} from "./workspace.js";

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
    expect(isDeniedWorkspacePath("packages/core/node_modules/tool/index.js")).toBe(true);
    expect(isDeniedWorkspacePath("references/agents/openai-codex/README.md")).toBe(true);
    expect(isDeniedWorkspacePath(".env")).toBe(true);
    expect(isDeniedWorkspacePath(".env.local")).toBe(true);
    expect(isDeniedWorkspacePath("apps/server/.env.local")).toBe(true);
    expect(isDeniedWorkspacePath(".deepcodex/state/sessions/run.json")).toBe(true);
    expect(isDeniedWorkspacePath("apps/web/dist/assets/index.js")).toBe(true);
    expect(isDeniedWorkspacePath("apps/web/build/index.html")).toBe(true);
    expect(isDeniedWorkspacePath("coverage/lcov.info")).toBe(true);
    expect(isDeniedWorkspacePath("apps/web/src/main.tsx")).toBe(false);
  });

  it("supports configurable denied paths", () => {
    expect(isDeniedByPatterns("secrets/key.txt", ["secrets"])).toBe(true);
    expect(isDeniedByPatterns("logs/app.log", ["*.log"])).toBe(false);
    expect(isDeniedByPatterns("app.log", ["*.log"])).toBe(true);
    expect(isDeniedByPatterns("apps/web/app.map", ["**/*.map"])).toBe(true);
    expect(isDeniedByPatterns("src/index.ts", ["secrets", "*.local"])).toBe(false);
  });

  it("denies common media and artifact extensions", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      deniedFileExtensions: ["foo"]
    });

    expect(isDeniedFileExtension("assets/logo.png", workspace.policy.deniedFileExtensions)).toBe(true);
    expect(isDeniedFileExtension("archive/file.foo", workspace.policy.deniedFileExtensions)).toBe(true);
    expect(isDeniedFileExtension("src/index.ts", workspace.policy.deniedFileExtensions)).toBe(false);
  });

  it("extends defaults when custom denied paths are configured", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      deniedPaths: ["secrets"]
    });

    expect(isDeniedByPatterns(".env", workspace.policy.deniedPaths ?? [])).toBe(true);
    expect(isDeniedByPatterns("secrets/key.txt", workspace.policy.deniedPaths ?? [])).toBe(true);
  });

  it("applies the default file size limit", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);

    expect(workspace.policy.maxFileBytes).toBe(512 * 1024);
  });

  it("supports configurable file size limits", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      maxFileBytes: 2048
    });

    expect(workspace.policy.maxFileBytes).toBe(2048);
  });
});
