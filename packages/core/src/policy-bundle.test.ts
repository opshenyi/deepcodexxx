import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPolicyBundleSigningPayload,
  createWorkspacePolicyBundle,
  POLICY_BUNDLE_RELATIVE_PATH,
  type PolicyBundlePayload,
  verifyWorkspacePolicyBundle
} from "./policy-bundle.js";
import { writeWorkspaceConfigTemplate } from "./workspace-config.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("policy bundle verification", () => {
  it("creates and verifies a signed policy bundle from the active workspace config", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();

    const created = await createWorkspacePolicyBundle(tempDir, {
      privateKey: keys.privateKeyPem,
      issuer: "Security Team",
      issuedAt: "2026-06-09T01:00:00.000Z",
      expiresAt: "2026-06-10T01:00:00.000Z",
      publicKey: keys.publicKeyPem
    });
    const raw = await readFile(path.join(tempDir, POLICY_BUNDLE_RELATIVE_PATH), "utf8");
    const verified = await verifyWorkspacePolicyBundle(tempDir, {
      publicKey: keys.publicKeyPem,
      trustedIssuers: ["Security Team"],
      now: new Date("2026-06-09T02:00:00.000Z")
    });

    expect(created).toMatchObject({
      issuer: "Security Team",
      issuedAt: "2026-06-09T01:00:00.000Z",
      expiresAt: "2026-06-10T01:00:00.000Z",
      configSha256: workspaceConfig.sha256,
      publicKeySha256: createSha256(keys.publicKeyPem.trim())
    });
    expect(created.bundleSha256).toBe(createSha256(raw));
    expect(verified.ok).toBe(true);
    expect(verified.issuer).toBe("Security Team");
  });

  it("does not overwrite an existing signed policy bundle unless requested", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();
    await createWorkspacePolicyBundle(tempDir, {
      privateKey: keys.privateKeyPem,
      issuer: "Security Team",
      issuedAt: "2026-06-09T01:00:00.000Z"
    });

    await expect(
      createWorkspacePolicyBundle(tempDir, {
        privateKey: keys.privateKeyPem,
        issuer: "Replacement",
        issuedAt: "2026-06-09T02:00:00.000Z"
      })
    ).rejects.toThrow(/already exists/);

    const replaced = await createWorkspacePolicyBundle(tempDir, {
      privateKey: keys.privateKeyPem,
      issuer: "Replacement",
      issuedAt: "2026-06-09T02:00:00.000Z",
      overwrite: true
    });

    expect(replaced.issuer).toBe("Replacement");
  });

  it("rejects policy bundles that expire before they are issued", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();

    await expect(
      createWorkspacePolicyBundle(tempDir, {
        privateKey: keys.privateKeyPem,
        issuer: "Security Team",
        issuedAt: "2026-06-10T00:00:00.000Z",
        expiresAt: "2026-06-09T00:00:00.000Z"
      })
    ).rejects.toThrow(/expiresAt/);
  });

  it("verifies a policy bundle against a trusted public key and active config hash", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();
    await writeSignedBundle(tempDir, workspaceConfig.sha256!, keys.privateKeyPem);

    const result = await verifyWorkspacePolicyBundle(tempDir, { publicKey: keys.publicKeyPem });

    expect(result).toMatchObject({
      exists: true,
      ok: true,
      signatureVerified: true,
      trusted: true,
      configSha256: workspaceConfig.sha256,
      issuer: "DeepCodex Test"
    });
    expect(result.publicKeySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not trust embedded public keys without a caller-provided trusted key", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();
    await writeSignedBundle(tempDir, workspaceConfig.sha256!, keys.privateKeyPem, keys.publicKeyPem);

    const result = await verifyWorkspacePolicyBundle(tempDir);

    expect(result.signatureVerified).toBe(true);
    expect(result.trusted).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("embedded public key");
  });

  it("verifies policy bundles with any trusted key during key rotation", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    const oldKeys = createSigningKeys();
    const newKeys = createSigningKeys();
    await writeSignedBundle(tempDir, workspaceConfig.sha256!, newKeys.privateKeyPem);

    const result = await verifyWorkspacePolicyBundle(tempDir, {
      publicKeys: [oldKeys.publicKeyPem, newKeys.publicKeyPem]
    });

    expect(result.ok).toBe(true);
    expect(result.signatureVerified).toBe(true);
    expect(result.publicKeySha256).toBe(createSha256(newKeys.publicKeyPem.trim()));
  });

  it("rejects revoked policy bundle hashes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();
    await writeSignedBundle(tempDir, workspaceConfig.sha256!, keys.privateKeyPem);
    const firstResult = await verifyWorkspacePolicyBundle(tempDir, { publicKey: keys.publicKeyPem });

    const revoked = await verifyWorkspacePolicyBundle(tempDir, {
      publicKey: keys.publicKeyPem,
      revokedBundleSha256: [firstResult.bundleSha256!]
    });

    expect(revoked.ok).toBe(false);
    expect(revoked.reason).toContain("revoked");
  });

  it("rejects revoked trusted signing keys", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();
    await writeSignedBundle(tempDir, workspaceConfig.sha256!, keys.privateKeyPem);

    const result = await verifyWorkspacePolicyBundle(tempDir, {
      publicKey: keys.publicKeyPem,
      revokedPublicKeySha256: [createSha256(keys.publicKeyPem.trim())]
    });

    expect(result.ok).toBe(false);
    expect(result.signatureVerified).toBe(true);
    expect(result.reason).toContain("signing key has been revoked");
  });

  it("rejects policy bundles from untrusted issuers", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    const workspaceConfig = await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();
    await writeSignedBundle(tempDir, workspaceConfig.sha256!, keys.privateKeyPem);

    const result = await verifyWorkspacePolicyBundle(tempDir, {
      publicKey: keys.publicKeyPem,
      trustedIssuers: ["Security Team"]
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("issuer is not trusted");
  });

  it("rejects bundles that do not match the active config hash", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeWorkspaceConfigTemplate(tempDir);
    const keys = createSigningKeys();
    await writeSignedBundle(tempDir, "a".repeat(64), keys.privateKeyPem);

    const result = await verifyWorkspacePolicyBundle(tempDir, { publicKey: keys.publicKeyPem });

    expect(result.ok).toBe(false);
    expect(result.signatureVerified).toBe(false);
    expect(result.reason).toContain("does not match");
  });

  it("reports a missing policy bundle clearly", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "deepcodex-"));
    await writeWorkspaceConfigTemplate(tempDir);

    const result = await verifyWorkspacePolicyBundle(tempDir);

    expect(result.exists).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing");
  });
});

function createSigningKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

function createSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function writeSignedBundle(
  workspace: string,
  configSha256: string,
  privateKeyPem: string,
  embeddedPublicKey?: string
) {
  await mkdir(path.join(workspace, ".deepcodex"), { recursive: true });
  const payload: PolicyBundlePayload = {
    version: 1,
    issuer: "DeepCodex Test",
    issuedAt: "2026-06-09T00:00:00.000Z",
    configSha256
  };
  const signature = sign(null, Buffer.from(createPolicyBundleSigningPayload(payload)), privateKeyPem).toString("base64");
  await writeFile(
    path.join(workspace, POLICY_BUNDLE_RELATIVE_PATH),
    `${JSON.stringify(
      {
        payload,
        signature: {
          algorithm: "ed25519",
          value: signature,
          publicKey: embeddedPublicKey
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
