/**
 * Structured reasoning-effort handling for Kiro runtime requests.
 *
 * Simplified port of the reference implementation's effort.ts.
 */
import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { clampThinkingLevel } from "@earendil-works/pi-ai";

export type KiroEffortField = "reasoning" | "output_config";

export interface KiroEffortConfig {
  field: KiroEffortField;
  values: readonly string[];
  summarizedThinking: boolean;
}

export type KiroAdditionalModelRequestFields =
  | { reasoning: { effort: string } }
  | {
      output_config: { effort: string };
      thinking: { type: "adaptive"; display?: "summarized" };
    };

const GPT_EFFORT_VALUES = ["low", "medium", "high", "xhigh"] as const;
const CLAUDE_EXTENDED_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;
const CLAUDE_MAX_EFFORT_VALUES = ["low", "medium", "high", "max"] as const;
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

const CLAUDE_EXTENDED_EFFORT_MODELS = new Set(["claude-opus-4.8", "claude-opus-4.7", "claude-sonnet-5", "claude-fable-5"]);
const CLAUDE_MAX_EFFORT_MODELS = new Set(["claude-opus-4.6", "claude-sonnet-4.6"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deriveKiroEffort(schema: unknown): KiroEffortConfig | undefined {
  if (!isRecord(schema) || !isRecord(schema.properties)) return undefined;
  for (const field of ["reasoning", "output_config"] as const) {
    const fieldSchema = schema.properties[field];
    if (!isRecord(fieldSchema) || !isRecord(fieldSchema.properties)) continue;
    const effortSchema = fieldSchema.properties.effort;
    if (!isRecord(effortSchema) || !Array.isArray(effortSchema.enum) || effortSchema.enum.length === 0) continue;
    if (!effortSchema.enum.every((value) => typeof value === "string" && value.length > 0)) continue;
    const thinkingSchema = schema.properties.thinking;
    const displaySchema = isRecord(thinkingSchema) && isRecord(thinkingSchema.properties) ? thinkingSchema.properties.display : undefined;
    const summarizedThinking = isRecord(displaySchema) && Array.isArray(displaySchema.enum) && displaySchema.enum.includes("summarized");
    return { field, values: [...new Set(effortSchema.enum as string[])], summarizedThinking };
  }
  return undefined;
}

export function fallbackKiroEffort(kiroModelId: string): KiroEffortConfig | undefined {
  const normalizedId = kiroModelId.toLowerCase().replace(/(\d)-(\d)/g, "$1.$2");
  if (normalizedId.startsWith("openai-gpt")) {
    return { field: "reasoning", values: GPT_EFFORT_VALUES, summarizedThinking: false };
  }
  if (CLAUDE_EXTENDED_EFFORT_MODELS.has(normalizedId)) {
    return { field: "output_config", values: CLAUDE_EXTENDED_EFFORT_VALUES, summarizedThinking: true };
  }
  if (CLAUDE_MAX_EFFORT_MODELS.has(normalizedId)) {
    return { field: "output_config", values: CLAUDE_MAX_EFFORT_VALUES, summarizedThinking: false };
  }
  return undefined;
}

export function getKiroEffortConfig(schema: unknown, kiroModelId: string): KiroEffortConfig | undefined {
  if (schema !== undefined) return deriveKiroEffort(schema);
  return fallbackKiroEffort(kiroModelId);
}

export function mapPiLevelToKiroEffort(
  model: Model<Api>,
  level: ThinkingLevel,
  config: KiroEffortConfig,
): string | undefined {
  if (config.values.length === 0) return undefined;
  const effectiveLevel = clampThinkingLevel(model, level);
  if (effectiveLevel === "off") return undefined;
  const explicitlyMapped = model.thinkingLevelMap?.[effectiveLevel];
  if (typeof explicitlyMapped === "string" && config.values.includes(explicitlyMapped)) {
    return explicitlyMapped;
  }
  const target = effectiveLevel === "minimal" ? "low" : effectiveLevel;
  if (config.values.includes(target)) return target;
  const targetIndex = EFFORT_ORDER.indexOf(target as (typeof EFFORT_ORDER)[number]);
  if (targetIndex >= 0) {
    for (let index = targetIndex; index < EFFORT_ORDER.length; index++) {
      const candidate = EFFORT_ORDER[index];
      if (config.values.includes(candidate)) return candidate;
    }
    for (let index = targetIndex - 1; index >= 0; index--) {
      const candidate = EFFORT_ORDER[index];
      if (config.values.includes(candidate)) return candidate;
    }
  }
  return config.values[0];
}

export function buildKiroAdditionalModelRequestFields(
  model: Model<Api> & { additionalModelRequestFieldsSchema?: unknown },
  kiroModelId: string,
  level: ThinkingLevel | undefined,
): KiroAdditionalModelRequestFields | undefined {
  if (!level || !model.reasoning) return undefined;
  const config = getKiroEffortConfig(model.additionalModelRequestFieldsSchema, kiroModelId);
  if (!config) return undefined;
  const effort = mapPiLevelToKiroEffort(model, level, config);
  if (!effort) return undefined;
  return config.field === "output_config"
    ? { output_config: { effort }, thinking: { type: "adaptive", ...(config.summarizedThinking ? { display: "summarized" as const } : {}) } }
    : { reasoning: { effort } };
}