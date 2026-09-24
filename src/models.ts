import { readFileSync } from "node:fs";

import { acceptsInput, isChatModel, type CatalogModel } from "@vultr/model-catalog";

// Codex's reasoning efforts, lowest first. A catalog effort outside this list is dropped.
export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type Effort = (typeof EFFORTS)[number];

const EFFORT_DESCRIPTIONS: Record<Effort, string> = {
  none: "No reasoning",
  minimal: "Fastest responses with the least reasoning",
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Greater reasoning depth for complex problems",
  xhigh: "Extra high reasoning depth for complex problems",
  max: "Maximum reasoning depth for the hardest problems",
  ultra: "Maximum reasoning with automatic task delegation",
};

export interface ReasoningLevel {
  effort: Effort;
  description: string;
}

// The shape Codex parses from model_catalog_json (codex-rs ModelInfo).
export interface CodexModel {
  slug: string;
  display_name: string;
  description: string;
  default_reasoning_level: Effort | null;
  supported_reasoning_levels: ReasoningLevel[];
  shell_type: "unified_exec";
  visibility: "list";
  supported_in_api: true;
  priority: number;
  support_verbosity: false;
  default_verbosity: null;
  default_reasoning_summary: "none";
  apply_patch_tool_type: "freeform";
  web_search_tool_type: "text";
  truncation_policy: { mode: "tokens"; limit: number };
  experimental_supported_tools: string[];
  context_window: number;
  input_modalities: ("text" | "image")[];
  base_instructions: string;
}

export interface CodexCatalog {
  models: CodexModel[];
}

// Codex needs a system prompt per model. This is the one Codex itself sends to a model it has no metadata for.
export const BASE_INSTRUCTIONS = readFileSync(new URL("../prompts/base_instructions.md", import.meta.url), "utf8");

// A model with no allowlist gets no levels: Codex then sends no effort and the engine default applies.
export function reasoningLevels(model: CatalogModel): ReasoningLevel[] {
  const reasoning = model.reasoning;
  if (!reasoning?.supportedEfforts) {
    return [];
  }
  const listed = new Set(reasoning.supportedEfforts);
  if (!reasoning.mandatory) {
    listed.add("none");
  }
  return EFFORTS.filter((effort) => listed.has(effort)).map((effort) => ({
    effort,
    description: EFFORT_DESCRIPTIONS[effort],
  }));
}

export function defaultReasoningLevel(model: CatalogModel, levels: ReasoningLevel[]): Effort | null {
  const efforts = levels.map((level) => level.effort);
  const preferred = [model.reasoning?.defaultEffort, "medium"].find((effort) => efforts.includes(effort as Effort));
  return (preferred as Effort | undefined) ?? efforts.find((effort) => effort !== "none") ?? null;
}

// Codex is an agent: a model that cannot call tools, or has no context window to budget against, is not offered.
export function isUsable(model: CatalogModel): boolean {
  return isChatModel(model) && model.isReady && model.tools && model.contextWindow !== null;
}

export function toCodexModel(model: CatalogModel, priority: number): CodexModel {
  const levels = reasoningLevels(model);
  return {
    slug: model.id,
    display_name: model.name,
    description: model.description ?? `${model.name} on Vultr Inference`,
    default_reasoning_level: defaultReasoningLevel(model, levels),
    supported_reasoning_levels: levels,
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority,
    support_verbosity: false,
    default_verbosity: null,
    default_reasoning_summary: "none",
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text",
    truncation_policy: { mode: "tokens", limit: 10_000 },
    experimental_supported_tools: [],
    context_window: model.contextWindow ?? 0,
    input_modalities: acceptsInput(model, "image") ? ["text", "image"] : ["text"],
    base_instructions: BASE_INSTRUCTIONS,
  };
}

export function toCodexCatalog(models: CatalogModel[]): CodexCatalog {
  return { models: models.filter(isUsable).map((model, index) => toCodexModel(model, index + 1)) };
}
