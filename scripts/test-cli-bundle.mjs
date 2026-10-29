import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const bundlePath = new URL("../dist-server/index.cjs", import.meta.url);
const files = await readdir(new URL("../dist-server/", import.meta.url));
assert.deepEqual(files, ["index.cjs"], "server build should stay in one bundle");

function run(args) {
  const result = spawnSync(process.execPath, [bundlePath.pathname, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined, `${args.join(" ")} should exit without timeout`);
  return result;
}

const version = run(["--version"]);
assert.equal(version.status, 0);
assert.equal(version.stdout, `mavmeta ${packageJson.version}\n`);
assert.equal(version.stderr, "");

const help = run(["--help"]);
assert.equal(help.status, 0);
assert.match(help.stdout, /Usage: mavmeta/);
assert.match(help.stdout, /MAVMETA_PORT/);
assert.equal(help.stderr, "");

const unknown = run(["--bogus"]);
assert.equal(unknown.status, 2);
assert.equal(unknown.stdout, "");
assert.match(unknown.stderr, /Unknown option '--bogus'/);
assert.match(unknown.stderr, /Run mavmeta --help/);

console.log("CLI bundle smoke passed");
