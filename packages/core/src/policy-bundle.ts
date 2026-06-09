import { createHash, createPublicKey, sign as signPayload, verify as verifySignature } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
  publicKeys?: string[];
  revokedBundleSha256?: string[];
  revokedPublicKeySha256?: string[];
  trustedIssuers?: string[];
  now?: Date;
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

export interface CreatePolicyBundleOptions {
  privateKey: string;
  issuer: string;
  issuedAt?: Date | string;
  expiresAt?: Date | string;
  publicKey?: string;
  embedPublicKey?: boolean;
  overwrite?: boolean;
}

export interface CreatePolicyBundleResult {
  path: string;
  bundle: PolicyBundle;
  issuer: string;
  issuedAt: string;
  expiresAt?: string;
  configSha256: string;
  bundleSha256: string;
  publicKeySha256?: string;
}

export interface PolicyTrustPackagePublicKey {
  sha256: string;
  publicKey: string;
  source?: string;
}

export interface PolicyTrustPackage {
  version: number;
  generatedAt: string;
  workspace: string;
  configSha256?: string;
  policyBundlePath: string;
  policyBundleSha256?: string;
  verification: PolicyBundleVerificationResult;
  trustedPublicKeys: PolicyTrustPackagePublicKey[];
  trustedIssuers: string[];
  revokedPolicyBundles: string[];
  revokedSigningKeys: string[];
  requireSignedPolicy: boolean;
  recommendedEnv: Record<string, string>;
  warnings: string[];
}

export interface CreatePolicyTrustPackageOptions {
  publicKeys: string[];
  publicKeySources?: string[];
  trustedIssuers?: string[];
  revokedBundleSha256?: string[];
  revokedPublicKeySha256?: string[];
  requireSignedPolicy?: boolean;
  generatedAt?: Date | string;
  now?: Date;
}

export async function createWorkspacePolicyBundle(
  workspaceInput: string,
  options: CreatePolicyBundleOptions
): Promise<CreatePolicyBundleResult> {
  const root = await resolveWorkspaceRoot(workspaceInput);
  const workspaceConfig = await readWorkspaceConfig(root);
  if (!workspaceConfig.exists || !workspaceConfig.sha256) {
    throw new Error("Workspace config is missing; policy bundle cannot be signed.");
  }

  const issuer = options.issuer.trim();
  if (!issuer) {
    throw new Error("Policy bundle issuer is required.");
  }
  const privateKey = options.privateKey.trim();
  if (!privateKey) {
    throw new Error("Policy bundle private key is required.");
  }

  const issuedAt = normalizeBundleDate(options.issuedAt ?? new Date(), "issuedAt");
  const expiresAt = options.expiresAt ? normalizeBundleDate(options.expiresAt, "expiresAt") : undefined;
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new Error("Policy bundle expiresAt must be later than issuedAt.");
  }

  const bundlePath = path.join(root, POLICY_BUNDLE_RELATIVE_PATH);
  if (options.overwrite !== true && (await fileExists(bundlePath))) {
    throw new Error(`Policy bundle already exists: ${bundlePath}. Use overwrite to replace it.`);
  }

  const embeddedPublicKey = options.publicKey?.trim() || (options.embedPublicKey ? derivePublicKeyPem(privateKey) : undefined);
  const payload: PolicyBundlePayload = {
    version: 1,
    issuer,
    issuedAt,
    expiresAt,
    configSha256: workspaceConfig.sha256
  };
  const signature = signPayload(null, Buffer.from(createPolicyBundleSigningPayload(payload)), privateKey).toString("base64");
  const bundle: PolicyBundle = {
    payload,
    signature: {
      algorithm: "ed25519",
      value: signature,
      publicKey: embeddedPublicKey
    }
  };
  const raw = serializePolicyBundle(bundle);
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, raw, "utf8");

  return {
    path: bundlePath,
    bundle,
    issuer,
    issuedAt,
    expiresAt,
    configSha256: workspaceConfig.sha256,
    bundleSha256: createSha256(raw),
    publicKeySha256: embeddedPublicKey ? createSha256(embeddedPublicKey) : undefined
  };
}

