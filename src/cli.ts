import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_BASE_URL, loadCatalog } from "@vultr/model-catalog";

import { toCodexCatalog, type CodexCatalog } from "./models.ts";
import { API_KEY_ENV, PROFILE, applyProfile, isManaged, parseProfile, renderProfile } from "./profile.ts";

export const BASE_URL_ENV = "VULTR_INFERENCE_BASE_URL";
// A session start within this window reuses the cached catalog instead of fetching.
const REFRESH_MAX_AGE_MS = 10 * 60_000;

export interface Paths {
  codexHome: string;
  profile: string;
  catalog: string;
  cache: string;
  // The copy of this tool the hook runs. It mirrors the package layout, so the prompt resolves the same way.
  bundle: string;
  prompt: string;
}

// This package's own files. From the source tree, the bundle is the committed build.
const PACKAGE_FILES = {
  bundle: fileURLToPath(new URL("../dist/vultr-codex.js", import.meta.url)),
  prompt: fileURLToPath(new URL("../prompts/base_instructions.md", import.meta.url)),
};

export function paths(codexHome: string): Paths {
  return {
    codexHome,
    profile: join(codexHome, `${PROFILE}.config.toml`),
    catalog: join(codexHome, "vultr", "models.json"),
    cache: join(codexHome, "vultr", "catalog-cache.json"),
    bundle: join(codexHome, "vultr", "dist", "vultr-codex.js"),
    prompt: join(codexHome, "vultr", "prompts", "base_instructions.md"),
  };
}

interface Options {
  codexHome: string;
  baseUrl: string;
  model?: string;
  hook: boolean;
  force: boolean;
}

const USAGE = `usage: npx @vultr/model-provider-codex <install|refresh|uninstall> [options]

  install     write the catalog and the "${PROFILE}" profile, then: codex -p ${PROFILE}
  refresh     rewrite the catalog from GET /v1/models
  uninstall   remove the profile, the catalog and the hook's copy of this tool

options:
  --model <id>        default model for the profile (install)
  --no-hook           do not refresh on session start (install)
  --force             take over a ${PROFILE}.config.toml this tool did not write (install)
  --codex-home <dir>  default: $CODEX_HOME or ~/.codex
  --base-url <url>    default: $${BASE_URL_ENV} or ${DEFAULT_BASE_URL}
  --hook              quiet, and never fail: how the session start hook runs refresh

install keeps a copy of this tool in <codex home>/vultr/dist for the hook, so it works after npx.
`;

function parseArgs(argv: string[]): { command: string | undefined; options: Options } {
  const options: Options = {
    codexHome: process.env.CODEX_HOME || join(homedir(), ".codex"),
    baseUrl: process.env[BASE_URL_ENV] || DEFAULT_BASE_URL,
    hook: true,
    force: false,
  };
  let command: string | undefined;
  let refreshHook = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new UsageError(`${arg} needs a value`);
      return next;
    };
    if (arg === "--model") options.model = value();
    else if (arg === "--codex-home") options.codexHome = resolve(value());
    else if (arg === "--base-url") options.baseUrl = value();
    else if (arg === "--no-hook") options.hook = false;
    else if (arg === "--force") options.force = true;
    else if (arg === "--hook") refreshHook = true;
    else if (arg === "-h" || arg === "--help") command = "help";
    else if (!command && arg && !arg.startsWith("-")) command = arg;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  // On refresh, --hook means "called from the hook"; on install it is the default.
  if (command === "refresh") options.hook = refreshHook;
  return { command, options };
}

class UsageError extends Error {}

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

