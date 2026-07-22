import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareNpmSnapshot } from "./prepare-npm-snapshot.mjs";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "artifacts/npm");
const consumer = resolve(artifacts, "consumer");
const timestamp = process.env.SNAPSHOT_TIMESTAMP || "20260101000000";
const buildId = process.env.SNAPSHOT_BUILD_ID || undefined;
const compilerVersion = process.env.COMPILER_VERSION || undefined;
const expectedLanguageVersion = process.env.LANGUAGE_TOOLS_VERSION || undefined;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function manifestFromTarball(path) {
  return JSON.parse(run("tar", ["-xOf", path, "package/package.json"]));
}

const result = await prepareNpmSnapshot({
  projectRoot: root,
  outputRoot: artifacts,
  timestamp,
  ...(buildId ? { buildId } : {}),
  ...(compilerVersion ? { compilerVersion } : {}),
});
if (expectedLanguageVersion) {
  assert.equal(result.snapshotVersion, expectedLanguageVersion);
}
await mkdir(consumer, { recursive: true });

const expectedVersions = new Map([
  ["@ilic/tools", result.compilerVersion],
  ["@ilic/compiler-wasm", result.compilerVersion],
  ["@ilic/language-service", result.snapshotVersion],
  ["@ilic/monaco-adapter", result.snapshotVersion],
  ["@ilic/diagram", result.snapshotVersion],
  ["@ilic/docx", result.snapshotVersion],
  ["@ilic/language-server", result.snapshotVersion],
]);
const expectedInternalDependencies = new Map([
  ["@ilic/language-service", { "@ilic/compiler-wasm": result.compilerVersion }],
  [
    "@ilic/monaco-adapter",
    { "@ilic/language-service": result.snapshotVersion },
  ],
  ["@ilic/diagram", { "@ilic/language-service": result.snapshotVersion }],
  ["@ilic/docx", { "@ilic/language-service": result.snapshotVersion }],
  [
    "@ilic/language-server",
    {
      "@ilic/tools": result.compilerVersion,
      "@ilic/docx": result.snapshotVersion,
      "@ilic/language-service": result.snapshotVersion,
    },
  ],
]);

const tarballs = [];
for (const [name, expectedVersion] of expectedVersions) {
  const packageResult = result.packages[name];
  assert.ok(packageResult, `missing staged package ${name}`);
  tarballs.push(packageResult.tarball);
  const manifest = manifestFromTarball(packageResult.tarball);
  assert.equal(manifest.name, name);
  assert.equal(manifest.version, expectedVersion);
  assert.equal(manifest.license, "MIT");
  assert.equal(
    manifest.repository?.url,
    name === "@ilic/tools" || name === "@ilic/compiler-wasm"
      ? "https://github.com/edigonzales/ilic-fork.git"
      : "https://github.com/edigonzales/interlis-language-tools.git",
  );
  const entries = run("tar", ["-tf", packageResult.tarball]);
  assert.match(entries, /package\/LICENSE\n/);

  for (const [dependency, version] of Object.entries(
    expectedInternalDependencies.get(name) ?? {},
  )) {
    assert.equal(
      manifest.dependencies?.[dependency],
      version,
      `${name} -> ${dependency}`,
    );
  }
  for (const [dependency, version] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    if (expectedVersions.has(dependency)) {
      assert.match(
        version,
        /^\d+\.\d+\.\d+-SNAPSHOT\.\d{14}(?:\.\d+)?$/,
        `${name} contains moving internal dependency ${dependency}@${version}`,
      );
    }
  }
}

const snapshotManifest = JSON.parse(
  await readFile(resolve(artifacts, "snapshot-manifest.json"), "utf8"),
);
assert.equal(snapshotManifest.snapshotVersion, result.snapshotVersion);
assert.equal(snapshotManifest.compilerVersion, result.compilerVersion);
assert.equal(snapshotManifest.buildId, result.buildId ?? null);
assert.equal(snapshotManifest.compilerTimestamp, result.compilerTimestamp);
assert.equal(snapshotManifest.compilerBuildId, result.compilerBuildId ?? null);

await writeFile(
  resolve(consumer, "package.json"),
  `${JSON.stringify(
    {
      name: "interlis-language-tools-pack-smoke",
      private: true,
      type: "module",
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  resolve(consumer, "smoke.mjs"),
  `import assert from "node:assert/strict";
import { createCompiler } from "@ilic/compiler-wasm";
import { BrowserCache } from "@ilic/tools/browser";
import { LanguageService, MemoryWorkspaceFileSystem, createWasmCompilerBackend } from "@ilic/language-service";
import { InterlisProtocol } from "@ilic/language-server";
import { MonacoLanguageAdapter } from "@ilic/monaco-adapter";
import { DiagramController } from "@ilic/diagram";
import { siblingDocxUri } from "@ilic/docx";

assert.equal(typeof BrowserCache, "function");
assert.equal(typeof LanguageService, "function");
assert.equal(typeof MemoryWorkspaceFileSystem, "function");
assert.equal(typeof MonacoLanguageAdapter, "function");
assert.equal(typeof DiagramController, "function");
assert.equal(InterlisProtocol.compile, "interlis/compile");
assert.equal(siblingDocxUri("memory:///Model.ili"), "memory:///Model.docx");

const compiler = await createCompiler();
const session = compiler.createSession();
session.putSource("memory:///Pack.ili", 'INTERLIS 2.4;\\nMODEL Pack AT "https://example.invalid" VERSION "1" =\\nEND Pack.\\n', 1);
assert.equal(session.parse("memory:///Pack.ili").documentVersion, 1);
session.dispose();

const backend = await createWasmCompilerBackend();
backend.dispose();
`,
);

run(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    ...tarballs,
  ],
  consumer,
);
run(process.execPath, ["smoke.mjs"], consumer);

process.stdout.write(
  `Verified timestamped npm consumers: ${[...expectedVersions]
    .map(([name, version]) => `${name}@${version}`)
    .join(", ")}\n`,
);
