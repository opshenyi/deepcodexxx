const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*([^\s'",;]+)/gi;
const BEARER_PATTERN = /\b(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/-]+=*)/gi;
const TOKEN_LITERAL_PATTERN = /\b((?:sk|dk|ghp|gho|github_pat)_[A-Za-z0-9_=-]{12,})\b/g;

export interface RedactionOptions {
  additionalPatterns?: string[];
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
