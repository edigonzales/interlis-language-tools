import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createReleaseManifest } from "./release-metadata.mjs";
import { prepareNpmPackages } from "./prepare-npm-snapshot.mjs";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "artifacts/npm");
const releaseManifestPath = resolve(root, "artifacts/interlis-release.json");
const consumer = resolve(artifacts, "consumer");
const sourceSha =
  process.env.SOURCE_SHA || run("git", ["rev-parse", "HEAD"]).trim();
const channel = process.env.RELEASE_CHANNEL || "snapshot";

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
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

function tarballJson(tarball, path) {
  return JSON.parse(run("tar", ["-xOf", tarball, `package/${path}`]));
}

const releaseManifest = await createReleaseManifest({
  projectRoot: root,
  sourceSha,
  channel,
  runId: process.env.RELEASE_RUN_ID,
  builtAt: process.env.RELEASE_BUILT_AT,
  toolchain: `node-${process.versions.node}`,
});
await mkdir(resolve(root, "artifacts"), { recursive: true });
await writeFile(
  releaseManifestPath,
  `${JSON.stringify(releaseManifest, null, 2)}\n`,
);
const result = await prepareNpmPackages({
  projectRoot: root,
  outputRoot: artifacts,
  sourceSha,
  channel,
  releaseManifestPath,
});

assert.equal(result.artifactVersion, releaseManifest.artifactVersion);
assert.equal(result.sourceSha, sourceSha);
assert.equal(Object.keys(result.packages).length, 5);
const tarballs = [];
for (const [name, packageResult] of Object.entries(result.packages)) {
  tarballs.push(packageResult.tarball);
  const manifest = tarballJson(packageResult.tarball, "package.json");
  assert.equal(manifest.name, name);
  assert.equal(manifest.version, result.artifactVersion);
  assert.equal(manifest.gitHead, sourceSha);
  assert.ok(manifest.files.includes("interlis-release.json"));
  assert.deepEqual(
    tarballJson(packageResult.tarball, "interlis-release.json"),
    releaseManifest,
  );
  for (const [dependency, version] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    if (result.packages[dependency])
      assert.equal(version, result.artifactVersion);
    if (result.dependencies[dependency]) {
      assert.equal(version, result.dependencies[dependency].version);
    }
    if (dependency.startsWith("@ilic/")) {
      assert.ok(!/^(?:workspace:|file:|\^|~|snapshot$|latest$)/u.test(version));
    }
  }
}

await mkdir(consumer, { recursive: true });
await writeFile(
  resolve(consumer, "package.json"),
  `${JSON.stringify({ name: "language-tools-pack-smoke", private: true, type: "module" }, null, 2)}\n`,
);
await writeFile(
  resolve(consumer, "smoke.mjs"),
  `import assert from "node:assert/strict";
import { LanguageService, MemoryWorkspaceFileSystem, createWasmCompilerBackend } from "@ilic/language-service";
import { InterlisProtocol } from "@ilic/language-server";
import { MonacoLanguageAdapter } from "@ilic/monaco-adapter";
import { DiagramController } from "@ilic/diagram";
import { siblingDocxUri } from "@ilic/docx";

assert.equal(typeof LanguageService, "function");
assert.equal(typeof MemoryWorkspaceFileSystem, "function");
assert.equal(typeof MonacoLanguageAdapter, "function");
assert.equal(typeof DiagramController, "function");
assert.equal(InterlisProtocol.compile, "interlis/compile");
assert.equal(siblingDocxUri("memory:///Model.ili"), "memory:///Model.docx");
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
  `Verified five ${channel} packages at ${result.artifactVersion} from ${sourceSha}\n`,
);
