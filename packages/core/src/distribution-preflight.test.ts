import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDistributionPreflightReport,
  exportDistributionPreflightReport,
  parseDistributionPreflightFormat
} from "./distribution-preflight.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("distribution preflight", () => {
  it("passes required scripts, docs, desktop safety, and built artifacts", async () => {
    tempDir = await createProductFixture({ includeArtifacts: true });

    const report = await createDistributionPreflightReport(tempDir, {
      generatedAt: "2026-06-09T01:00:00.000Z"
    });

    expect(report.generatedAt).toBe("2026-06-09T01:00:00.000Z");
    expect(report.summary.fail).toBe(0);
    expect(report.summary.warn).toBe(0);
    expect(report.summary.ready).toBe(true);
    expect(report.checks.find((check) => check.id === "desktop-sandbox")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "web-dist")?.status).toBe("pass");
  });

  it("warns for missing build artifacts but fails for missing required scripts", async () => {
    tempDir = await createProductFixture({ includeArtifacts: false, omitVerifyScript: true });

    const report = await createDistributionPreflightReport(tempDir);

    expect(report.checks.find((check) => check.id === "script-verify")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "web-dist")?.status).toBe("warn");
    expect(report.summary.ready).toBe(false);
  });

  it("exports markdown and json", async () => {
    tempDir = await createProductFixture({ includeArtifacts: true });
    const report = await createDistributionPreflightReport(tempDir, {
      generatedAt: "2026-06-09T01:00:00.000Z"
    });

    expect(parseDistributionPreflightFormat(undefined)).toBe("markdown");
    expect(parseDistributionPreflightFormat("json")).toBe("json");
    expect(() => parseDistributionPreflightFormat("xml")).toThrow(/format/);
    expect(exportDistributionPreflightReport(report, "markdown")).toContain("# DeepCodex Distribution Preflight");
    expect(JSON.parse(exportDistributionPreflightReport(report, "json"))).toMatchObject({
      generatedAt: "2026-06-09T01:00:00.000Z"
    });
  });
});

async function createProductFixture(options: { includeArtifacts: boolean; omitVerifyScript?: boolean }): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
  await mkdir(path.join(root, "apps", "cli"), { recursive: true });
  await mkdir(path.join(root, "apps", "server"), { recursive: true });
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  await mkdir(path.join(root, "apps", "desktop", "src"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });

  await writeJson(path.join(root, "package.json"), {
    scripts: {
      build: "npm run build --workspaces --if-present",
      typecheck: "tsc -b",
      test: "vitest run",
      ...(options.omitVerifyScript ? {} : { verify: "npm run build && npm test" }),
      dev: "npm run dev -w @deepcodex/web",
      "dev:desktop": "npm run dev -w @deepcodex/desktop",
      "start:desktop": "npm run build && npm run start -w @deepcodex/desktop"
    }
  });
  await writePackage(path.join(root, "apps", "cli", "package.json"), { build: "tsc -p tsconfig.json" });
  await writePackage(path.join(root, "apps", "server", "package.json"), { build: "tsc -p tsconfig.json" });
  await writePackage(path.join(root, "apps", "web", "package.json"), { build: "vite build" });
  await writeJson(path.join(root, "apps", "desktop", "package.json"), {
    main: "dist/main.js",
    scripts: { build: "tsc -p tsconfig.json" }
  });
  await writeFile(
    path.join(root, "apps", "desktop", "src", "main.ts"),
    "contextIsolation: true\nsandbox: true\nensureDesktopServer();\nwindow.loadFile('index.html');\n",
    "utf8"
  );
  await writeFile(path.join(root, ".gitignore"), ".env\n.deepcodex/\nreferences/agents/\n", "utf8");

  for (const doc of [
    "README.md",
    "DEEP_CODEX_MEMORY.md",
    path.join("docs", "runbook.md"),
    path.join("docs", "security-model.md"),
    path.join("docs", "product-readiness.md"),
    path.join("docs", "release-checklist.md"),
    path.join("docs", "commercialization.md"),
    path.join("docs", "roadmap.md")
  ]) {
    await writeFile(path.join(root, doc), `${doc}\n`, "utf8");
  }

  if (options.includeArtifacts) {
    await mkdir(path.join(root, "apps", "cli", "dist"), { recursive: true });
    await mkdir(path.join(root, "apps", "server", "dist"), { recursive: true });
    await mkdir(path.join(root, "apps", "desktop", "dist"), { recursive: true });
    await mkdir(path.join(root, "apps", "web", "dist"), { recursive: true });
    await writeFile(path.join(root, "apps", "cli", "dist", "index.js"), "", "utf8");
    await writeFile(path.join(root, "apps", "server", "dist", "index.js"), "", "utf8");
    await writeFile(path.join(root, "apps", "desktop", "dist", "main.js"), "", "utf8");
    await writeFile(path.join(root, "apps", "web", "dist", "index.html"), "", "utf8");
  }

  return root;
}

async function writePackage(filePath: string, scripts: Record<string, string>): Promise<void> {
  await writeJson(filePath, { scripts });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
