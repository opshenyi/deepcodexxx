const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*([^\s'",;]+)/gi;
const BEARER_PATTERN = /\b(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/-]+=*)/gi;
const TOKEN_LITERAL_PATTERN = /\b((?:sk|dk|ghp|gho|github_pat)_[A-Za-z0-9_=-]{12,})\b/g;

export interface RedactionOptions {
  additionalPatterns?: string[];
}

export interface SensitiveTextFinding {
  type: "secret-assignment" | "bearer-token" | "token-literal" | "custom-pattern";
  label: string;
  index: number;
}

export function redactSensitiveText(value: string, options: RedactionOptions = {}): string {
  let redacted = value
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1=[redacted]")
    .replace(BEARER_PATTERN, "$1[redacted]")
    .replace(TOKEN_LITERAL_PATTERN, "[redacted-token]");

  for (const pattern of options.additionalPatterns ?? []) {
    redacted = redacted.replace(new RegExp(pattern, "g"), "[redacted-custom]");
  }

  return redacted;
}

export function findSensitiveText(value: string, options: RedactionOptions = {}): SensitiveTextFinding[] {
  const findings: SensitiveTextFinding[] = [];

  for (const match of value.matchAll(cloneGlobalPattern(SENSITIVE_ASSIGNMENT_PATTERN))) {
    findings.push({
      type: "secret-assignment",
      label: match[1] ?? "sensitive assignment",
      index: match.index ?? 0
    });
  }
  for (const match of value.matchAll(cloneGlobalPattern(BEARER_PATTERN))) {
    findings.push({
      type: "bearer-token",
      label: "Authorization bearer token",
      index: match.index ?? 0
    });
  }
  for (const match of value.matchAll(cloneGlobalPattern(TOKEN_LITERAL_PATTERN))) {
    findings.push({
      type: "token-literal",
      label: "token literal",
      index: match.index ?? 0
    });
  }

  for (const [index, pattern] of (options.additionalPatterns ?? []).entries()) {
    for (const match of value.matchAll(new RegExp(pattern, "g"))) {
      findings.push({
        type: "custom-pattern",
        label: `custom pattern ${index + 1}`,
        index: match.index ?? 0
      });
    }
  }

  return findings.sort((a, b) => a.index - b.index);
}

export function redactSensitiveValue(value: unknown, options: RedactionOptions = {}, depth = 0): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value, options);
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (depth >= 6) {
    return "[redacted-depth-limit]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry, options, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactSensitiveValue(entry, options, depth + 1)
    ])
  );
}

function isSensitiveKey(key: string): boolean {
  return /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|private[_-]?key)/i.test(key);
}

function cloneGlobalPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}
