import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export type DistributionPreflightStatus = "pass" | "warn" | "fail";
export type DistributionPreflightFormat = "json" | "markdown";

export interface DistributionPreflightCheck {
  id: string;
  area: "scripts" | "client" | "desktop" | "artifacts" | "docs" | "safety";
  label: string;
  status: DistributionPreflightStatus;
  detail: string;
}

export interface DistributionPreflightSummary {
  ready: boolean;
  pass: number;
  warn: number;
  fail: number;
}

export interface DistributionPreflightReport {
  generatedAt: string;
  root: string;
  checks: DistributionPreflightCheck[];
  summary: DistributionPreflightSummary;
}

export interface CreateDistributionPreflightOptions {
  generatedAt?: Date | string;
}

export async function createDistributionPreflightReport(
  rootInput: string,
  options: CreateDistributionPreflightOptions = {}
): Promise<DistributionPreflightReport> {
  const root = path.resolve(rootInput || process.cwd());
  const generatedAt = normalizeReportDate(options.generatedAt ?? new Date(), "generatedAt");
  const [
    rootPackageRaw,
    cliPackageRaw,
    serverPackageRaw,
    webPackageRaw,
    desktopPackageRaw,
    cliSource,
    desktopMain,
    gitignore
  ] = await Promise.all([
    readOptionalText(path.join(root, "package.json")),
    readOptionalText(path.join(root, "apps", "cli", "package.json")),
    readOptionalText(path.join(root, "apps", "server", "package.json")),
    readOptionalText(path.join(root, "apps", "web", "package.json")),
    readOptionalText(path.join(root, "apps", "desktop", "package.json")),
    readOptionalText(path.join(root, "apps", "cli", "src", "index.ts")),
    readOptionalText(path.join(root, "apps", "desktop", "src", "main.ts")),
    readOptionalText(path.join(root, ".gitignore"))
  ]);

  const checks = [
    ...createScriptChecks(rootPackageRaw),
    ...createClientPackageChecks(cliPackageRaw, serverPackageRaw, webPackageRaw, desktopPackageRaw),
    ...createCliChecks(cliPackageRaw, cliSource),
    ...createDesktopChecks(desktopPackageRaw, desktopMain),
    ...(await createArtifactChecks(root)),
    ...(await createDocChecks(root)),
    createGitignoreCheck(gitignore)
  ];

  return {
    generatedAt,
    root,
    checks,
    summary: summarizeChecks(checks)
  };
}

export function exportDistributionPreflightReport(
  report: DistributionPreflightReport,
  format: DistributionPreflightFormat = "markdown"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  return renderDistributionPreflightMarkdown(report);
}

export function parseDistributionPreflightFormat(value: unknown): DistributionPreflightFormat {
  if (value === undefined || value === null || value === "" || value === "markdown") {
    return "markdown";
  }
  if (value === "json") {
    return "json";
  }
  throw new Error("format must be markdown or json");
}

function createScriptChecks(rootPackageRaw: string | undefined): DistributionPreflightCheck[] {
  if (!rootPackageRaw) {
    return [
      {
        id: "root-package",
        area: "scripts",
        label: "Root package manifest",
        status: "fail",
        detail: "package.json is missing."
      }
    ];
  }
  const rootPackage = parseJsonObject(rootPackageRaw, "package.json");
  const scripts = readRecord(rootPackage.scripts);
  return [
    createScriptCheck(scripts, "build", "Build script"),
    createScriptCheck(scripts, "typecheck", "Typecheck script"),
    createScriptCheck(scripts, "test", "Test script"),
    createScriptCheck(scripts, "verify", "Verify script"),
    createScriptCheck(scripts, "dev", "Web/server dev script"),
    createScriptCheck(scripts, "dev:desktop", "Desktop dev script"),
    createScriptCheck(scripts, "start:desktop", "Desktop production start script")
  ];
}

