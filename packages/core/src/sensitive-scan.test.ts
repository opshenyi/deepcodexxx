import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanWorkspaceSensitiveText } from "./sensitive-scan.js";
import { createWorkspaceContext } from "./workspace.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("sensitive text workspace scan", () => {
  it("reports finding metadata without returning secret values", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, "src"));
    await writeFile(
      path.join(tempDir, "src", "config.ts"),
      "export const key = 'placeholder';\nDEEPSEEK_API_KEY=live-secret\nconst marker = 'ACME_SECRET_ABCDEFGHIJKLMNOP';\n",
      "utf8"
    );
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "suggest",
      dlpPatterns: ["ACME_SECRET_[A-Z]{16}"]
    });

    const result = await scanWorkspaceSensitiveText(workspace);

    expect(result.scannedFiles).toBe(1);
    expect(result.filesWithFindings).toBe(1);
    expect(result.findings).toEqual([
      {
        path: "src/config.ts",
        line: 2,
        type: "secret-assignment",
        label: "DEEPSEEK_API_KEY"
      },
      {
        path: "src/config.ts",
        line: 3,
        type: "custom-pattern",
        label: "custom pattern 1"
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("live-secret");
    expect(JSON.stringify(result)).not.toContain("ACME_SECRET_ABCDEFGHIJKLMNOP");
  });

  it("skips denied, binary, and oversized files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, "src"));
    await mkdir(path.join(tempDir, "private"));
    await writeFile(path.join(tempDir, "src", "small.txt"), "ACCESS_TOKEN=ok\n", "utf8");
    await writeFile(path.join(tempDir, "src", "large.txt"), "ACCESS_TOKEN=too-large-for-limit\n", "utf8");
    await writeFile(path.join(tempDir, "src", "asset.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(tempDir, "private", "secret.txt"), "ACCESS_TOKEN=private-secret-value\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir, {
      mode: "suggest",
      deniedPaths: ["private"],
      maxFileBytes: 28
    });

    const result = await scanWorkspaceSensitiveText(workspace);

    expect(result.scannedFiles).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      path: "src/small.txt",
      line: 1,
      type: "secret-assignment",
      label: "ACCESS_TOKEN"
    });
    expect(result.skipped).toMatchObject({
      denied: 1,
      oversized: 1,
      binary: 1
    });
    expect(JSON.stringify(result)).not.toContain("too-large");
    expect(JSON.stringify(result)).not.toContain("private-secret-value");
  });

  it("marks scan results as truncated when finding limits are reached", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeFile(path.join(tempDir, "a.txt"), "A_SECRET=one\nB_SECRET=two\n", "utf8");
    const workspace = await createWorkspaceContext(tempDir, { mode: "suggest" });

    const result = await scanWorkspaceSensitiveText(workspace, { maxFindings: 1 });

    expect(result.findings).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});
