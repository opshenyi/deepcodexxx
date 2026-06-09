import { createHash, verify as verifySignature } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readWorkspaceConfig } from "./workspace-config.js";

export const POLICY_BUNDLE_RELATIVE_PATH = ".deepcodex/policy-bundle.json";

export interface PolicyBundlePayload {
  version: number;
  issuer: string;
  issuedAt: string;
  expiresAt?: string;
  configSha256: string;
}

export interface PolicyBundleSignature {
  algorithm: "ed25519";
  value: string;
  publicKey?: string;
}

export interface PolicyBundle {
  payload: PolicyBundlePayload;
  signature: PolicyBundleSignature;
}

export interface PolicyBundleVerificationOptions {
  publicKey?: string;
}

export interface PolicyBundleVerificationResult {
  path: string;
  exists: boolean;
  ok: boolean;
  signatureVerified: boolean;
  trusted: boolean;
  reason: string;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
  configSha256?: string;
  bundleSha256?: string;
  publicKeySha256?: string;
}

export async function verifyWorkspacePolicyBundle(
  workspaceInput: string,
  options: PolicyBundleVerificationOptions = {}
): Promise<PolicyBundleVerificationResult> {
  const root = await resolveWorkspaceRoot(workspaceInput);
  const bundlePath = path.join(root, POLICY_BUNDLE_RELATIVE_PATH);
  const raw = await readFile(bundlePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (raw === undefined) {
    return {
      path: bundlePath,
      exists: false,
      ok: false,
      signatureVerified: false,
      trusted: false,
      reason: "Policy bundle is missing."
    };
  }

  const bundleSha256 = createSha256(raw);
  const parsed = parsePolicyBundle(raw);
  const payload = parsed.payload;
  const externalPublicKey = options.publicKey?.trim();
  const publicKey = externalPublicKey || parsed.signature.publicKey?.trim();
  const trusted = Boolean(externalPublicKey);
  const base = {
    path: bundlePath,
    exists: true,
    issuer: payload.issuer,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    configSha256: payload.configSha256,
    bundleSha256,
    publicKeySha256: publicKey ? createSha256(publicKey) : undefined
  };

  if (!publicKey) {
    return {
      ...base,
      ok: false,
      signatureVerified: false,
      trusted: false,
      reason: "Policy bundle requires a trusted public key."
    };
  }

  const workspaceConfig = await readWorkspaceConfig(root);
  if (!workspaceConfig.exists || !workspaceConfig.sha256) {
    return {
      ...base,
      ok: false,
      signatureVerified: false,
      trusted,
      reason: "Workspace config is missing; policy bundle cannot be bound."
    };
  }

  if (payload.configSha256 !== workspaceConfig.sha256) {
    return {
      ...base,
      ok: false,
      signatureVerified: false,
      trusted,
      reason: "Policy bundle configSha256 does not match the active workspace config."
    };
  }

  if (payload.expiresAt && Date.parse(payload.expiresAt) < Date.now()) {
    return {
      ...base,
      ok: false,
      signatureVerified: false,
      trusted,
      reason: "Policy bundle has expired."
    };
  }

  const signatureVerified = verifySignature(
    null,
    Buffer.from(createPolicyBundleSigningPayload(payload)),
    publicKey,
    Buffer.from(parsed.signature.value, "base64")
  );

  return {
    ...base,
    ok: signatureVerified && trusted,
    signatureVerified,
    trusted,
    reason: signatureVerified
      ? trusted
        ? "Policy bundle signature verified with a trusted public key."
        : "Policy bundle signature verified with an embedded public key only."
      : "Policy bundle signature verification failed."
  };
}

export function createPolicyBundleSigningPayload(payload: PolicyBundlePayload): string {
  return canonicalJson(payload);
}

function parsePolicyBundle(raw: string): PolicyBundle {
  const value = JSON.parse(raw) as unknown;
  const entry = readObject(value, "policy bundle");
  const payload = readPayload(entry.payload);
  const signature = readSignature(entry.signature);
  return { payload, signature };
}

function readPayload(value: unknown): PolicyBundlePayload {
  const entry = readObject(value, "payload");
  return {
    version: readRequiredNumber(entry.version, "payload.version"),
    issuer: readRequiredString(entry.issuer, "payload.issuer"),
    issuedAt: readRequiredDateString(entry.issuedAt, "payload.issuedAt"),
    expiresAt: readOptionalDateString(entry.expiresAt, "payload.expiresAt"),
    configSha256: readSha256(entry.configSha256, "payload.configSha256")
  };
}

function readSignature(value: unknown): PolicyBundleSignature {
  const entry = readObject(value, "signature");
  const algorithm = readRequiredString(entry.algorithm, "signature.algorithm");
  if (algorithm !== "ed25519") {
    throw new Error("signature.algorithm must be ed25519.");
  }
  return {
    algorithm,
    value: readBase64(entry.value, "signature.value"),
    publicKey: readOptionalString(entry.publicKey, "signature.publicKey")
  };
}

async function resolveWorkspaceRoot(workspaceInput: string): Promise<string> {
  const root = path.resolve(workspaceInput || process.cwd());
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${root}`);
  }
  return root;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, field: string): string {
  const parsed = readOptionalString(value, field);
  if (!parsed) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return parsed;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readRequiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function readRequiredDateString(value: unknown, field: string): string {
  const parsed = readRequiredString(value, field);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`${field} must be a valid date string.`);
  }
  return parsed;
}

function readOptionalDateString(value: unknown, field: string): string | undefined {
  const parsed = readOptionalString(value, field);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`${field} must be a valid date string.`);
  }
  return parsed;
}

function readSha256(value: unknown, field: string): string {
  const parsed = readRequiredString(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    throw new Error(`${field} must be a SHA-256 hex digest.`);
  }
  return parsed;
}

function readBase64(value: unknown, field: string): string {
  const parsed = readRequiredString(value, field);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parsed)) {
    throw new Error(`${field} must be base64.`);
  }
  return parsed;
}

function createSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
