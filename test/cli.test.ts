import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { main, paths } from "../src/cli.ts";
import { parseProfile } from "../src/profile.ts";
import { document } from "./fixture.ts";

let server: Server;
let baseUrl: string;
let catalog: unknown[] = [];

before(async () => {
  server = createServer((req, res) => {
    if (req.url !== "/v1/models" || catalog.length === 0) {
      res.writeHead(503).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: catalog }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

after(() => server.close());

const run = (codexHome: string, ...args: string[]) => main([...args, "--codex-home", codexHome, "--base-url", baseUrl]);
const slugs = (codexHome: string) =>
  (JSON.parse(readFileSync(paths(codexHome).catalog, "utf8")) as { models: { slug: string }[] }).models.map((m) => m.slug);

test("install writes the catalog and a profile, and keeps what Codex added on reinstall", async () => {
  catalog = [document({ id: "a" }), document({ id: "b" })];
  const home = mkdtempSync(join(tmpdir(), "vultr-codex-"));
  assert.equal(await run(home, "install"), 0);
  assert.deepEqual(slugs(home), ["a", "b"]);
  const profile = () => parseProfile(readFileSync(paths(home).profile, "utf8"));
  assert.equal(profile().model, "a");
  assert.match(readFileSync(paths(home).profile, "utf8"), /refresh --hook --codex-home/);

  appendFileSync(paths(home).profile, '\n[projects."/src/app"]\ntrust_level = "trusted"\n');
  assert.equal(await run(home, "install", "--model", "b", "--no-hook"), 0);
  assert.equal(profile().model, "b");
  assert.equal(profile().hooks, undefined);
  assert.deepEqual(profile().projects, { "/src/app": { trust_level: "trusted" } });
  assert.equal(await run(home, "install"), 0);
  assert.equal(profile().model, "b");

  // A model that left the catalog is replaced.
  catalog = [document({ id: "a" })];
  assert.equal(await run(home, "install"), 0);
  assert.equal(profile().model, "a");

  assert.equal(await run(home, "install", "--model", "missing"), 1);
});

test("the hook runs a copy of the tool kept in CODEX_HOME", async () => {
  catalog = [document({ id: "a" })];
  const home = mkdtempSync(join(tmpdir(), "vultr-codex-"));
  assert.equal(await run(home, "install"), 0);
  const p = paths(home);
  const hook = (parseProfile(readFileSync(p.profile, "utf8")).hooks as { SessionStart: { hooks: { command: string }[] }[] })
    .SessionStart[0]!.hooks[0]!.command;
  assert.ok(hook.startsWith(`node '${p.bundle}' refresh --hook`), hook);

  // The copy stands alone: the catalog comes back with nothing but the copy and node.
  // Async, so this process can keep serving the catalog.
  rmSync(p.catalog);
  rmSync(p.cache);
  const { stdout } = await promisify(execFile)("sh", ["-c", hook]);
  assert.equal(stdout, "");
  assert.deepEqual(slugs(home), ["a"]);
});

test("install leaves a profile it did not write", async () => {
  catalog = [document()];
  const home = mkdtempSync(join(tmpdir(), "vultr-codex-"));
  writeFileSync(paths(home).profile, 'model = "mine"\n');
  assert.equal(await run(home, "install"), 1);
  assert.equal(readFileSync(paths(home).profile, "utf8"), 'model = "mine"\n');
  assert.equal(await run(home, "uninstall"), 1);
  assert.equal(await run(home, "install", "--force"), 0);
});

test("a failed refresh keeps the last catalog, and the hook never fails", async () => {
  catalog = [document({ id: "a" })];
  const home = mkdtempSync(join(tmpdir(), "vultr-codex-"));
  assert.equal(await run(home, "refresh"), 0);

  // Nothing usable: the file Codex reads is not replaced.
  catalog = [document({ id: "unready", is_ready: false })];
  assert.equal(await run(home, "refresh"), 1);
  assert.equal(await run(home, "refresh", "--hook"), 0);
  assert.deepEqual(slugs(home), ["a"]);

  // Network down with no cache.
  catalog = [];
  const empty = mkdtempSync(join(tmpdir(), "vultr-codex-"));
  assert.equal(await run(empty, "refresh", "--hook"), 0);
  assert.equal(existsSync(paths(empty).catalog), false);
});

test("uninstall removes what install wrote", async () => {
  catalog = [document()];
  const home = mkdtempSync(join(tmpdir(), "vultr-codex-"));
  assert.equal(await run(home, "install"), 0);
  assert.equal(await run(home, "uninstall"), 0);
  assert.equal(existsSync(paths(home).profile), false);
  assert.equal(existsSync(paths(home).catalog), false);
});