function createClientPackageChecks(
  cliPackageRaw: string | undefined,
  serverPackageRaw: string | undefined,
  webPackageRaw: string | undefined,
  desktopPackageRaw: string | undefined
): DistributionPreflightCheck[] {
  return [
    createPackageBuildCheck(cliPackageRaw, "cli-package", "CLI package", "client"),
    createPackageBuildCheck(serverPackageRaw, "server-package", "Server package", "client"),
    createPackageBuildCheck(webPackageRaw, "web-package", "Web package", "client"),
    createPackageBuildCheck(desktopPackageRaw, "desktop-package", "Desktop package", "client")
  ];
}

function createCliChecks(cliPackageRaw: string | undefined, cliSource: string | undefined): DistributionPreflightCheck[] {
  const cliPackage = cliPackageRaw ? parseJsonObject(cliPackageRaw, "apps/cli/package.json") : {};
  const bin = readRecord(cliPackage.bin);
  const deepcodexBin = bin.deepcodex;
  return [
    {
      id: "cli-bin-entry",
      area: "client",
      label: "CLI binary entry",
      status: deepcodexBin === "dist/index.js" ? "pass" : "fail",
      detail:
        deepcodexBin === "dist/index.js"
          ? "apps/cli package exposes deepcodex -> dist/index.js."
          : "apps/cli package should expose bin.deepcodex as dist/index.js."
    },
    createSourceContainsCheck(cliSource, "cli-completion-command", "CLI completion command", ".command(\"completion\")", "client")
  ];
}

function createDesktopChecks(
  desktopPackageRaw: string | undefined,
  desktopMain: string | undefined
): DistributionPreflightCheck[] {
  const desktopPackage = desktopPackageRaw ? parseJsonObject(desktopPackageRaw, "apps/desktop/package.json") : {};
  const main = typeof desktopPackage.main === "string" ? desktopPackage.main : "";
  return [
    {
      id: "desktop-main-entry",
      area: "desktop",
      label: "Desktop main entry",
      status: main === "dist/main.js" ? "pass" : "fail",
      detail: main === "dist/main.js" ? "Desktop package points to dist/main.js." : "Desktop package main should point to dist/main.js."
    },
    createSourceContainsCheck(
      desktopMain,
      "desktop-context-isolation",
      "Desktop context isolation",
      "contextIsolation: true",
      "desktop"
    ),
    createSourceContainsCheck(desktopMain, "desktop-sandbox", "Desktop renderer sandbox", "sandbox: true", "desktop"),
    createSourceContainsCheck(desktopMain, "desktop-server-bootstrap", "Desktop server bootstrap", "ensureDesktopServer", "desktop"),
    createSourceContainsCheck(desktopMain, "desktop-built-web-load", "Desktop built Web load", "loadFile", "desktop")
  ];
}

async function createArtifactChecks(root: string): Promise<DistributionPreflightCheck[]> {
  const artifacts: Array<[string, string, string]> = [
    ["cli-dist", "CLI build artifact", path.join("apps", "cli", "dist", "index.js")],
    ["server-dist", "Server build artifact", path.join("apps", "server", "dist", "index.js")],
    ["desktop-dist", "Desktop build artifact", path.join("apps", "desktop", "dist", "main.js")],
    ["web-dist", "Web build artifact", path.join("apps", "web", "dist", "index.html")]
  ];
  return Promise.all(
    artifacts.map(async ([id, label, relativePath]) => {
      const exists = await fileExists(path.join(root, relativePath));
      return {
        id,
        area: "artifacts",
        label,
        status: exists ? "pass" : "warn",
        detail: exists ? `${relativePath} exists.` : `${relativePath} is missing; run npm run build before packaging.`
      };
    })
  );
}

