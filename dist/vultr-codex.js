#!/usr/bin/env node

// src/cli.ts
import { existsSync } from "node:fs";
import { copyFile, mkdir as mkdir2, readFile as readFile2, rename as rename2, rm, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname2, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// node_modules/@vultr/model-catalog/dist/catalog.js
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// node_modules/@vultr/model-catalog/dist/model.js
function limit(value) {
  return typeof value?.value === "number" && Number.isFinite(value.value) ? value.value : null;
}
function isWindowed(entry) {
  return entry.utc_start !== void 0 || entry.utc_end !== void 0 || entry.utc_days !== void 0;
}
function price(entries, type, unit) {
  const matches = (entries ?? []).filter((entry) => entry.type === type && entry.unit === unit && typeof entry.cost_usd === "string");
  return (matches.find((entry) => !isWindowed(entry)) ?? matches[0])?.cost_usd ?? null;
}
function normalizeModel(document) {
  const textIn = document.input_modalities.find((modality) => modality.type === "text");
  const textOut = document.output_modalities.find((modality) => modality.type === "text");
  const parameters = textOut?.supported_parameters ?? {};
  const reasoning = document.reasoning ?? null;
  return {
    id: document.id,
    name: document.name || document.id,
    description: document.description ?? null,
    created: document.created ?? null,
    huggingFaceId: document.hugging_face_id ?? null,
    quantization: document.quantization ?? null,
    contextWindow: limit(textIn?.supported_inputs?.max_context_length),
    maxPromptTokens: limit(textIn?.supported_inputs?.max_prompt_length),
    maxOutputTokens: limit(textOut?.max_length),
    inputModalities: document.input_modalities.map((modality) => modality.type),
    outputModalities: document.output_modalities.map((modality) => modality.type),
    pricing: {
      prompt: price(textIn?.pricing, "prompt", "token"),
      cachedPrompt: price(textIn?.pricing, "cached_prompt", "token"),
      cacheWrite: price(textIn?.pricing, "cache_write", "token"),
      completion: price(textOut?.pricing, "completion", "token"),
      internalReasoning: price(textOut?.pricing, "internal_reasoning", "token"),
      request: price(document.pricing, "request", "request")
    },
    tools: "tools" in parameters,
    structuredOutputs: "response_format" in parameters || "structured_outputs" in parameters,
    streaming: textOut?.streaming === true,
    supportedParameters: Object.keys(parameters),
    parameters,
    reasoning: reasoning && {
      mandatory: reasoning.mandatory === true,
      defaultEffort: reasoning.default_effort ?? null,
      defaultEnabled: reasoning.default_enabled ?? null,
      supportedEfforts: reasoning.supported_efforts ?? null,
      supportsMaxTokens: reasoning.supports_max_tokens === true
    },
    isReady: document.is_ready !== false,
    deprecationDate: document.deprecation_date ?? null
  };
}
function isChatModel(model) {
  return model.outputModalities.includes("text");
}
function acceptsInput(model, modality) {
  return model.inputModalities.includes(modality);
}

// node_modules/@vultr/model-catalog/dist/document.js
var SCHEMA_VERSION = "2.4";

// node_modules/@vultr/model-catalog/dist/parse.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isModalityList(value) {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item["type"] === "string");
}
function parseCatalog(payload) {
  const entries = Array.isArray(payload) ? payload : isRecord(payload) ? payload["data"] : void 0;
  if (!Array.isArray(entries)) {
    throw new TypeError("catalog payload must be an array or an object with a data array");
  }
  const documents = [];
  const issues = [];
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push({ index, id: null, message: "entry is not an object" });
      return;
    }
    const id = typeof entry["id"] === "string" && entry["id"] !== "" ? entry["id"] : null;
    if (id === null) {
      issues.push({ index, id, message: "entry has no id" });
      return;
    }
    if (!isModalityList(entry["input_modalities"]) || !isModalityList(entry["output_modalities"])) {
      issues.push({ index, id, message: "entry has no usable input_modalities/output_modalities" });
      return;
    }
    if (entry["schema_version"] !== SCHEMA_VERSION) {
      issues.push({
        index,
        id,
        message: `schema_version is ${JSON.stringify(entry["schema_version"])}, expected "${SCHEMA_VERSION}"; parsed anyway`
      });
    }
    documents.push(entry);
  });
  return { documents, issues };
}

