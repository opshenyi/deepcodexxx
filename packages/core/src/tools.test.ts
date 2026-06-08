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
});
