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

  it("blocks writes that contain probable secrets by default", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir);
    const writeTool = createDefaultTools().find((tool) => tool.definition.function.name === "write_file");
    expect(writeTool).toBeDefined();

    const result = await writeTool!.run(
      { path: "config.txt", content: "DEEPSEEK_API_KEY=live-secret\n" },
      { workspace }
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Potential secret content blocked by DLP policy");
    expect(result.content).toContain("secret-assignment:DEEPSEEK_API_KEY");
    expect(result.content).not.toContain("live-secret");
    await expect(readFile(path.join(tempDir, "config.txt"), "utf8")).rejects.toThrow();
  });

  it("allows probable secret writes only when explicitly enabled", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowSecretWrites: true
    });
    const writeTool = createDefaultTools().find((tool) => tool.definition.function.name === "write_file");
    expect(writeTool).toBeDefined();

    const result = await writeTool!.run(
      { path: "config.txt", content: "DEEPSEEK_API_KEY=trusted-fixture\n" },
      { workspace }
    );

    expect(result.ok).toBe(true);
    await expect(readFile(path.join(tempDir, "config.txt"), "utf8")).resolves.toContain("trusted-fixture");
  });

  it("keeps redaction-only patterns separate from write-time DLP patterns", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      redactionPatterns: ["TICKET-[0-9]+"],
      dlpPatterns: ["PROJECT_SECRET_[A-Z0-9]+"]
    });
    const writeTool = createDefaultTools().find((tool) => tool.definition.function.name === "write_file");
    expect(writeTool).toBeDefined();

    const redactionOnly = await writeTool!.run({ path: "ticket.txt", content: "TICKET-123\n" }, { workspace });
    const dlpResult = await writeTool!.run(
      { path: "secret.txt", content: "PROJECT_SECRET_ABC123\n" },
      { workspace }
    );

    expect(redactionOnly.ok).toBe(true);
    expect(dlpResult.ok).toBe(false);
    expect(dlpResult.content).toContain("custom-pattern:custom pattern 1");
    expect(dlpResult.content).not.toContain("PROJECT_SECRET_ABC123");
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

  it("blocks edits that introduce probable secrets by default", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "config.txt"), "token=placeholder\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir);
    const editTool = createDefaultTools().find((tool) => tool.definition.function.name === "edit_file");
    expect(editTool).toBeDefined();

    const result = await editTool!.run(
      { path: "config.txt", search: "token=placeholder", replace: "ACCESS_TOKEN=live-secret" },
      { workspace }
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Potential secret content blocked by DLP policy");
    expect(result.content).not.toContain("live-secret");
    await expect(readFile(path.join(tempDir, "config.txt"), "utf8")).resolves.toBe("token=placeholder\n");
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

  it("safely inspects denied media artifacts without returning raw content", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(180, 20);
    await writeFile(path.join(tempDir, "image.png"), png);
    const workspace = await createWorkspaceContext(tempDir);
    const inspectTool = createDefaultTools().find((tool) => tool.definition.function.name === "inspect_artifact");
    expect(inspectTool).toBeDefined();

    const result = await inspectTool!.run({ path: "image.png" }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Artifact: image.png");
    expect(result.content).toContain("Detected type: image/png");
    expect(result.content).toContain("Dimensions: 320x180");
    expect(result.content).toContain("Sample SHA-256:");
    expect(result.content).toContain("Raw content: not returned by policy.");
    expect(result.content).not.toContain("base64");
  });

  it("does not allow artifact inspection to bypass denied paths", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, ".env"), "DEEPSEEK_API_KEY=secret\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir);
    const inspectTool = createDefaultTools().find((tool) => tool.definition.function.name === "inspect_artifact");
    expect(inspectTool).toBeDefined();

    const result = await inspectTool!.run({ path: ".env" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Denied path");
  });

  it("blocks archive listing by default", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "bundle.zip"), createZip([{ name: "src/app.ts", content: "console.log('hi')\n" }]));
    const workspace = await createWorkspaceContext(tempDir);
    const archiveTool = createDefaultTools().find((tool) => tool.definition.function.name === "list_archive_entries");
    expect(archiveTool).toBeDefined();

    const result = await archiveTool!.run({ path: "bundle.zip" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Archive listing is disabled by policy");
  });

  it("lists ZIP archive entry metadata without returning file contents", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(
      path.join(tempDir, "bundle.zip"),
      createZip([
        { name: "src/", directory: true },
        { name: "src/app.ts", content: "const privateValue = 'do-not-return';\n" },
        { name: "README.md", content: "hello\n" }
      ])
    );
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowArchiveListing: true
    });
    const archiveTool = createDefaultTools().find((tool) => tool.definition.function.name === "list_archive_entries");
    expect(archiveTool).toBeDefined();

    const result = await archiveTool!.run({ path: "bundle.zip", maxEntries: 10 }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Archive: bundle.zip");
    expect(result.content).toContain("Format: ZIP central directory");
    expect(result.content).toContain("Entries listed: 3");
    expect(result.content).toContain("- src/ | directory");
    expect(result.content).toContain("- src/app.ts | file");
    expect(result.content).toContain("method=store");
    expect(result.content).toContain("Extraction: not performed.");
    expect(result.content).not.toContain("do-not-return");
  });

  it("does not allow archive listing to bypass denied archive paths", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, "secrets"));
    await writeFile(path.join(tempDir, "secrets", "bundle.zip"), createZip([{ name: "src/app.ts", content: "safe\n" }]));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowArchiveListing: true,
      deniedPaths: ["secrets"]
    });
    const archiveTool = createDefaultTools().find((tool) => tool.definition.function.name === "list_archive_entries");
    expect(archiveTool).toBeDefined();

    const result = await archiveTool!.run({ path: "secrets/bundle.zip" }, { workspace });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Denied path");
  });

  it("omits archive entries that match denied path policy", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(
      path.join(tempDir, "bundle.zip"),
      createZip([
        { name: ".env", content: "DEEPSEEK_API_KEY=do-not-return\n" },
        { name: "src/index.ts", content: "export const value = 1;\n" }
      ])
    );
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowArchiveListing: true
    });
    const archiveTool = createDefaultTools().find((tool) => tool.definition.function.name === "list_archive_entries");
    expect(archiveTool).toBeDefined();

    const result = await archiveTool!.run({ path: "bundle.zip" }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Denied entries omitted: 1");
    expect(result.content).toContain("src/index.ts");
    expect(result.content).not.toContain(".env");
    expect(result.content).not.toContain("do-not-return");
  });

  it("marks unsafe archive entry paths without extracting them", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "bundle.zip"), createZip([{ name: "../escape.txt", content: "escape\n" }]));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowArchiveListing: true
    });
    const archiveTool = createDefaultTools().find((tool) => tool.definition.function.name === "list_archive_entries");
    expect(archiveTool).toBeDefined();

    const result = await archiveTool!.run({ path: "bundle.zip" }, { workspace });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("../escape.txt");
    expect(result.content).toContain("flags=unsafe-path");
    expect(result.content).toContain("Extraction: not performed.");
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

  it("can run shell commands in an isolated workspace copy", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "input.txt"), "original\n", "utf8");
    await writeFile(path.join(tempDir, ".env"), "DEEPSEEK_API_KEY=secret\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowShell: true,
      shellExecutionMode: "workspace-copy"
    });
    const runTool = createDefaultTools().find((tool) => tool.definition.function.name === "run_command");
    expect(runTool).toBeDefined();

    const result = await runTool!.run(
      {
        command: `${quoteCommandPath(
          process.execPath
        )} -e "const fs=require('fs'); fs.writeFileSync('created.txt','copy'); fs.writeFileSync('input.txt','changed'); console.log(fs.existsSync('.env') ? 'env-present' : 'env-missing')"`
      },
      { workspace }
    );

    expect(result.ok).toBe(true);
    expect(result.content.trim()).toBe("env-missing");
    expect(result.audit?.shell).toMatchObject({
      executionMode: "workspace-copy",
      copiedFiles: 1,
      skippedEntries: 1,
      workspaceCopyRemoved: true
    });
    await expect(readFile(path.join(tempDir, "input.txt"), "utf8")).resolves.toBe("original\n");
    await expect(readFile(path.join(tempDir, "created.txt"), "utf8")).rejects.toThrow();
  });

  it("blocks common shell network commands by default", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowShell: true,
      allowNetwork: false
    });
    const runTool = createDefaultTools().find((tool) => tool.definition.function.name === "run_command");
    expect(runTool).toBeDefined();

    await expect(runTool!.run({ command: "npm install" }, { workspace })).rejects.toThrow(/network-enabled/);
  });

  it("marks non-zero shell exits as failed tool results", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowShell: true
    });
    const runTool = createDefaultTools().find((tool) => tool.definition.function.name === "run_command");
    expect(runTool).toBeDefined();

    const result = await runTool!.run(
      { command: `${quoteCommandPath(process.execPath)} -e "console.error('failed check'); process.exit(7)"` },
      { workspace }
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("exit code 7");
    expect(result.content).toContain("failed check");
  });

  it("marks timed-out shell commands as failed tool results", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "workspace-write",
      allowShell: true
    });
    const runTool = createDefaultTools().find((tool) => tool.definition.function.name === "run_command");
    expect(runTool).toBeDefined();

    const result = await runTool!.run(
      { command: `${quoteCommandPath(process.execPath)} -e "setTimeout(() => {}, 10000)"`, timeoutMs: 100 },
      { workspace }
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("timed out or was terminated");
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

function createZip(entries: Array<{ name: string; content?: string | Buffer; directory?: boolean }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.directory && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name;
    const nameBuffer = Buffer.from(name, "utf8");
    const contentBuffer =
      entry.directory === true
        ? Buffer.alloc(0)
        : Buffer.isBuffer(entry.content)
          ? entry.content
          : Buffer.from(entry.content ?? "", "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(contentBuffer.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localChunks.push(localHeader, nameBuffer, contentBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(contentBuffer.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(entry.directory === true ? 0x10 : 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + contentBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}