// node_modules/@vultr/model-catalog/dist/catalog.js
var DEFAULT_BASE_URL = "https://api.vultrinference.com/v1";
var DEFAULT_TIMEOUT_MS = 8e3;
var CatalogError = class extends Error {
  name = "CatalogError";
};
function modelsUrl(baseUrl = DEFAULT_BASE_URL) {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}
async function fetchCatalog(options = {}) {
  const url = modelsUrl(options.baseUrl);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const headers = { accept: "application/json", ...options.headers };
  if (options.apiKey) {
    headers["authorization"] = `Bearer ${options.apiKey}`;
  }
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, { headers, signal });
    if (!response.ok) {
      throw new CatalogError(`GET ${url} returned HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof CatalogError) {
      throw error;
    }
    throw new CatalogError(`GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
}
function buildCatalog(payload, source, fetchedAt) {
  const { documents, issues } = parseCatalog(payload);
  return { models: documents.map(normalizeModel), issues, source, fetchedAt };
}
async function readCache(path, baseUrl) {
  try {
    const cached = JSON.parse(await readFile(path, "utf8"));
    if (cached.base_url !== baseUrl || typeof cached.fetched_at !== "number") {
      return null;
    }
    parseCatalog(cached.payload);
    return cached;
  } catch {
    return null;
  }
}
async function writeCache(path, cache) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(cache));
    await rename(temporary, path);
  } catch {
  }
}
async function loadCatalog(options = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const now = options.now ?? Date.now;
  const cached = options.cachePath ? await readCache(options.cachePath, baseUrl) : null;
  if (cached && now() - cached.fetched_at < (options.maxAgeMs ?? 0)) {
    return buildCatalog(cached.payload, "cache", cached.fetched_at);
  }
  try {
    const payload = await fetchCatalog({ ...options, baseUrl });
    const catalog = buildCatalog(payload, "network", now());
    if (options.cachePath && catalog.models.length > 0) {
      await writeCache(options.cachePath, { base_url: baseUrl, fetched_at: catalog.fetchedAt, payload });
    }
    return catalog;
  } catch (error) {
    if (cached) {
      return buildCatalog(cached.payload, "stale-cache", cached.fetched_at);
    }
    throw error instanceof CatalogError ? error : new CatalogError(String(error), { cause: error });
  }
}

// src/models.ts
import { readFileSync } from "node:fs";
var EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
var EFFORT_DESCRIPTIONS = {
  none: "No reasoning",
  minimal: "Fastest responses with the least reasoning",
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Greater reasoning depth for complex problems",
  xhigh: "Extra high reasoning depth for complex problems",
  max: "Maximum reasoning depth for the hardest problems",
  ultra: "Maximum reasoning with automatic task delegation"
};
var BASE_INSTRUCTIONS = readFileSync(new URL("../prompts/base_instructions.md", import.meta.url), "utf8");
function reasoningLevels(model) {
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
    description: EFFORT_DESCRIPTIONS[effort]
  }));
}
function defaultReasoningLevel(model, levels) {
  const efforts = levels.map((level) => level.effort);
  const preferred = [model.reasoning?.defaultEffort, "medium"].find((effort) => efforts.includes(effort));
  return preferred ?? efforts.find((effort) => effort !== "none") ?? null;
}
function isUsable(model) {
  return isChatModel(model) && model.isReady && model.tools && model.contextWindow !== null;
}
function toCodexModel(model, priority) {
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
    truncation_policy: { mode: "tokens", limit: 1e4 },
    experimental_supported_tools: [],
    context_window: model.contextWindow ?? 0,
    input_modalities: acceptsInput(model, "image") ? ["text", "image"] : ["text"],
    base_instructions: BASE_INSTRUCTIONS
  };
}
function toCodexCatalog(models) {
  return { models: models.filter(isUsable).map((model, index) => toCodexModel(model, index + 1)) };
}

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
};

// node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0) {
  let idx = str.indexOf("\n", start);
  if (str.charCodeAt(idx - 1) === 13)
    idx--;
  return idx;
}
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in comments", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (1) {
    while ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}
