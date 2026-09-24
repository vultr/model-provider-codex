import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeModel, type ModelReasoning } from "@vultr/model-catalog";

import { BASE_INSTRUCTIONS, isUsable, reasoningLevels, toCodexCatalog, toCodexModel } from "../src/models.ts";
import { document } from "./fixture.ts";

const efforts = (reasoning: ModelReasoning | null) =>
  reasoningLevels(normalizeModel(document({ reasoning }))).map((level) => level.effort);

test("a catalog model becomes a Codex model", () => {
  const model = toCodexModel(normalizeModel(document()), 3);
  assert.deepEqual(
    { ...model, supported_reasoning_levels: model.supported_reasoning_levels.map((level) => level.effort) },
    {
      slug: "glm-5.3",
      display_name: "GLM 5.3",
      description: "GLM 5.3 on Vultr Inference",
      default_reasoning_level: "medium",
      supported_reasoning_levels: ["none", "low", "medium", "high", "max", "ultra"],
      shell_type: "unified_exec",
      visibility: "list",
      supported_in_api: true,
      priority: 3,
      support_verbosity: false,
      default_verbosity: null,
      default_reasoning_summary: "none",
      apply_patch_tool_type: "freeform",
      web_search_tool_type: "text",
      truncation_policy: { mode: "tokens", limit: 10_000 },
      experimental_supported_tools: [],
      context_window: 1_048_576,
      input_modalities: ["text", "image"],
      base_instructions: BASE_INSTRUCTIONS,
    },
  );
});

test("the base instructions are Codex's own", () => {
  assert.match(BASE_INSTRUCTIONS, /^You are a coding agent running in the Codex CLI/);
});

test("reasoning levels follow the reasoning block", () => {
  // Unknown efforts are dropped; none is offered because reasoning can be switched off.
  assert.deepEqual(efforts(document().reasoning ?? null), ["none", "low", "medium", "high", "max", "ultra"]);
  assert.deepEqual(efforts({ mandatory: true, supported_efforts: ["high", "low"] }), ["low", "high"]);
  // No allowlist or no reasoning: no levels, so Codex sends no effort.
  assert.deepEqual(efforts({ mandatory: false, supported_efforts: null }), []);
  assert.deepEqual(efforts(null), []);
});

test("the default level is the catalog's, then medium, then the lowest real effort", () => {
  const level = (reasoning: ModelReasoning | null) =>
    toCodexModel(normalizeModel(document({ reasoning })), 1).default_reasoning_level;
  assert.equal(level({ mandatory: false, default_effort: "high", supported_efforts: ["low", "medium", "high"] }), "high");
  assert.equal(level({ mandatory: false, default_effort: "turbo", supported_efforts: ["low", "medium"] }), "medium");
  assert.equal(level({ mandatory: false, supported_efforts: ["max", "low"] }), "low");
  assert.equal(level(null), null);
});

test("a text-only model maps", () => {
  const model = toCodexModel(
    normalizeModel(document({ input_modalities: [{ type: "text", supported_inputs: { max_context_length: { value: 8_192 } } }] })),
    1,
  );
  assert.deepEqual(model.input_modalities, ["text"]);
  assert.equal(model.context_window, 8_192);
});

test("only ready chat models with tools and a context window are offered, in catalog order", () => {
  const reranker = document({ id: "rerank", output_modalities: [{ type: "rerank", supported_parameters: {} }] });
  const unready = document({ id: "unready", is_ready: false });
  const blind = document({ id: "no-context", input_modalities: [{ type: "text" }] });
  const toolless = document({ id: "no-tools", output_modalities: [{ type: "text", supported_parameters: {} }] });
  const second = document({ id: "second" });
  const models = [document(), reranker, unready, blind, toolless, second].map(normalizeModel);
  assert.deepEqual(models.map(isUsable), [true, false, false, false, false, true]);
  assert.deepEqual(
    toCodexCatalog(models).models.map((model) => [model.slug, model.priority]),
    [
      ["glm-5.3", 1],
      ["second", 2],
    ],
  );
});
