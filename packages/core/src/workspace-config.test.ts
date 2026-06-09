import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readWorkspaceConfig,
  writeWorkspaceConfigTemplate,
  WORKSPACE_CONFIG_RELATIVE_PATH
} from "./workspace-config.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("workspace config", () => {
  it("returns an empty config when no workspace config exists", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));

    const result = await readWorkspaceConfig(tempDir);

    expect(result.exists).toBe(false);
    expect(result.path).toBe(path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH));
    expect(result.config).toEqual({});
    expect(result.sha256).toBeUndefined();
  });

  it("parses team defaults from .deepcodex/config.json", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({
        version: 1,
        model: "deepseek-coder",
        provider: {
          baseUrl: "https://api.deepseek.com/",
          allowedBaseUrls: ["https://api.deepseek.com/"],
          allowedModels: ["deepseek-coder", "deepseek-chat"]
        },
        policyProfileId: "inspection",
        policyProfiles: [
          {
            id: "repo-guarded",
            label: "Repo guarded",
            description: "Repository-specific guarded profile.",
            approvalMode: "manual",
            maxSteps: 4,
            policy: {
              mode: "workspace-write",
              allowShell: false,
              allowFileWrite: true,
              allowSecretWrites: false,
              allowArchiveListing: false,
              allowPdfTextExtraction: false,
              allowedShellCommands: ["^npm\\s+(test|run\\s+build)$"],
              deniedShellCommands: ["\\bterraform\\s+apply\\b"],
              shellEnvironment: "minimal",
              shellExecutionMode: "workspace-copy"
            },
            budget: {
              maxTokens: "1000"
            }
          }
        ],
        evals: [
          {
            id: "repo-release-smoke",
            label: "Repo release smoke",
            description: "Repository-specific release evidence eval.",
            prompt: "Inspect release evidence without modifying files.",
            profile: "inspection",
            maxSteps: "5",
            budget: { maxTokens: "12000" },
            expectedSignals: ["release checklist", "runbook"]
          }
        ],
        approvalMode: "deny",
        maxSteps: "6",
        pricingProfileId: "pilot",
        budget: { maxTokens: "25000", maxEstimatedUsd: 0.25 },
        policy: {
          mode: "suggest",
          allowShell: false,
          allowSecretWrites: false,
          allowArchiveListing: false,
          allowPdfTextExtraction: true,
          deniedPaths: ["secrets"],
          deniedFileExtensions: ["sqlite"],
          redactionPatterns: ["ACME_[A-Z0-9]{16,}"],
          dlpPatterns: ["ACME_SECRET_[A-Z0-9]{16,}"],
          allowedShellCommands: ["^npm\\s+(test|run\\s+build)$"],
          deniedShellCommands: ["\\bterraform\\s+apply\\b"],
          maxFileBytes: 2048,
          shellEnvironment: "minimal",
          shellExecutionMode: "workspace-copy"
        },
        retention: { maxSessions: "20", maxAgeDays: "14" }
      }),
      "utf8"
    );

    const result = await readWorkspaceConfig(tempDir);

    expect(result.exists).toBe(true);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.config).toMatchObject({
      model: "deepseek-coder",
      provider: {
        baseUrl: "https://api.deepseek.com",
        allowedBaseUrls: ["https://api.deepseek.com"],
        allowedModels: ["deepseek-coder", "deepseek-chat"]
      },
      policyProfileId: "inspection",
      policyProfiles: [
        {
          id: "repo-guarded",
          label: "Repo guarded",
          description: "Repository-specific guarded profile.",
          approvalMode: "manual",
          maxSteps: 4,
          policy: {
            mode: "workspace-write",
            allowShell: false,
            allowFileWrite: true,
            allowSecretWrites: false,
            allowArchiveListing: false,
            allowPdfTextExtraction: false,
            allowedShellCommands: ["^npm\\s+(test|run\\s+build)$"],
            deniedShellCommands: ["\\bterraform\\s+apply\\b"],
            shellEnvironment: "minimal",
            shellExecutionMode: "workspace-copy"
          },
          budget: {
            maxTokens: 1000
          }
        }
      ],
      evals: [
        {
          id: "repo-release-smoke",
          label: "Repo release smoke",
          description: "Repository-specific release evidence eval.",
          prompt: "Inspect release evidence without modifying files.",
          profile: "inspection",
          maxSteps: 5,
          budget: { maxTokens: 12000 },
          expectedSignals: ["release checklist", "runbook"]
        }
      ],
      approvalMode: "deny",
      maxSteps: 6,
      pricingProfileId: "pilot",
      budget: { maxTokens: 25000, maxEstimatedUsd: 0.25 },
      policy: {
        mode: "suggest",
        allowShell: false,
        allowSecretWrites: false,
        allowArchiveListing: false,
        allowPdfTextExtraction: true,
        deniedPaths: ["secrets"],
        deniedFileExtensions: ["sqlite"],
        redactionPatterns: ["ACME_[A-Z0-9]{16,}"],
        dlpPatterns: ["ACME_SECRET_[A-Z0-9]{16,}"],
        allowedShellCommands: ["^npm\\s+(test|run\\s+build)$"],
        deniedShellCommands: ["\\bterraform\\s+apply\\b"],
        maxFileBytes: 2048,
        shellEnvironment: "minimal",
        shellExecutionMode: "workspace-copy"
      },
      retention: { maxSessions: 20, maxAgeDays: 14 }
    });
  });

  it("parses workspace config files with a UTF-8 BOM", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      `\uFEFF${JSON.stringify({ model: "deepseek-chat" })}`,
      "utf8"
    );

    const result = await readWorkspaceConfig(tempDir);

    expect(result.exists).toBe(true);
    expect(result.config.model).toBe("deepseek-chat");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid workspace config values with the config path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH), '{"approvalMode":"prompt"}', "utf8");

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/Invalid DeepCodex workspace config/);
    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/approvalMode/);
  });

  it("rejects invalid custom redaction patterns", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({ policy: { redactionPatterns: ["["] } }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/redactionPatterns/);
  });

  it("rejects invalid custom DLP patterns", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({ policy: { dlpPatterns: ["["] } }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/dlpPatterns/);
  });

  it("rejects invalid shell command policy patterns", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({ policy: { allowedShellCommands: ["["] } }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/allowedShellCommands/);
  });

  it("rejects invalid shell execution modes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({ policy: { shellExecutionMode: "unsafe" } }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/shellExecutionMode/);
  });

  it("rejects custom policy profiles without a mode", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({
        policyProfiles: [
          {
            id: "repo-guarded",
            label: "Repo guarded",
            description: "Missing mode.",
            policy: {}
          }
        ]
      }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/policyProfiles\[0\]\.policy\.mode/);
  });

  it("rejects duplicate workspace eval ids", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({
        evals: [
          {
            id: "release-smoke",
            label: "Release smoke",
            description: "First eval.",
            prompt: "Inspect release evidence.",
            profile: "inspection",
            maxSteps: 4,
            expectedSignals: ["release"]
          },
          {
            id: "release-smoke",
            label: "Release smoke copy",
            description: "Duplicate eval.",
            prompt: "Inspect release evidence again.",
            profile: "inspection",
            maxSteps: 4,
            expectedSignals: ["release"]
          }
        ]
      }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/Duplicate evals id/);
  });

  it("rejects unsafe workspace eval ids", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({
        evals: [
          {
            id: "../release",
            label: "Release smoke",
            description: "Unsafe id.",
            prompt: "Inspect release evidence.",
            profile: "inspection",
            maxSteps: 4,
            expectedSignals: ["release"]
          }
        ]
      }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/evals\[0\]\.id/);
  });

  it("rejects workspace evals without expected signals", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({
        evals: [
          {
            id: "release-smoke",
            label: "Release smoke",
            description: "Missing signals.",
            prompt: "Inspect release evidence.",
            profile: "inspection",
            maxSteps: 4,
            expectedSignals: []
          }
        ]
      }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/evals\[0\]\.expectedSignals/);
  });

  it("rejects workspace evals without a positive max step count", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({
        evals: [
          {
            id: "release-smoke",
            label: "Release smoke",
            description: "Invalid max steps.",
            prompt: "Inspect release evidence.",
            profile: "inspection",
            maxSteps: 0,
            expectedSignals: ["release"]
          }
        ]
      }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/evals\[0\]\.maxSteps/);
  });

  it("rejects invalid provider base URLs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await mkdir(path.join(tempDir, ".deepcodex"));
    await writeFile(
      path.join(tempDir, WORKSPACE_CONFIG_RELATIVE_PATH),
      JSON.stringify({ provider: { allowedBaseUrls: ["ftp://api.deepseek.com"] } }),
      "utf8"
    );

    await expect(readWorkspaceConfig(tempDir)).rejects.toThrow(/provider.allowedBaseUrls/);
  });

  it("writes a template without overwriting an existing config", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));

    const created = await writeWorkspaceConfigTemplate(tempDir);

    expect(created.exists).toBe(true);
    expect(created.config.policyProfileId).toBe("guarded-write");
    expect(created.config.evals?.[0]?.id).toBe("workspace-release-smoke");
    expect(created.config.policy?.deniedShellCommands).toContain("\\bterraform\\s+apply\\b");
    expect(created.config.policyProfiles?.[0]?.policy.deniedShellCommands).toContain("\\bkubectl\\s+delete\\b");
    expect(created.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(writeWorkspaceConfigTemplate(tempDir)).rejects.toThrow(/already exists/);
  });
});