function skipUntil(ctx, sep, end) {
  let ptr = ctx.p;
  if (!end) {
    ptr = indexOfNewline(ctx.s, ptr);
    ctx.p = ptr < 0 ? ctx.s.length : ptr;
    return;
  }
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 35) {
      skipComment(ctx);
    } else if (c === end || c === sep) {
      return;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: ctx.s,
    ptr
  });
}

// node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(ctx) {
  let start = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in strings", {
        toml: ctx.s,
        ptr: ctx.p
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state)
        parsed += ctx.s.slice(sliceStart, ctx.p);
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p + 1);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: ctx.s, ptr: ctx.p + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: ctx.s, ptr: ctx.p });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p + 1;
        state = 0;
      } else if (c === 32 || c === 9) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: ctx.s, ptr: ctx.p });
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: ctx.s,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  throw new TomlError("unfinished string", { toml: ctx.s, ptr: start });
}
function sliceAndTrimEndOf(ctx, start, end) {
  let value = ctx.s.slice(start, end);
  let commentIdx = value.indexOf("#");
  if (commentIdx > 0) {
    skipComment({ s: value, p: commentIdx, d: 0 });
    value = value.slice(0, commentIdx);
  }
  return value.trimEnd();
}
function parseValue(ctx, integersAsBigInt, end) {
  let ptr = ctx.p;
  let err = { toml: ctx.s, ptr };
  skipUntil(ctx, 44, end);
  let value = sliceAndTrimEndOf(ctx, ptr, ctx.p);
  if (!value)
    throw new TomlError("incomplete declaration: value expected", err);
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", err);
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", err);
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", err);
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid())
    throw new TomlError("invalid value", err);
  return date;
}

// node_modules/smol-toml/dist/extract.js
function extractValue(ctx, end, integersAsBigInt) {
  let ptr = ctx.p;
  let c = ctx.s.charCodeAt(ptr);
  if (c === 91 || c === 123) {
    if (!ctx.d--) {
      throw new TomlError("document contains excessively nested structures. aborting.", {
        toml: ctx.s,
        ptr
      });
    }
    let value = c === 91 ? parseArray(ctx, integersAsBigInt) : parseInlineTable(ctx, integersAsBigInt);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return false;
  }
  return parseValue(ctx, integersAsBigInt, end);
}

// node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(ctx, end = "=") {
  let start = ctx.p;
  let dot = start - 1;
  let parsed = [];
  let endPtr = ctx.s.indexOf(end, start);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: ctx.s,
      ptr: start
    });
  }
  do {
    let c = ctx.s.charCodeAt(ctx.p = ++dot);
    if (c !== 32 && c !== 9) {
      if (c === 34 || c === 39) {
        if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2)) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        let part = parseString(ctx);
        dot = ctx.s.indexOf(".", ctx.p);
        let strEnd = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: ctx.s,
            ptr: newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        if (endPtr < ctx.p) {
          endPtr = ctx.s.indexOf(end, ctx.p);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: ctx.s,
              ptr: start
            });
          }
        }
        parsed.push(part);
      } else {
        dot = ctx.s.indexOf(".", ctx.p);
        let part = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  ctx.p = endPtr + 1;
  skipVoid(ctx, true, true);
  return parsed;
}
function parseInlineTable(ctx, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let p = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = {};
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: ctx.s,
          ptr: p
        });
      }
      if (!hasOwn && k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      throw new TomlError("trying to redefine an already defined value", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
    let value = extractValue(ctx, 125, integersAsBigInt);
    seen.add(t[k] = value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished table encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
function parseArray(ctx, integersAsBigInt) {
  let res = [];
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(ctx, 93, integersAsBigInt));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished array encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}

// node_modules/smol-toml/dist/parse.js
function peekTable(key, table2, meta, type) {
  let t = table2;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let ctx = { s: toml, p: 0, d: maxDepth };
  let res = {};
  let meta = {};
  let tmp;
  let tbl = res;
  let m = meta;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      let k = parseKey(ctx, "]");
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p - 1) !== 93) {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: ctx.p - 1
          });
        }
        ctx.p++;
      }
      let p = peekTable(
        k,
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      m = p[2];
      tbl = p[1];
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      p[1][p[0]] = extractValue(ctx, void 0, integersAsBigInt);
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && tmp !== 13) {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr: ctx.p
      });
    }
    skipVoid(ctx);
  }
  return res;
}

