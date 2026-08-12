import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extension = resolve(root, "apps/vscode-extension");
const artifacts = resolve(root, "artifacts");
const target = resolve(artifacts, "interlis-language-tools.vsix");
const requestedVersion = process.env.VSIX_VERSION?.trim() || undefined;
const binary = resolve(
  root,
  "node_modules/.bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce",
);

await mkdir(artifacts, { recursive: true });
const packageArguments = ["package"];
if (requestedVersion)
  packageArguments.push(requestedVersion, "--no-update-package-json");
if (process.env.VSIX_PRE_RELEASE !== "0")
  packageArguments.push("--pre-release");
packageArguments.push("--no-dependencies", "--out", target);
const result = spawnSync(binary, packageArguments, {
  cwd: extension,
  encoding: "utf8",
  stdio: "pipe",
});
if (result.status !== 0)
  throw new Error(`VSIX packaging failed\n${result.stdout}\n${result.stderr}`);

const sourceManifestPath = resolve(extension, "package.json");
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
assert.equal(sourceManifest.version, "0.1.1");
const expectedVersion = requestedVersion ?? sourceManifest.version;

const listing = spawnSync("unzip", ["-Z1", target], {
  encoding: "utf8",
  stdio: "pipe",
});
if (listing.status !== 0) throw new Error(listing.stderr);
const files = new Set(listing.stdout.trim().split("\n"));
for (const file of [
  "extension/package.json",
  "extension/LICENSE.md",
  "extension/dist/extension-node.cjs",
  "extension/dist/extension-browser.js",
  "extension/dist/server-node.js",
  "extension/dist/server-browser.js",
  "extension/dist/compiler-worker-node.js",
  "extension/dist/compiler-worker-browser.js",
  "extension/dist/ilic.wasm",
  "extension/dist/libavoid.wasm",
  "extension/dist/libavoid-LICENSE.txt",
  "extension/dist/terminateProcess.sh",
  "extension/images/ililogo.png",
])
  assert.ok(files.has(file), `VSIX is missing ${file}`);

const packagedManifestResult = spawnSync(
  "unzip",
  ["-p", target, "extension/package.json"],
  {
    encoding: "utf8",
    stdio: "pipe",
  },
);
if (packagedManifestResult.status !== 0)
  throw new Error(packagedManifestResult.stderr);
const packagedManifest = JSON.parse(packagedManifestResult.stdout);
assert.equal(packagedManifest.version, expectedVersion);

const vsixManifest = spawnSync(
  "unzip",
  ["-p", target, "extension.vsixmanifest"],
  {
    encoding: "utf8",
    stdio: "pipe",
  },
);
if (vsixManifest.status !== 0) throw new Error(vsixManifest.stderr);
assert.ok(
  vsixManifest.stdout.includes(`Version="${expectedVersion}"`),
  `VSIX manifest does not contain version ${expectedVersion}`,
);
if (process.env.VSIX_PRE_RELEASE !== "0")
  assert.match(
    vsixManifest.stdout,
    /Microsoft\.VisualStudio\.Code\.PreRelease" Value="true"/u,
  );

assert.equal(
  `${sourceManifest.publisher}.${sourceManifest.name}`,
  "edigonzales.interlis-language-tools",
);
const unchangedSourceManifest = JSON.parse(
  await readFile(sourceManifestPath, "utf8"),
);
assert.deepEqual(unchangedSourceManifest, sourceManifest);
process.stdout.write(`${target}\n`);
