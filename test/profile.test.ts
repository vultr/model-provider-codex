import assert from "node:assert/strict";
import { test } from "node:test";

import { applyProfile, isManaged, parseProfile, renderProfile } from "../src/profile.ts";

const options = {
  baseUrl: "https://api.vultrinference.com/v1",
  model: "glm-5.3",
  catalogPath: "/home/u/.codex/vultr/models.json",
  refreshCommand: "node '/x/vultr-codex.js' refresh --hook --codex-home '/home/u/.codex'",
};
const ours = { type: "command", command: options.refreshCommand, timeout: 15 };

test("a new profile selects the provider, model and catalog, and refreshes on session start", () => {
  const text = renderProfile(applyProfile({}, options));
  assert.ok(isManaged(text));
  assert.deepEqual(parseProfile(text), {
    model_provider: "vultr",
    model: "glm-5.3",
    model_catalog_json: "/home/u/.codex/vultr/models.json",
    web_search: "disabled",
    model_providers: {
      vultr: { name: "Vultr", base_url: "https://api.vultrinference.com/v1", env_key: "VULTR_INFERENCE_API_KEY", wire_api: "responses" },
    },
    hooks: { SessionStart: [{ hooks: [ours] }] },
    features: { hooks: true },
  });
});

// What Codex writes into the active profile file: the picked model and effort, hook trust, project trust.
const codexWrote = {
  model_provider: "vultr",
  model: "minimax-m3",
  model_reasoning_effort: "high",
  model_catalog_json: "/old/models.json",
  model_providers: { vultr: { base_url: "https://old/v1" }, other: { base_url: "https://other/v1" } },
  features: { hooks: true, goals: true },
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "node '/old/vultr-codex.js' refresh --hook", timeout: 15 }] }],
    Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
    state: { "/home/u/.codex/vultr.config.toml:session_start:0:0": { trusted_hash: "sha256:abc" } },
  },
  projects: { "/src/app": { trust_level: "trusted" } },
};

test("reinstalling keeps what Codex and the user wrote", () => {
  const profile = applyProfile(codexWrote, options);
  assert.equal(profile.model, "minimax-m3");
  assert.equal(profile.model_reasoning_effort, "high");
  assert.equal(profile.model_catalog_json, options.catalogPath);
  assert.deepEqual(profile.projects, codexWrote.projects);
  assert.deepEqual(profile.features, { hooks: true, goals: true });
  const hooks = profile.hooks as typeof codexWrote.hooks;
  assert.deepEqual(hooks.state, codexWrote.hooks.state);
  assert.deepEqual(hooks.Stop, codexWrote.hooks.Stop);
  // Replaced in place, so the trust entry keyed by its position still names it.
  assert.deepEqual(hooks.SessionStart, [{ hooks: [ours] }]);
  assert.deepEqual((profile.model_providers as Record<string, unknown>).other, { base_url: "https://other/v1" });
  assert.equal(applyProfile(codexWrote, { ...options, forceModel: true }).model, "glm-5.3");
});

test("another SessionStart hook keeps its place, and --no-hook removes only ours", () => {
  const theirs = { type: "command", command: "echo hi" };
  const existing = { hooks: { SessionStart: [{ hooks: [theirs] }] } };
  const added = applyProfile(existing, options).hooks as { SessionStart: unknown };
  assert.deepEqual(added.SessionStart, [{ hooks: [theirs] }, { hooks: [ours] }]);

  const { refreshCommand: _, ...noHook } = options;
  const removed = applyProfile({ hooks: added }, noHook).hooks as { SessionStart: unknown };
  assert.deepEqual(removed.SessionStart, [{ hooks: [theirs] }]);
  assert.equal(applyProfile(applyProfile({}, options), noHook).hooks, undefined);
});

test("a file without the marker is not ours", () => {
  assert.equal(isManaged('model = "x"\n'), false);
});