// node_modules/smol-toml/dist/stringify.js
var BARE_KEY = /^[a-z0-9-_]+$/i;
function extendedTypeOf(obj) {
  let type = typeof obj;
  if (type === "object") {
    if (Array.isArray(obj))
      return "array";
    if (typeof obj?.getUTCDate === "function" && obj instanceof Date)
      return "date";
    if (globalThis.Temporal && // check for the 'since' property as an early bailout that avoids running all 5 instanceof checks
    typeof obj?.since === "function" && (obj instanceof Temporal.Instant || obj instanceof Temporal.PlainDate || obj instanceof Temporal.PlainDateTime || obj instanceof Temporal.PlainTime || obj instanceof Temporal.ZonedDateTime)) {
      return "temporal";
    }
  }
  return type;
}
function isArrayOfTables(obj) {
  for (let i = 0; i < obj.length; i++) {
    if (extendedTypeOf(obj[i]) !== "object")
      return false;
  }
  return obj.length != 0;
}
function formatString(s) {
  return JSON.stringify(s).replace(/\x7f/g, "\\u007f");
}
function stringifyTemporal(temporal) {
  return temporal.toString({
    calendarName: "never",
    timeZoneName: "never"
  });
}
function stringifyValue(val, type, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  switch (type) {
    // @ts-expect-error -- intentional fallthrough case
    case "number":
      if (isNaN(val))
        return "nan";
      if (val === Infinity)
        return "inf";
      if (val === -Infinity)
        return "-inf";
      if (Number.isInteger(val) && (numberAsFloat || !Number.isSafeInteger(val)))
        return val.toFixed(1);
    case "bigint":
    case "boolean":
      return val.toString();
    case "string":
      return formatString(val);
    case "date":
      if (isNaN(val.getTime()))
        throw new TypeError("cannot serialize invalid date");
      return val.toISOString();
    case "object":
      return stringifyInlineTable(val, depth, numberAsFloat);
    case "array":
      return stringifyArray(val, depth, numberAsFloat);
    case "temporal":
      return stringifyTemporal(val);
  }
}
function stringifyInlineTable(obj, depth, numberAsFloat) {
  let keys = Object.keys(obj);
  if (keys.length === 0)
    return "{}";
  let res = "{ ";
  for (let i = 0; i < keys.length; i++) {
    let k = keys[i];
    if (i)
      res += ", ";
    res += BARE_KEY.test(k) ? k : formatString(k);
    res += " = ";
    res += stringifyValue(obj[k], extendedTypeOf(obj[k]), depth - 1, numberAsFloat);
  }
  return res + " }";
}
function stringifyArray(array, depth, numberAsFloat) {
  if (array.length === 0)
    return "[]";
  let res = "[ ";
  for (let i = 0; i < array.length; i++) {
    if (i)
      res += ", ";
    if (array[i] === null || array[i] === void 0) {
      throw new TypeError("arrays cannot contain null or undefined values");
    }
    res += stringifyValue(array[i], extendedTypeOf(array[i]), depth - 1, numberAsFloat);
  }
  return res + " ]";
}
function stringifyArrayTable(array, key, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  let res = "";
  for (let i = 0; i < array.length; i++) {
    res += `${res && "\n"}[[${key}]]
`;
    res += stringifyTable(0, array[i], key, depth, numberAsFloat);
  }
  return res;
}
function stringifyTable(tableKey, obj, prefix, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  let preamble = "";
  let tables = "";
  let keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    let k = keys[i];
    if (obj[k] !== null && obj[k] !== void 0) {
      let type = extendedTypeOf(obj[k]);
      if (type === "symbol" || type === "function") {
        throw new TypeError(`cannot serialize values of type '${type}'`);
      }
      let key = BARE_KEY.test(k) ? k : formatString(k);
      if (type === "array" && isArrayOfTables(obj[k])) {
        tables += (tables && "\n") + stringifyArrayTable(obj[k], prefix ? `${prefix}.${key}` : key, depth - 1, numberAsFloat);
      } else if (type === "object") {
        let tblKey = prefix ? `${prefix}.${key}` : key;
        tables += (tables && "\n") + stringifyTable(tblKey, obj[k], tblKey, depth - 1, numberAsFloat);
      } else {
        preamble += key;
        preamble += " = ";
        preamble += stringifyValue(obj[k], type, depth, numberAsFloat);
        preamble += "\n";
      }
    }
  }
  if (tableKey && (preamble || !tables))
    preamble = preamble ? `[${tableKey}]
${preamble}` : `[${tableKey}]`;
  return preamble && tables ? `${preamble}
${tables}` : preamble || tables;
}
function stringify(obj, { maxDepth = 1e3, numbersAsFloat = false } = {}) {
  if (extendedTypeOf(obj) !== "object") {
    throw new TypeError("stringify can only be called with an object");
  }
  let str = stringifyTable(0, obj, "", maxDepth, numbersAsFloat);
  if (str[str.length - 1] !== "\n")
    return str + "\n";
  return str;
}