// Codex refuses to start on an empty or unparsable catalog, so an empty result never replaces a good file.
export async function refresh(options: Options): Promise<CodexCatalog> {
  const p = paths(options.codexHome);
  const catalog = await loadCatalog({
    baseUrl: options.baseUrl,
    cachePath: p.cache,
    timeoutMs: options.hook ? 5_000 : 15_000,
    ...(options.hook ? { maxAgeMs: REFRESH_MAX_AGE_MS } : {}),
  });
  const codex = toCodexCatalog(catalog.models);
  if (codex.models.length === 0) {
    throw new Error("the catalog has no model Codex can use");
  }
  await writeAtomic(p.catalog, `${JSON.stringify(codex, null, 2)}\n`);
  if (!options.hook) {
    console.log(`${p.catalog}: ${codex.models.length} models (${catalog.source})`);
  }
  return codex;
}

// npx runs from a cache npm may clear, so the hook runs a copy kept in CODEX_HOME.
async function installSelf(p: Paths): Promise<void> {
  for (const file of ["bundle", "prompt"] as const) {
    if (resolve(PACKAGE_FILES[file]) === resolve(p[file])) continue;
    await mkdir(dirname(p[file]), { recursive: true });
    const tmp = `${p[file]}.${process.pid}.tmp`;
    await copyFile(PACKAGE_FILES[file], tmp);
    await rename(tmp, p[file]);
  }
}

function refreshCommand(options: Options): string {
  const script = paths(options.codexHome).bundle;
  const q = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  return ["node", q(script), "refresh", "--hook", "--codex-home", q(options.codexHome), "--base-url", q(options.baseUrl)].join(" ");
}

async function install(options: Options): Promise<void> {
  const p = paths(options.codexHome);
  const existing = existsSync(p.profile) ? await readFile(p.profile, "utf8") : null;
  if (existing !== null && !isManaged(existing) && !options.force) {
    throw new Error(`${p.profile} exists and was not written by vultr-codex; pass --force to take it over`);
  }
  const catalog = await refresh({ ...options, hook: false });
  const slugs = catalog.models.map((model) => model.slug);
  if (options.model && !slugs.includes(options.model)) {
    throw new Error(`--model ${options.model} is not in the catalog: ${slugs.join(", ")}`);
  }
  if (options.hook) await installSelf(p);
  const current = existing !== null ? parseProfile(existing) : {};
  const kept = typeof current.model === "string" && slugs.includes(current.model);
  const profile = applyProfile(current, {
    baseUrl: options.baseUrl,
    model: options.model ?? slugs[0]!,
    forceModel: options.model !== undefined || !kept,
    catalogPath: p.catalog,
    ...(options.hook ? { refreshCommand: refreshCommand(options) } : {}),
  });
  await writeAtomic(p.profile, renderProfile(profile));
  const model = String(profile.model);
  console.log(`${p.profile}: profile "${PROFILE}", model ${model}`);
  console.log(`\nexport ${API_KEY_ENV}=...\ncodex -p ${PROFILE}`);
  if (options.hook) {
    console.log(
      "\nCodex runs a new hook only after you trust it: start `codex -p vultr` once and approve the SessionStart hook." +
        `\nUntil then the catalog changes only when you run: node ${p.bundle} refresh`,
    );
  }
}

async function uninstall(options: Options): Promise<void> {
  const p = paths(options.codexHome);
  if (existsSync(p.profile) && !isManaged(await readFile(p.profile, "utf8"))) {
    throw new Error(`${p.profile} was not written by vultr-codex; leaving it`);
  }
  await rm(p.profile, { force: true });
  await rm(dirname(p.catalog), { recursive: true, force: true });
  console.log(`removed ${p.profile} and ${dirname(p.catalog)}`);
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`vultr-codex: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { command, options } = parsed;
  try {
    if (command === "install") await install(options);
    else if (command === "refresh") await refresh(options);
    else if (command === "uninstall") await uninstall(options);
    else {
      (command === "help" ? console.log : console.error)(USAGE);
      return command === "help" ? 0 : 2;
    }
    return 0;
  } catch (error) {
    // A failed refresh from the hook keeps the last catalog and must not disturb the session.
    if (command === "refresh" && options.hook) return 0;
    console.error(`vultr-codex: ${(error as Error).message}`);
    return 1;
  }
}