async function createDocChecks(root: string): Promise<DistributionPreflightCheck[]> {
  const docs: Array<[string, string, string]> = [
    ["readme", "README", "README.md"],
    ["runbook", "Runbook", path.join("docs", "runbook.md")],
    ["security-model", "Security model", path.join("docs", "security-model.md")],
    ["product-readiness", "Product readiness", path.join("docs", "product-readiness.md")],
    ["release-checklist", "Release checklist", path.join("docs", "release-checklist.md")],
    ["commercialization", "Commercialization brief", path.join("docs", "commercialization.md")],
    ["roadmap", "Roadmap", path.join("docs", "roadmap.md")],
    ["memory", "Continuation memory", "DEEP_CODEX_MEMORY.md"]
  ];
  return Promise.all(
    docs.map(async ([id, label, relativePath]) => {
      const exists = await fileExists(path.join(root, relativePath));
      return {
        id,
        area: "docs",
        label,
        status: exists ? "pass" : "fail",
        detail: exists ? `${relativePath} exists.` : `${relativePath} is missing.`
      };
    })
  );
}

function createGitignoreCheck(gitignore: string | undefined): DistributionPreflightCheck {
  const required = [".env", ".deepcodex/", "references/agents/"];
  const missing = required.filter((entry) => !gitignore?.includes(entry));
  return {
    id: "gitignore-sensitive-paths",
    area: "safety",
    label: "Ignored local state",
    status: missing.length === 0 ? "pass" : "fail",
    detail:
      missing.length === 0
        ? ".gitignore covers env files, local state, and reference clones."
        : `.gitignore is missing: ${missing.join(", ")}.`
  };
}

function createScriptCheck(
  scripts: Record<string, unknown>,
  script: string,
  label: string
): DistributionPreflightCheck {
  return {
    id: `script-${script.replace(/[^a-z0-9-]/gi, "-")}`,
    area: "scripts",
    label,
    status: typeof scripts[script] === "string" ? "pass" : "fail",
    detail: typeof scripts[script] === "string" ? `npm run ${script} is defined.` : `npm run ${script} is missing.`
  };
}

function createPackageBuildCheck(
  raw: string | undefined,
  id: string,
  label: string,
  area: DistributionPreflightCheck["area"]
): DistributionPreflightCheck {
  if (!raw) {
    return {
      id,
      area,
      label,
      status: "fail",
      detail: `${label} package.json is missing.`
    };
  }
  const entry = parseJsonObject(raw, `${label} package.json`);
  const scripts = readRecord(entry.scripts);
  return {
    id,
    area,
    label,
    status: typeof scripts.build === "string" ? "pass" : "fail",
    detail: typeof scripts.build === "string" ? `${label} has a build script.` : `${label} is missing a build script.`
  };
}

function createSourceContainsCheck(
  source: string | undefined,
  id: string,
  label: string,
  pattern: string,
  area: DistributionPreflightCheck["area"]
): DistributionPreflightCheck {
  return {
    id,
    area,
    label,
    status: source?.includes(pattern) ? "pass" : "fail",
    detail: source?.includes(pattern) ? `${pattern} is present.` : `${pattern} is missing.`
  };
}

function summarizeChecks(checks: DistributionPreflightCheck[]): DistributionPreflightSummary {
  const summary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length
  };
  return {
    ...summary,
    ready: summary.fail === 0
  };
}

function renderDistributionPreflightMarkdown(report: DistributionPreflightReport): string {
  return [
    "# DeepCodex Distribution Preflight",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Root: ${report.root}`,
    `- Ready: ${report.summary.ready ? "yes" : "no"}`,
    `- Checks: ${report.summary.pass} pass / ${report.summary.warn} warn / ${report.summary.fail} fail`,
    "",
    "| Status | Area | Check | Detail |",
    "| --- | --- | --- | --- |",
    ...report.checks.map(
      (check) =>
        `| ${check.status} | ${check.area} | ${escapeMarkdownCell(check.label)} | ${escapeMarkdownCell(check.detail)} |`
    ),
    ""
  ].join("\n");
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  return readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then((info) => info.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    });
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object.`);
  }
  return parsed as Record<string, unknown>;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function normalizeReportDate(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid date.`);
  }
  return date.toISOString();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
