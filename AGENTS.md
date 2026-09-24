# AGENTS.md - vultr/model-provider-codex

A small CLI, `vultr-codex`, that points Codex CLI at Vultr Inference from the live catalog. Codex has no plugin hook for model providers; it has `model_catalog_json` (a file that replaces the model list) and per-profile config files. `src/models.ts` maps the catalog onto Codex's model schema; `src/profile.ts` merges the `vultr` profile; `src/cli.ts` is install, refresh and uninstall; `dist/vultr-codex.js` is the committed bundle that `bin` points at and that install copies into `CODEX_HOME` for the hook. Users run it once with `npx @vultr/model-provider-codex install`.

Human overview, mapping table and install: `README.md`.

## What holds the design up

- **The catalog library does the reading.** `@vultr/model-catalog` fetches
  `GET /v1/models`, parses Model Document 2.4 and normalizes it. This repo
  only maps a normalized model onto what Codex has a place for. A parsing
  or normalization fix belongs in the library, not here
- **Nothing static.** No model id, context window or price is written in this
  repo. A model Vultr adds shows up on the next refresh without a release
- **Never break the host.** Codex refuses to start when `model_catalog_json`
  is missing, empty or unparsable. A refresh that fails or finds no usable
  model leaves the last file in place, and the hook form always exits 0 and
  prints nothing
- **Only usable models are offered:** text output, `is_ready`, tool calling
  and a context window. Codex is an agent; a model without tools cannot work
- **The profile file is shared with Codex.** Codex writes the model picked in
  `/model`, `model_reasoning_effort`, `[hooks.state]` trust hashes and
  `[projects]` trust into the active profile file. Install sets only the keys
  it owns and keeps everything else. Never regenerate the file from scratch
- **Installed with npx, run from a copy.** npx runs from a cache npm may
  clear, so install copies the dependency-free bundle and the prompt into
  `<CODEX_HOME>/vultr/` (same layout as the package) and the hook runs that.
  Keep the hook command identical across versions: changing it drops trust
- **Hook trust is by position.** Codex keys a trusted hook as
  `<file>:session_start:<group>:<handler>` plus a hash of its definition. The
  refresh hook is replaced in place so an unchanged command stays trusted.
  Never write `trusted_hash` ourselves: trusting is the user's decision
- **`base_instructions` is the whole system prompt.** A catalog entry's
  `base_instructions` replaces Codex's prompt entirely. `prompts/base_instructions.md`
  is the prompt Codex itself sends to a model it has no metadata for
- **Reasoning travels as Responses `reasoning.effort`,** limited to the model's
  `supported_efforts`; `none` is offered unless reasoning is mandatory. No
  allowlist means no levels, and Codex then sends no effort.
- **Siblings:** `model-provider-pi`, `model-provider-openclaw`,
  `model-provider-opencode`. Same catalog library, same usability rules

## Working here

- `npm run typecheck` and `npm test` must pass
- `dist/vultr-codex.js` is committed and must be current: `npm run build` after
  any source change, in the same commit. `test/bundle.test.ts` fails otherwise.
  Node does not strip types under `node_modules`, and a git dependency's
  `prepare` may not run, so the catalog library and `smol-toml` are
  devDependencies bundled into `dist/` and there are no runtime dependencies
- Codex's behavior is in the installed binary, not in web summaries. The
  schema errors from `codex debug models -c model_catalog_json=<file>` name
  missing fields exactly. `codex debug models` does not take `-p`
- Test in a throwaway `CODEX_HOME`, never in the user's `~/.codex`. The README
  describes the key-free capture setup. `codex exec` skips untrusted hooks
  silently; trusting a hook needs the TUI
- When Codex is upgraded, recapture `prompts/base_instructions.md` (README,
  Development) and rerun the checks against the new binary
- Put lasting explanation in `docs/` or the README, not in the source. If a
  comment is needed, make it short. Docs describe current behavior, not history
- Write commit messages to the Conventional Commits spec
- No em dashes or en dashes anywhere: prose, comments, commit messages and
  docs use plain hyphens, `·`, or `:`
- No AI trailers on commits (`Co-Authored-By`, `Generated with`, ...)
- Never force-push; never rewrite pushed history
