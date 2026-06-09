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
    expect(result.audit?.files?.[0]).toMatchObject({
      path: "preview.txt",
      operation: "write",
      applied: false,
      before: { exists: false },
      after: { exists: true, bytes: 6 }
    });
    expect(result.audit?.files?.[0]?.after?.sha256).toHaveLength(64);
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
    expect(result.audit?.files?.[0]).toMatchObject({
      path: "created.txt",
      operation: "write",
      applied: true,
      before: { exists: false },
      after: { exists: true, bytes: 8 }
    });
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
    expect(result.audit?.files?.[0]).toMatchObject({
      path: path.join("src", "app.txt"),
      operation: "edit",
      applied: true,
      before: { exists: true, bytes: 11 },
      after: { exists: true, bytes: 12 }
    });
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

  it("rejects reading binary files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "asset.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));
    const workspace = await createWorkspaceContext(tempDir);
    const readTool = createDefaultTools().find((tool) => tool.definition.function.name === "read_file");
    expect(readTool).toBeDefined();

    const result = await readTool!.run({ path: "asset.bin" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("File appears to be binary");
  });

  it("rejects common media and artifact extensions before reading", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "image.png"), "not really an image", "utf8");
    const workspace = await createWorkspaceContext(tempDir);
    const readTool = createDefaultTools().find((tool) => tool.definition.function.name === "read_file");
    expect(readTool).toBeDefined();

    const result = await readTool!.run({ path: "image.png" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Denied file extension");
  });

  it("rejects writes to common media and artifact extensions", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    const writeTool = createDefaultTools().find((tool) => tool.definition.function.name === "write_file");
    expect(writeTool).toBeDefined();

    const result = await writeTool!.run({ path: "bundle.zip", content: "zip" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Denied file extension");
    await expect(readFile(path.join(tempDir, "bundle.zip"), "utf8")).rejects.toThrow();
  });

  it("rejects editing binary files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const binary = Buffer.from([0, 65, 66, 67]);
    await writeFile(path.join(tempDir, "asset.bin"), binary);
    const workspace = await createWorkspaceContext(tempDir);
    const editTool = createDefaultTools().find((tool) => tool.definition.function.name === "edit_file");
    expect(editTool).toBeDefined();

    const result = await editTool!.run({ path: "asset.bin", search: "ABC", replace: "XYZ" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("File appears to be binary");
    await expect(readFile(path.join(tempDir, "asset.bin"))).resolves.toEqual(binary);
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

  it("skips binary files when searching", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "small.txt"), "needle\n", "utf8");
    await writeFile(path.join(tempDir, "asset.bin"), Buffer.from([0, 110, 101, 101, 100, 108, 101]));
    const workspace = await createWorkspaceContext(tempDir);
    const searchTool = createDefaultTools().find((tool) => tool.definition.function.name === "search_files");
    expect(searchTool).toBeDefined();

    const result = await searchTool!.run({ query: "needle" }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("small.txt:1");
    expect(result.content).not.toContain("asset.bin");
  });

  it("skips denied media and artifact extensions when listing and searching", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "small.txt"), "needle\n", "utf8");
    await writeFile(path.join(tempDir, "image.png"), "needle\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir);
    const listTool = createDefaultTools().find((tool) => tool.definition.function.name === "list_files");
    const searchTool = createDefaultTools().find((tool) => tool.definition.function.name === "search_files");
    expect(listTool).toBeDefined();
    expect(searchTool).toBeDefined();

    const listResult = await listTool!.run({ path: "." }, { workspace });
    const searchResult = await searchTool!.run({ query: "needle" }, { workspace });

    expect(listResult.content).toContain("small.txt");
    expect(listResult.content).not.toContain("image.png");
    expect(searchResult.content).toContain("small.txt:1");
    expect(searchResult.content).not.toContain("image.png");
  });

  it("runs shell commands with a minimal environment by default", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const previousSecret = process.env.DEEPCODEX_TEST_SECRET;
    process.env.DEEPCODEX_TEST_SECRET = "should-not-leak";
    try {
      const workspace = await createWorkspaceContext(tempDir, {
        mode: "workspace-write",
        allowShell: true,
        shellEnvironment: "minimal"
      });
      const runTool = createDefaultTools().find((tool) => tool.definition.function.name === "run_command");
      expect(runTool).toBeDefined();

      const result = await runTool!.run(
        { command: `${quoteCommandPath(process.execPath)} -e "console.log(process.env.DEEPCODEX_TEST_SECRET || 'missing')"` },
        { workspace }
      );

      expect(result.ok).toBe(true);
      expect(result.content.trim()).toBe("missing");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.DEEPCODEX_TEST_SECRET;
      } else {
        process.env.DEEPCODEX_TEST_SECRET = previousSecret;
      }
    }
  });

  it("can explicitly inherit the shell environment", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const previousSecret = process.env.DEEPCODEX_TEST_SECRET;
    process.env.DEEPCODEX_TEST_SECRET = "allowed-secret";
    try {
      const workspace = await createWorkspaceContext(tempDir, {
        mode: "workspace-write",
        allowShell: true,
        shellEnvironment: "inherit"
      });
      const runTool = createDefaultTools().find((tool) => tool.definition.function.name === "run_command");
      expect(runTool).toBeDefined();

      const result = await runTool!.run(
        { command: `${quoteCommandPath(process.execPath)} -e "console.log(process.env.DEEPCODEX_TEST_SECRET || 'missing')"` },
        { workspace }
      );

      expect(result.ok).toBe(true);
      expect(result.content.trim()).toBe("allowed-secret");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.DEEPCODEX_TEST_SECRET;
      } else {
        process.env.DEEPCODEX_TEST_SECRET = previousSecret;
      }
    }
  });
});

function quoteCommandPath(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}
