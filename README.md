# @vultr/model-provider-codex

Vultr Inference as a model provider for [Codex CLI](https://github.com/openai/codex). `vultr-codex` turns the live `GET /v1/models` catalog into a Codex model catalog and a `vultr` profile, so `codex -p vultr` lists every usable Vultr model in `/model`, with its context window, image input and reasoning levels.

## Install

```bash
npx @vultr/model-provider-codex install
export VULTR_INFERENCE_API_KEY=...
codex -p vultr
```

That is the only step. The first `codex -p vultr` asks you to review a new
hook: trust it. From then on every session start keeps the model list current.
Codex never runs an untrusted hook, and `codex exec` skips one without saying so.

`install` takes `--model <id>` to set the profile's model, `--no-hook` to skip
the refresh hook, and `--codex-home` / `--base-url` (defaults: `$CODEX_HOME`
or `~/.codex`, `$VULTR_INFERENCE_BASE_URL` or `https://api.vultrinference.com/v1`).
Run it again at any time: it is idempotent, and it is how you upgrade.
`npx @vultr/model-provider-codex uninstall` removes everything it wrote.

From a local checkout: `node dist/vultr-codex.js install`.

## How it works

Codex has no plugin hook for providers. It has two config surfaces this uses:

- **`model_catalog_json`**, a path to a JSON model list. When set, it replaces
  Codex's built-in list: `/model`, `codex debug models` and model metadata all
  come from it
- **Profile files.** `codex -p vultr` layers `<CODEX_HOME>/vultr.config.toml`
  over `config.toml`. Your `config.toml` is never touched

`install` writes:

| File | Content |
| --- | --- |
| `<CODEX_HOME>/vultr/models.json` | The catalog in Codex's schema |
| `<CODEX_HOME>/vultr/dist/vultr-codex.js`, `<CODEX_HOME>/vultr/prompts/` | The copy of this tool the hook runs |
| `<CODEX_HOME>/vultr/catalog-cache.json` | The last good `/v1/models` payload |
| `<CODEX_HOME>/vultr.config.toml` | `model_provider = "vultr"`, `model`, `model_catalog_json`, `web_search = "disabled"`, `[model_providers.vultr]` (`wire_api = "responses"`, `env_key = "VULTR_INFERENCE_API_KEY"`), and a `SessionStart` hook |

The hook runs `node <CODEX_HOME>/vultr/dist/vultr-codex.js refresh --hook`
when a session starts. It runs that copy, not the package: npx runs from a
cache npm may clear, and the bundle has no dependencies, so the copy stands
alone. The copy is the version you last installed; rerun `install` to upgrade.
The hook command does not change between versions, so it stays trusted. It reuses a
catalog fetched in the last 10 minutes, fetches otherwise (5 s timeout), and
falls back to the cache. It prints nothing and never fails the session.
Codex reads the catalog before the hook runs, so a change shows up in the next
session. `npx @vultr/model-provider-codex refresh` does the same on demand.

A refresh that fails, or finds no usable model, leaves `models.json` as it
was: Codex will not start with that file missing or empty.

### The profile file is shared with Codex

Codex writes into the active profile file: the model and effort you pick in
`/model`, the trust hash of each hook you approve (`[hooks.state]`) and
projects you trust (`[projects]`). `install` parses the file, sets only the
keys above, replaces its own hook in place and keeps everything else, so a
reinstall keeps your model choice and the hook stays trusted. A
`vultr.config.toml` that `vultr-codex` did not create is left alone unless you
pass `--force`.

## Mapping

| Codex (`model_catalog_json`) | Catalog |
| --- | --- |
| `slug`, `display_name`, `description` | `id`, `name`, `description` |
| `context_window` | `contextWindow` |
| `input_modalities` | `text`, plus `image` when the model accepts it |
| `supported_reasoning_levels` | `supportedEfforts` that Codex knows (`minimal` ... `ultra`), plus `none` unless reasoning is mandatory. No allowlist: none, and Codex sends no effort |
| `default_reasoning_level` | the catalog default if listed, else `medium`, else the lowest listed effort |
| `priority` | catalog order |
| `base_instructions` | `prompts/base_instructions.md` |
| everything else | fixed: `unified_exec` shell, freeform `apply_patch`, no verbosity, no reasoning summary |

Offered: text output, `is_ready`, tool calling, and a context window.

`base_instructions` is the entire system prompt Codex sends, not an addition to
it. `prompts/base_instructions.md` is the prompt Codex sends to a model it has
no metadata for, captured from Codex 0.155.0. Codex is Apache-2.0,
Copyright OpenAI.

## Environment

| Variable | Meaning |
| --- | --- |
| `VULTR_INFERENCE_API_KEY` | Sent by Codex as the Bearer token |
| `VULTR_INFERENCE_BASE_URL` | Default for `--base-url` at install; the profile and hook keep the value install used |
| `CODEX_HOME` | Default for `--codex-home` |

## Development

```bash
npm install
npm run typecheck
npm test
npm run build   # commit dist/ with the source
```

Verify against the installed Codex in a throwaway home, never `~/.codex`:

```bash
export CODEX_HOME=$(mktemp -d)
node dist/vultr-codex.js install --codex-home "$CODEX_HOME"
codex debug models -c model_catalog_json="$CODEX_HOME/vultr/models.json"
```

`codex debug models` rejects `-p`; it reports schema errors by field name. For
what Codex sends, no API key is needed: serve `POST /v1/responses` from a local
server that records the body and answers with a short Responses SSE stream
(`response.created`, `response.output_item.done`, `response.completed`), point
`--base-url` at it, and set `VULTR_INFERENCE_API_KEY` to any value.

To recapture `prompts/base_instructions.md` after a Codex upgrade, run
`codex exec -c model=not-in-catalog` against that capture server with the
provider set and no `model_catalog_json`, and save the request's
`instructions`.
