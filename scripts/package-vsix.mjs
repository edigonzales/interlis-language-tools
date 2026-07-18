import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extension = resolve(root, "apps/vscode-extension");
const artifacts = resolve(root, "artifacts");
const target = resolve(artifacts, "interlis-language-tools.vsix");
const binary = resolve(
  root,
  "node_modules/.bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce",
);

await mkdir(artifacts, { recursive: true });
const result = spawnSync(
  binary,
  ["package", "--no-dependencies", "--out", target],
  { cwd: extension, encoding: "utf8", stdio: "pipe" },
);
if (result.status !== 0)
  throw new Error(`VSIX packaging failed\n${result.stdout}\n${result.stderr}`);

const listing = spawnSync("unzip", ["-Z1", target], {
  encoding: "utf8",
  stdio: "pipe",
});
if (listing.status !== 0) throw new Error(listing.stderr);
const files = new Set(listing.stdout.trim().split("\n"));
for (const file of [
  "extension/package.json",
  "extension/LICENSE.md",
  "extension/dist/extension-node.js",
  "extension/dist/extension-browser.js",
  "extension/dist/server-node.js",
  "extension/dist/server-browser.js",
  "extension/dist/ilic.wasm",
  "extension/images/ililogo.png",
])
  assert.ok(files.has(file), `VSIX is missing ${file}`);

const manifest = JSON.parse(
  await readFile(resolve(extension, "package.json"), "utf8"),
);
assert.equal(
  `${manifest.publisher}.${manifest.name}`,
  "edigonzales.interlis-language-tools",
);
process.stdout.write(`${target}\n`);
