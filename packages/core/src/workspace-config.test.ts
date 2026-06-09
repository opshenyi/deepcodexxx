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
              shellEnvironment: "minimal"
            },
            budget: {
              maxTokens: "1000"
            }
          }
        ],
        approvalMode: "deny",
        maxSteps: "6",
        pricingProfileId: "pilot",
        budget: { maxTokens: "25000", maxEstimatedUsd: 0.25 },
        policy: {
          mode: "suggest",
          allowShell: false,
          deniedPaths: ["secrets"],
          deniedFileExtensions: ["sqlite"],
          redactionPatterns: ["ACME_[A-Z0-9]{16,}"],
          maxFileBytes: 2048,
          shellEnvironment: "minimal"
        },
        retention: { maxSessions: "20", maxAgeDays: "14" }
      }),
      "utf8"
    );

    const result = await readWorkspaceConfig(tempDir);

    expect(result.exists).toBe(true);
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
            shellEnvironment: "minimal"
          },
          budget: {
            maxTokens: 1000
          }
        }
      ],
      approvalMode: "deny",
      maxSteps: 6,
      pricingProfileId: "pilot",
      budget: { maxTokens: 25000, maxEstimatedUsd: 0.25 },
      policy: {
        mode: "suggest",
        allowShell: false,
        deniedPaths: ["secrets"],
        deniedFileExtensions: ["sqlite"],
        redactionPatterns: ["ACME_[A-Z0-9]{16,}"],
        maxFileBytes: 2048,
        shellEnvironment: "minimal"
      },
      retention: { maxSessions: 20, maxAgeDays: 14 }
    });
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
    await expect(writeWorkspaceConfigTemplate(tempDir)).rejects.toThrow(/already exists/);
  });
});