// src/profile.ts
var PROFILE = "vultr";
var PROVIDER = "vultr";
var API_KEY_ENV = "VULTR_INFERENCE_API_KEY";
var MARKER = "# Managed by @vultr/model-provider-codex.";
var HEADER = `${MARKER}
# vultr-codex install sets the provider, catalog and refresh hook here and keeps everything else:
# Codex writes the model you pick, hook trust and project trust into this file too.
`;
var table = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var isRefreshHook = (handler) => / refresh --hook( |$)/.test(String(table(handler).command ?? ""));
function withRefreshHook(groups, command) {
  const list = (Array.isArray(groups) ? groups : []).map(table);
  const ours = { type: "command", command, timeout: 15 };
  let placed = false;
  const kept = list.map((group) => {
    const handlers = (Array.isArray(group.hooks) ? group.hooks : []).flatMap((handler) => {
      if (!isRefreshHook(handler)) return [handler];
      if (!command || placed) return [];
      placed = true;
      return [ours];
    });
    return { ...group, hooks: handlers };
  }).filter((group) => group.hooks.length > 0);
  if (command && !placed) kept.push({ hooks: [ours] });
  return kept;
}
function applyProfile(existing, options) {
  const profile = { ...existing };
  profile.model_provider = PROVIDER;
  if (options.forceModel || typeof profile.model !== "string") profile.model = options.model;
  profile.model_catalog_json = options.catalogPath;
  profile.web_search = "disabled";
  profile.model_providers = {
    ...table(profile.model_providers),
    [PROVIDER]: { name: "Vultr", base_url: options.baseUrl, env_key: API_KEY_ENV, wire_api: "responses" }
  };
  const hooks = table(profile.hooks);
  const sessionStart = withRefreshHook(hooks.SessionStart, options.refreshCommand);
  const { SessionStart: _, ...otherHooks } = hooks;
  profile.hooks = sessionStart.length > 0 ? { ...otherHooks, SessionStart: sessionStart } : otherHooks;
  if (Object.keys(table(profile.hooks)).length === 0) delete profile.hooks;
  if (options.refreshCommand) profile.features = { ...table(profile.features), hooks: true };
  return profile;
}
function parseProfile(text) {
  return parse(text);
}
function renderProfile(profile) {
  return `${HEADER}
${stringify(profile)}
`;
}
function isManaged(text) {
  return text.startsWith(MARKER);
}

// src/cli.ts
var BASE_URL_ENV = "VULTR_INFERENCE_BASE_URL";
var REFRESH_MAX_AGE_MS = 10 * 6e4;
var PACKAGE_FILES = {
  bundle: fileURLToPath(new URL("../dist/vultr-codex.js", import.meta.url)),
  prompt: fileURLToPath(new URL("../prompts/base_instructions.md", import.meta.url))
};
function paths(codexHome) {
  return {
    codexHome,
    profile: join(codexHome, `${PROFILE}.config.toml`),
    catalog: join(codexHome, "vultr", "models.json"),
    cache: join(codexHome, "vultr", "catalog-cache.json"),
    bundle: join(codexHome, "vultr", "dist", "vultr-codex.js"),
    prompt: join(codexHome, "vultr", "prompts", "base_instructions.md")
  };
}
var USAGE = `usage: npx @vultr/model-provider-codex <install|refresh|uninstall> [options]

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
function parseArgs(argv) {
  const options = {
    codexHome: process.env.CODEX_HOME || join(homedir(), ".codex"),
    baseUrl: process.env[BASE_URL_ENV] || DEFAULT_BASE_URL,
    hook: true,
    force: false
  };
  let command;
  let refreshHook = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === void 0) throw new UsageError(`${arg} needs a value`);
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
  if (command === "refresh") options.hook = refreshHook;
  return { command, options };
}
var UsageError = class extends Error {
};
async function writeAtomic(path, text) {
  await mkdir2(dirname2(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile2(tmp, text);
  await rename2(tmp, path);
}
async function refresh(options) {
  const p = paths(options.codexHome);
  const catalog = await loadCatalog({
    baseUrl: options.baseUrl,
    cachePath: p.cache,
    timeoutMs: options.hook ? 5e3 : 15e3,
    ...options.hook ? { maxAgeMs: REFRESH_MAX_AGE_MS } : {}
  });
  const codex = toCodexCatalog(catalog.models);
  if (codex.models.length === 0) {
    throw new Error("the catalog has no model Codex can use");
  }
  await writeAtomic(p.catalog, `${JSON.stringify(codex, null, 2)}
