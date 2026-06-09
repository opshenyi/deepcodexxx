export type DeepSeekModelStatus = "recommended" | "supported" | "legacy";

export interface DeepSeekModelCatalogEntry {
  id: string;
  label: string;
  status: DeepSeekModelStatus;
  defaultModel: boolean;
  fallbackEligible: boolean;
  supportsToolCalls: boolean;
  notes: string;
  migrationTarget?: string;
  retiresAt?: string;
}

export interface DeepSeekModelCatalogSummary {
  generatedAt: string;
  sourceCheckedAt: string;
  recommended: number;
  supported: number;
  legacy: number;
  defaultModel: string;
  legacyRetiresAt?: string;
}

export const DEEPSEEK_MODEL_SOURCE_CHECKED_AT = "2026-06-09";
export const DEEPSEEK_LEGACY_ALIAS_RETIRES_AT = "2026-07-24T15:59:00.000Z";

const DEEPSEEK_MODEL_CATALOG: DeepSeekModelCatalogEntry[] = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    status: "recommended",
    defaultModel: true,
    fallbackEligible: true,
    supportsToolCalls: true,
    notes: "Default low-latency OpenAI-format chat completion model for DeepCodex."
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    status: "supported",
    defaultModel: false,
    fallbackEligible: true,
    supportsToolCalls: true,
    notes: "Supported V4 model for approved fallback or higher-capability runs."
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat legacy alias",
    status: "legacy",
    defaultModel: false,
    fallbackEligible: false,
    supportsToolCalls: true,
    migrationTarget: "deepseek-v4-flash",
    retiresAt: DEEPSEEK_LEGACY_ALIAS_RETIRES_AT,
    notes: "Legacy alias currently maps to V4 Flash non-thinking mode; keep configurable for migration only."
  },
  {
    id: "deepseek-reasoner",
    label: "DeepSeek Reasoner legacy alias",
    status: "legacy",
    defaultModel: false,
    fallbackEligible: false,
    supportsToolCalls: true,
    migrationTarget: "deepseek-v4-flash",
    retiresAt: DEEPSEEK_LEGACY_ALIAS_RETIRES_AT,
    notes: "Legacy alias currently maps to V4 Flash thinking mode; avoid as a coding-agent fallback."
  }
];

export function listDeepSeekModelCatalog(): DeepSeekModelCatalogEntry[] {
  return DEEPSEEK_MODEL_CATALOG.map((entry) => ({ ...entry }));
}

export function getDeepSeekModelCatalogEntry(modelId: string): DeepSeekModelCatalogEntry | undefined {
  const normalized = modelId.trim();
  const entry = DEEPSEEK_MODEL_CATALOG.find((candidate) => candidate.id === normalized);
  return entry ? { ...entry } : undefined;
}

export function createDeepSeekModelCatalogSummary(now = new Date()): DeepSeekModelCatalogSummary {
  const models = listDeepSeekModelCatalog();
  return {
    generatedAt: now.toISOString(),
    sourceCheckedAt: DEEPSEEK_MODEL_SOURCE_CHECKED_AT,
    recommended: models.filter((model) => model.status === "recommended").length,
    supported: models.filter((model) => model.status === "supported").length,
    legacy: models.filter((model) => model.status === "legacy").length,
    defaultModel: models.find((model) => model.defaultModel)?.id ?? "unknown",
    legacyRetiresAt: DEEPSEEK_LEGACY_ALIAS_RETIRES_AT
  };
}
