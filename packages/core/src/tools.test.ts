import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultTools } from "./tools.js";
import { createWorkspaceContext } from "./workspace.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("workspace tools", () => {
  it("previews file writes in suggest mode without writing", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "suggest",
      allowFileWrite: false,
      allowShell: false
    });
    const writeTool = createDefaultTools().find((tool) => tool.definition.function.name === "write_file");
    expect(writeTool).toBeDefined();

    const result = await writeTool!.run({ path: "preview.txt", content: "hello\n" }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Preview only");
    expect(result.content).toContain("+hello");
    await expect(readFile(path.join(tempDir, "preview.txt"), "utf8")).rejects.toThrow();
  });

  it("writes files and returns a diff in workspace-write mode", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    const writeTool = createDefaultTools().find((tool) => tool.definition.function.name === "write_file");
    expect(writeTool).toBeDefined();

    const result = await writeTool!.run({ path: "created.txt", content: "created\n" }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Wrote created.txt");
    expect(result.content).toContain("+created");
    await expect(readFile(path.join(tempDir, "created.txt"), "utf8")).resolves.toBe("created\n");
  });

  it("edits files and returns a diff", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, "src"));
    await writeFile(path.join(tempDir, "src", "app.txt"), "alpha\nbeta\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir);
    const editTool = createDefaultTools().find((tool) => tool.definition.function.name === "edit_file");
    expect(editTool).toBeDefined();

    const result = await editTool!.run(
      { path: "src/app.txt", search: "beta", replace: "gamma" },
      { workspace }
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("-beta");
    expect(result.content).toContain("+gamma");
    await expect(readFile(path.join(tempDir, "src", "app.txt"), "utf8")).resolves.toBe("alpha\ngamma\n");
  });

  it("denies secret files by default", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, ".env"), "DEEPSEEK_API_KEY=secret\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir);
    const readTool = createDefaultTools().find((tool) => tool.definition.function.name === "read_file");
    expect(readTool).toBeDefined();

    const result = await readTool!.run({ path: ".env" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Denied path");
  });

  it("rejects reading files larger than the configured size limit", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "large.txt"), "abcdef", "utf8");
    const workspace = await createWorkspaceContext(tempDir, { mode: "workspace-write", maxFileBytes: 5 });
    const readTool = createDefaultTools().find((tool) => tool.definition.function.name === "read_file");
    expect(readTool).toBeDefined();

    const result = await readTool!.run({ path: "large.txt" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("File exceeds maxFileBytes (5)");
  });

  it("rejects writing content larger than the configured size limit", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, { mode: "workspace-write", maxFileBytes: 0 });
    const writeTool = createDefaultTools().find((tool) => tool.definition.function.name === "write_file");
    expect(writeTool).toBeDefined();

    const result = await writeTool!.run({ path: "too-large.txt", content: "x" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Content exceeds maxFileBytes (0)");
    await expect(readFile(path.join(tempDir, "too-large.txt"), "utf8")).rejects.toThrow();
  });

  it("rejects editing files larger than the configured size limit", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "large.txt"), "alpha", "utf8");
    const workspace = await createWorkspaceContext(tempDir, { mode: "workspace-write", maxFileBytes: 4 });
    const editTool = createDefaultTools().find((tool) => tool.definition.function.name === "edit_file");
    expect(editTool).toBeDefined();

    const result = await editTool!.run({ path: "large.txt", search: "alpha", replace: "beta" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("File exceeds maxFileBytes (4)");
    await expect(readFile(path.join(tempDir, "large.txt"), "utf8")).resolves.toBe("alpha");
  });

  it("skips oversized files when searching", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "small.txt"), "needle\n", "utf8");
    await writeFile(path.join(tempDir, "large.txt"), "needle in a file that is too large\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir, { mode: "workspace-write", maxFileBytes: 10 });
    const searchTool = createDefaultTools().find((tool) => tool.definition.function.name === "search_files");
    expect(searchTool).toBeDefined();

    const result = await searchTool!.run({ query: "needle" }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("small.txt:1");
    expect(result.content).not.toContain("large.txt");
  });
});
