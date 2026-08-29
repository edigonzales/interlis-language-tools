#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LANGUAGE_PACKAGE_DIRECTORIES = [
  "packages/language-service",
  "packages/monaco-adapter",
  "packages/diagram",
  "packages/docx",
  "packages/language-server",
];
const VERSIONED_MANIFESTS = [
  "package.json",
  ...LANGUAGE_PACKAGE_DIRECTORIES.map(
    (directory) => `${directory}/package.json`,
  ),
  "apps/vscode-extension/package.json",
];
const COMPILER_PACKAGES = [
  "@ilic/repository-core",
  "@ilic/tools",
  "@ilic/compiler-wasm",
];

const SEMVER = /^\d+\.\d+\.\d+$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const PUBLISHED_VERSION =
  /^\d+\.\d+\.\d+(?:-(?:SNAPSHOT\.\d{14}(?:\.\d+)?|snapshot\.g[0-9a-f]{12}))?$/u;

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requireFullSha(value, name = "source SHA") {
  if (!FULL_SHA.test(value ?? "")) {
    throw new Error(`${name} must be a full 40-character lowercase Git SHA`);
  }
  return value;
}

export function snapshotVersion(baseVersion, sourceSha) {
  if (!SEMVER.test(baseVersion ?? "")) {
    throw new Error("Snapshot base version must be X.Y.Z");
  }
  return `${baseVersion}-snapshot.g${requireFullSha(sourceSha).slice(0, 12)}`;
}

export async function loadDependencyLock(projectRoot) {
  const path = resolve(projectRoot, "release/dependencies.lock.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  if (lock.schemaVersion !== 1 || lock.project !== "interlis-language-tools") {
    throw new Error("Unsupported language-tools dependency lock");
  }
  if (!SEMVER.test(lock.artifactBaseVersion ?? "")) {
    throw new Error("artifactBaseVersion must be X.Y.Z");
  }
  const identities = new Set();
  for (const name of COMPILER_PACKAGES) {
    const dependency = lock.dependencies?.[name];
    if (!dependency || !PUBLISHED_VERSION.test(dependency.version ?? "")) {
      throw new Error(`${name} must have an exact supported published version`);
    }
    requireFullSha(dependency.sourceSha, `${name} source SHA`);
    identities.add(`${dependency.version}@${dependency.sourceSha}`);
  }
  if (identities.size !== 1) {
    throw new Error(
      "The three coordinated compiler packages must use one version and SHA",
    );
  }
  return lock;
}

function compilerBaseVersion(lock) {
  const version = lock.dependencies["@ilic/compiler-wasm"].version;
  const match = version.match(/^(\d+\.\d+\.\d+)/u);
  if (!match) throw new Error(`Cannot derive compiler base from ${version}`);
  return match[1];
}

async function renderedManifests(projectRoot, lock) {
  const rendered = new Map();
  for (const relative of VERSIONED_MANIFESTS) {
    const manifest = JSON.parse(
      await readFile(resolve(projectRoot, relative), "utf8"),
    );
    manifest.version = lock.artifactBaseVersion;
    if (relative === "packages/language-service/package.json") {
      manifest.dependencies["@ilic/compiler-wasm"] = compilerBaseVersion(lock);
    }
    if (relative === "packages/language-server/package.json") {
      manifest.dependencies["@ilic/tools"] = compilerBaseVersion(lock);
    }
    rendered.set(relative, jsonText(manifest));
  }
  return rendered;
}

export async function syncDependencyFiles(projectRoot, checkOnly = false) {
  const lock = await loadDependencyLock(projectRoot);
  const stale = [];
  for (const [relative, expected] of await renderedManifests(
    projectRoot,
    lock,
  )) {
    const path = resolve(projectRoot, relative);
    const actual = await readFile(path, "utf8");
    if (actual !== expected) {
      stale.push(relative);
      if (!checkOnly) await writeFile(path, expected);
    }
  }
  if (checkOnly && stale.length > 0) {
    throw new Error(
      `Generated dependency files are stale: ${stale.join(", ")}`,
    );
  }
  return lock;
}

export function assertStableDependencies(lock) {
  for (const name of COMPILER_PACKAGES) {
    const version = lock.dependencies[name].version;
    if (!SEMVER.test(version)) {
      throw new Error(
        `Stable language-tools releases require stable ${name}; found ${version}`,
      );
    }
  }
}

export async function createReleaseManifest({
  projectRoot,
  sourceSha,
  channel = "snapshot",
  runId,
  builtAt,
  toolchain,
}) {
  const lock = await loadDependencyLock(projectRoot);
  requireFullSha(sourceSha);
  if (!new Set(["snapshot", "stable"]).has(channel)) {
    throw new Error("Release channel must be snapshot or stable");
  }
  if (channel === "stable") assertStableDependencies(lock);
  if (builtAt && Number.isNaN(Date.parse(builtAt))) {
    throw new Error("built-at must be an ISO-8601 date");
  }
  return {
    schemaVersion: 1,
    project: "interlis-language-tools",
    artifactVersion:
      channel === "snapshot"
        ? snapshotVersion(lock.artifactBaseVersion, sourceSha)
        : lock.artifactBaseVersion,
    channel,
    sourceSha,
    gitHead: sourceSha,
    dependencies: lock.dependencies,
    build: {
      githubRunId: runId || null,
      builtAt: builtAt || null,
      toolchain: toolchain || null,
    },
  };
}

async function updateCompiler(projectRoot, version, sourceSha) {
  if (!PUBLISHED_VERSION.test(version ?? "")) {
    throw new Error("Compiler version must be exact and published");
  }
  requireFullSha(sourceSha, "compiler source SHA");
  const lock = await loadDependencyLock(projectRoot);
  for (const name of COMPILER_PACKAGES) {
    lock.dependencies[name] = { version, sourceSha };
  }
  await writeFile(
    resolve(projectRoot, "release/dependencies.lock.json"),
    jsonText(lock),
  );
  await syncDependencyFiles(projectRoot, false);
}

function parseArguments(argv) {
  const options = { projectRoot: resolve(import.meta.dirname, "..") };
  const command = argv.shift();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value)
      throw new Error(`${flag} requires a value`);
    options[
      flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
    ] = value;
  }
  options.projectRoot = resolve(options.projectRoot);
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "check" || command === "sync") {
    await syncDependencyFiles(options.projectRoot, command === "check");
    process.stdout.write(
      `dependency lock is ${command === "check" ? "consistent" : "synchronized"}\n`,
    );
    return;
  }
  if (command === "update-compiler") {
    await updateCompiler(
      options.projectRoot,
      options.version,
      options.sourceSha,
    );
    return;
  }
  if (command === "manifest") {
    if (!options.output) throw new Error("manifest requires --output");
    const manifest = await createReleaseManifest({
      projectRoot: options.projectRoot,
      sourceSha: options.sourceSha,
      channel: options.channel,
      runId: options.runId,
      builtAt: options.builtAt,
      toolchain: options.toolchain,
    });
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, jsonText(manifest));
    return;
  }
  if (command === "export-github-output") {
    if (!options.output)
      throw new Error("export-github-output requires --output");
    const lock = await loadDependencyLock(options.projectRoot);
    const compiler = lock.dependencies["@ilic/compiler-wasm"];
    await appendFile(
      resolve(options.output),
      [
        `artifact_base_version=${lock.artifactBaseVersion}`,
        `compiler_version=${compiler.version}`,
        `compiler_sha=${compiler.sourceSha}`,
        "",
      ].join("\n"),
    );
    return;
  }
  throw new Error(
    "Expected check, sync, manifest, update-compiler, or export-github-output",
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