`);
  if (!options.hook) {
    console.log(`${p.catalog}: ${codex.models.length} models (${catalog.source})`);
  }
  return codex;
}
async function installSelf(p) {
  for (const file of ["bundle", "prompt"]) {
    if (resolve(PACKAGE_FILES[file]) === resolve(p[file])) continue;
    await mkdir2(dirname2(p[file]), { recursive: true });
    const tmp = `${p[file]}.${process.pid}.tmp`;
    await copyFile(PACKAGE_FILES[file], tmp);
    await rename2(tmp, p[file]);
  }
}
function refreshCommand(options) {
  const script = paths(options.codexHome).bundle;
  const q = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
  return ["node", q(script), "refresh", "--hook", "--codex-home", q(options.codexHome), "--base-url", q(options.baseUrl)].join(" ");
}
async function install(options) {
  const p = paths(options.codexHome);
  const existing = existsSync(p.profile) ? await readFile2(p.profile, "utf8") : null;
  if (existing !== null && !isManaged(existing) && !options.force) {
    throw new Error(`${p.profile} exists and was not written by vultr-codex; pass --force to take it over`);
  }
  const catalog = await refresh({ ...options, hook: false });
  const slugs = catalog.models.map((model2) => model2.slug);
  if (options.model && !slugs.includes(options.model)) {
    throw new Error(`--model ${options.model} is not in the catalog: ${slugs.join(", ")}`);
  }
  if (options.hook) await installSelf(p);
  const current = existing !== null ? parseProfile(existing) : {};
  const kept = typeof current.model === "string" && slugs.includes(current.model);
  const profile = applyProfile(current, {
    baseUrl: options.baseUrl,
    model: options.model ?? slugs[0],
    forceModel: options.model !== void 0 || !kept,
    catalogPath: p.catalog,
    ...options.hook ? { refreshCommand: refreshCommand(options) } : {}
  });
  await writeAtomic(p.profile, renderProfile(profile));
  const model = String(profile.model);
  console.log(`${p.profile}: profile "${PROFILE}", model ${model}`);
  console.log(`
export ${API_KEY_ENV}=...
codex -p ${PROFILE}`);
  if (options.hook) {
    console.log(
      `
Codex runs a new hook only after you trust it: start \`codex -p vultr\` once and approve the SessionStart hook.
Until then the catalog changes only when you run: node ${p.bundle} refresh`
    );
  }
}
async function uninstall(options) {
  const p = paths(options.codexHome);
  if (existsSync(p.profile) && !isManaged(await readFile2(p.profile, "utf8"))) {
    throw new Error(`${p.profile} was not written by vultr-codex; leaving it`);
  }
  await rm(p.profile, { force: true });
  await rm(dirname2(p.catalog), { recursive: true, force: true });
  console.log(`removed ${p.profile} and ${dirname2(p.catalog)}`);
}
async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`vultr-codex: ${error.message}

${USAGE}`);
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
    if (command === "refresh" && options.hook) return 0;
    console.error(`vultr-codex: ${error.message}`);
    return 1;
  }
}

// bin/vultr-codex.ts
process.exitCode = await main(process.argv.slice(2));
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/util.js:
smol-toml/dist/primitive.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
