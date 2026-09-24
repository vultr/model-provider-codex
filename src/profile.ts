import { parse, stringify } from "smol-toml";

export const PROFILE = "vultr";
export const PROVIDER = "vultr";
export const API_KEY_ENV = "VULTR_INFERENCE_API_KEY";
export const MARKER = "# Managed by @vultr/model-provider-codex.";

const HEADER = `${MARKER}
# vultr-codex install sets the provider, catalog and refresh hook here and keeps everything else:
# Codex writes the model you pick, hook trust and project trust into this file too.
`;

type Table = Record<string, unknown>;

export interface ProfileOptions {
  baseUrl: string;
  // Used only when the file has no model yet, or `force` is set.
  model: string;
  forceModel?: boolean;
  catalogPath: string;
  // The refresh command the SessionStart hook runs. Omitted: our hook is removed.
  refreshCommand?: string;
}

const table = (value: unknown): Table =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Table) : {};

export const isRefreshHook = (handler: unknown) => / refresh --hook( |$)/.test(String(table(handler).command ?? ""));

// Codex trusts a hook by its position (`<file>:session_start:<group>:<handler>`), so ours keeps its place.
function withRefreshHook(groups: unknown, command: string | undefined): Table[] {
  const list = (Array.isArray(groups) ? groups : []).map(table);
  const ours = { type: "command", command, timeout: 15 };
  let placed = false;
  const kept = list
    .map((group) => {
      const handlers = (Array.isArray(group.hooks) ? group.hooks : []).flatMap((handler) => {
        if (!isRefreshHook(handler)) return [handler];
        if (!command || placed) return [];
        placed = true;
        return [ours];
      });
      return { ...group, hooks: handlers };
    })
    .filter((group) => group.hooks.length > 0);
  if (command && !placed) kept.push({ hooks: [ours] });
  return kept;
}

// Codex reads <CODEX_HOME>/<profile>.config.toml for `codex --profile <profile>`.
export function applyProfile(existing: Table, options: ProfileOptions): Table {
  const profile: Table = { ...existing };
  profile.model_provider = PROVIDER;
  if (options.forceModel || typeof profile.model !== "string") profile.model = options.model;
  profile.model_catalog_json = options.catalogPath;
  // Vultr serves no hosted web search tool.
  profile.web_search = "disabled";
  profile.model_providers = {
    ...table(profile.model_providers),
    [PROVIDER]: { name: "Vultr", base_url: options.baseUrl, env_key: API_KEY_ENV, wire_api: "responses" },
  };
  const hooks = table(profile.hooks);
  const sessionStart = withRefreshHook(hooks.SessionStart, options.refreshCommand);
  const { SessionStart: _, ...otherHooks } = hooks;
  profile.hooks = sessionStart.length > 0 ? { ...otherHooks, SessionStart: sessionStart } : otherHooks;
  if (Object.keys(table(profile.hooks)).length === 0) delete profile.hooks;
  if (options.refreshCommand) profile.features = { ...table(profile.features), hooks: true };
  return profile;
}

export function parseProfile(text: string): Table {
  return parse(text) as Table;
}

export function renderProfile(profile: Table): string {
  return `${HEADER}\n${stringify(profile)}\n`;
}

export function isManaged(text: string): boolean {
  return text.startsWith(MARKER);
}