export async function createPolicyTrustPackage(
  workspaceInput: string,
  options: CreatePolicyTrustPackageOptions
): Promise<PolicyTrustPackage> {
  const root = await resolveWorkspaceRoot(workspaceInput);
  const trustedPublicKeys = normalizePublicKeyEntries(options.publicKeys, options.publicKeySources);
  if (trustedPublicKeys.length === 0) {
    throw new Error("At least one trusted public key is required to export a policy trust package.");
  }
  const trustedIssuers = uniqueStrings(options.trustedIssuers);
  const revokedPolicyBundles = normalizeSha256List(options.revokedBundleSha256);
  const revokedSigningKeys = normalizeSha256List(options.revokedPublicKeySha256);
  const verification = await verifyWorkspacePolicyBundle(root, {
    publicKeys: trustedPublicKeys.map((entry) => entry.publicKey),
    revokedBundleSha256: revokedPolicyBundles,
    revokedPublicKeySha256: revokedSigningKeys,
    trustedIssuers,
    now: options.now
  });
  const workspaceConfig = await readWorkspaceConfig(root);
  const generatedAt = normalizeBundleDate(options.generatedAt ?? new Date(), "generatedAt");
  const recommendedEnv = removeEmptyEnvValues({
    DEEPCODEX_REQUIRE_SIGNED_POLICY: options.requireSignedPolicy ? "true" : undefined,
    DEEPCODEX_POLICY_BUNDLE_TRUSTED_ISSUERS: trustedIssuers.join(","),
    DEEPCODEX_REVOKED_POLICY_BUNDLES: revokedPolicyBundles.join(","),
    DEEPCODEX_REVOKED_POLICY_KEYS: revokedSigningKeys.join(",")
  });
  const warnings = [
    verification.ok ? "" : `Policy bundle is not trusted by this package: ${verification.reason}`,
    options.requireSignedPolicy
      ? ""
      : "Signed-only enforcement is not enabled in the recommended environment values."
  ].filter(Boolean);

  return {
    version: 1,
    generatedAt,
    workspace: root,
    configSha256: workspaceConfig.sha256,
    policyBundlePath: verification.path,
    policyBundleSha256: verification.bundleSha256,
    verification,
    trustedPublicKeys,
    trustedIssuers,
    revokedPolicyBundles,
    revokedSigningKeys,
    requireSignedPolicy: options.requireSignedPolicy ?? false,
    recommendedEnv,
    warnings
  };
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
  const externalPublicKeys = uniqueStrings([options.publicKey, ...(options.publicKeys ?? [])]);
  const embeddedPublicKey = parsed.signature.publicKey?.trim();
  const candidatePublicKeys = externalPublicKeys.length > 0 ? externalPublicKeys : uniqueStrings([embeddedPublicKey]);
  const trusted = externalPublicKeys.length > 0;
  const revokedBundleSha256 = new Set(normalizeSha256List(options.revokedBundleSha256));
  const revokedPublicKeySha256 = new Set(normalizeSha256List(options.revokedPublicKeySha256));
  const trustedIssuers = new Set(uniqueStrings(options.trustedIssuers));
  const base = {
    path: bundlePath,
    exists: true,
    issuer: payload.issuer,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    configSha256: payload.configSha256,
    bundleSha256,
    publicKeySha256: candidatePublicKeys[0] ? createSha256(candidatePublicKeys[0]) : undefined
  };

  if (revokedBundleSha256.has(bundleSha256)) {
    return {
      ...base,
      ok: false,
      signatureVerified: false,
      trusted,
      reason: "Policy bundle has been revoked."
    };
  }

  if (trustedIssuers.size > 0 && !trustedIssuers.has(payload.issuer)) {
    return {
      ...base,
      ok: false,
      signatureVerified: false,
      trusted,
      reason: "Policy bundle issuer is not trusted."
    };
  }

  if (candidatePublicKeys.length === 0) {
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

  if (payload.expiresAt && Date.parse(payload.expiresAt) < (options.now?.getTime() ?? Date.now())) {
    return {
      ...base,
      ok: false,
      signatureVerified: false,
      trusted,
      reason: "Policy bundle has expired."
    };
  }

  const signingPayload = Buffer.from(createPolicyBundleSigningPayload(payload));
  const signature = Buffer.from(parsed.signature.value, "base64");
  let signatureVerified = false;
  let verifiedPublicKeySha256: string | undefined;
  let revokedVerifiedKey = false;
  for (const publicKey of candidatePublicKeys) {
    const keySha256 = createSha256(publicKey);
    const verified = verifySignature(null, signingPayload, publicKey, signature);
    if (!verified) {
      continue;
    }
    signatureVerified = true;
    verifiedPublicKeySha256 = keySha256;
    if (revokedPublicKeySha256.has(keySha256)) {
      revokedVerifiedKey = true;
      continue;
    }
    revokedVerifiedKey = false;
    break;
  }

  if (signatureVerified && revokedVerifiedKey) {
    return {
      ...base,
      ok: false,
      signatureVerified,
      trusted,
      publicKeySha256: verifiedPublicKeySha256,
      reason: "Policy bundle signing key has been revoked."
    };
  }

  return {
    ...base,
    ok: signatureVerified && trusted,
    signatureVerified,
    trusted,
    publicKeySha256: verifiedPublicKeySha256 ?? base.publicKeySha256,
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

function serializePolicyBundle(bundle: PolicyBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
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

async function fileExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    });
}

function normalizeBundleDate(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Policy bundle ${field} must be a valid date.`);
  }
  return date.toISOString();
}

function derivePublicKeyPem(privateKeyPem: string): string {
  return createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
}

function createSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueStrings(values: Array<string | undefined> | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizeSha256List(values: string[] | undefined): string[] {
  return uniqueStrings(values).map((value) => value.toLowerCase());
}

function normalizePublicKeyEntries(publicKeys: string[], sources: string[] | undefined): PolicyTrustPackagePublicKey[] {
  const entries = new Map<string, PolicyTrustPackagePublicKey>();
  publicKeys.forEach((publicKey, index) => {
    const trimmed = publicKey.trim();
    if (!trimmed || entries.has(trimmed)) {
      return;
    }
    entries.set(trimmed, {
      sha256: createSha256(trimmed),
      publicKey: trimmed,
      source: sources?.[index]
    });
  });
  return [...entries.values()];
}

function removeEmptyEnvValues(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== "")
  ) as Record<string, string>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
