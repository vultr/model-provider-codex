import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const script = (JSON.parse(readFileSync(`${root}package.json`, "utf8")) as { scripts: { build: string } }).scripts.build;

// npm does not type-strip under node_modules and a git dependency's prepare may not run,
// so the CLI ships as a committed bundle. It must match the source and need nothing installed.
test("dist/vultr-codex.js is the current build", () => {
  const args = script
    .replace(/^esbuild /, "")
    .replace(/ --outfile=\S+/, "")
    .split(" ");
  const built = execFileSync(`${root}node_modules/.bin/esbuild`, args, { cwd: root, encoding: "utf8" });
  assert.equal(readFileSync(`${root}dist/vultr-codex.js`, "utf8"), built, "run npm run build and commit dist/");
});

test("the bundle imports only node builtins", () => {
  const imports = [...readFileSync(`${root}dist/vultr-codex.js`, "utf8").matchAll(/from "([^".][^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(
    imports.filter((name) => !name?.startsWith("node:")),
    [],
  );
});
