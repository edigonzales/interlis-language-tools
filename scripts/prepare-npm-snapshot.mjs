#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertStableDependencies,
  loadDependencyLock,
  snapshotVersion,
} from "./release-metadata.mjs";

const LANGUAGE_PACKAGES = [
  { id: "language-service", name: "@ilic/language-service" },
  { id: "monaco-adapter", name: "@ilic/monaco-adapter" },
  { id: "diagram", name: "@ilic/diagram" },
  { id: "docx", name: "@ilic/docx" },
  { id: "language-server", name: "@ilic/language-server" },
];
const LANGUAGE_NAMES = new Set(LANGUAGE_PACKAGES.map(({ name }) => name));
const FULL_SHA = /^[0-9a-f]{40}$/u;

function isSameOrParent(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function validateOutputRoot(projectRoot, outputRoot) {
  if (outputRoot === resolve(outputRoot, sep)) {
    throw new Error(
      "Refusing to use a filesystem root as npm artifact directory",
    );
  }
  if (isSameOrParent(outputRoot, projectRoot)) {
    throw new Error("Refusing to place npm artifacts above the project");
  }
  if (
    isSameOrParent(projectRoot, outputRoot) &&
    relative(projectRoot, outputRoot).split(sep)[0] !== "artifacts"
  ) {
    throw new Error("npm artifacts inside the project must use artifacts/");
  }
}

function validatePublishPath(path, packageName) {
  if (
    typeof path !== "string" ||
    !path ||
    isAbsolute(path) ||
    path.includes("*") ||
    path.includes("?") ||
    normalize(path).split(sep).includes("..")
  ) {
    throw new Error(
      `${packageName} contains unsupported publish path ${String(path)}`,
    );
  }
}

async function copyPublishPath(source, destination, packageName) {
  let entry;
  try {
    entry = await stat(source);
  } catch {
    throw new Error(`Missing ${packageName} publish path ${source}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: entry.isDirectory() });
}

function pack(directory, outputRoot, alias) {
  const result = spawnSync(
    "npm",
    ["pack", directory, "--json", "--pack-destination", outputRoot],
    { encoding: "utf8", stdio: "pipe" },
  );
  if (result.status !== 0) {
    throw new Error(
      `npm pack failed for ${directory}\n${result.stdout}\n${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  const packed = Array.isArray(parsed) ? parsed[0] : parsed;
  return { generated: resolve(outputRoot, packed.filename), alias };
}

export function rewriteLanguageManifest(
  manifest,
  { artifactVersion, sourceSha, dependencies },
) {
  if (!FULL_SHA.test(sourceSha ?? "")) {
    throw new Error("gitHead must be a full 40-character lowercase SHA");
  }
  const rewrittenDependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([name, version]) => {
      if (LANGUAGE_NAMES.has(name)) return [name, artifactVersion];
      if (dependencies[name]) return [name, dependencies[name].version];
      return [name, version];
    }),
  );
  return {
    ...manifest,
    version: artifactVersion,
    gitHead: sourceSha,
    files: [...new Set([...(manifest.files ?? []), "interlis-release.json"])],
    dependencies: rewrittenDependencies,
  };
}

export async function prepareNpmPackages({
  projectRoot = resolve(import.meta.dirname, ".."),
  outputRoot = resolve(projectRoot, "artifacts/npm"),
  sourceSha,
  channel = "snapshot",
  releaseManifestPath,
} = {}) {
  projectRoot = resolve(projectRoot);
  outputRoot = resolve(outputRoot);
  if (!FULL_SHA.test(sourceSha ?? "")) {
    throw new Error("Packaging requires a full 40-character --source-sha");
  }
  if (!new Set(["snapshot", "stable"]).has(channel)) {
    throw new Error("Packaging channel must be snapshot or stable");
  }
  if (!releaseManifestPath)
    throw new Error("Packaging requires --release-manifest");
  validateOutputRoot(projectRoot, outputRoot);
  const lock = await loadDependencyLock(projectRoot);
  if (channel === "stable") assertStableDependencies(lock);
  const artifactVersion =
    channel === "snapshot"
      ? snapshotVersion(lock.artifactBaseVersion, sourceSha)
      : lock.artifactBaseVersion;
  const releaseManifest = JSON.parse(
    await readFile(resolve(releaseManifestPath), "utf8"),
  );
  if (
    releaseManifest.project !== "interlis-language-tools" ||
    releaseManifest.artifactVersion !== artifactVersion ||
    releaseManifest.sourceSha !== sourceSha ||
    releaseManifest.channel !== channel ||
    JSON.stringify(releaseManifest.dependencies) !==
      JSON.stringify(lock.dependencies)
  ) {
    throw new Error(
      "Release manifest does not match source SHA, channel, version, and dependency lock",
    );
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const packageResults = {};
  for (const spec of LANGUAGE_PACKAGES) {
    const source = resolve(projectRoot, `packages/${spec.id}`);
    const manifest = JSON.parse(
      await readFile(resolve(source, "package.json"), "utf8"),
    );
    if (
      manifest.name !== spec.name ||
      manifest.version !== lock.artifactBaseVersion
    ) {
      throw new Error(
        `${spec.name} source manifest differs from the committed lock`,
      );
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error(`${spec.name} must declare a non-empty files list`);
    }
    const destination = resolve(outputRoot, `staging/${spec.id}`);
    await mkdir(destination, { recursive: true });
    for (const path of manifest.files) {
      validatePublishPath(path, spec.name);
      await copyPublishPath(
        resolve(source, path),
        resolve(destination, path),
        spec.name,
      );
    }
    await cp(resolve(projectRoot, "LICENSE"), resolve(destination, "LICENSE"));
    await writeFile(
      resolve(destination, "interlis-release.json"),
      `${JSON.stringify(releaseManifest, null, 2)}\n`,
    );
    const stagedManifest = rewriteLanguageManifest(manifest, {
      artifactVersion,
      sourceSha,
      dependencies: lock.dependencies,
    });
    await writeFile(
      resolve(destination, "package.json"),
      `${JSON.stringify(stagedManifest, null, 2)}\n`,
    );
    const alias = resolve(outputRoot, `ilic-${spec.id}.tgz`);
    const packed = pack(destination, outputRoot, alias);
    await rename(packed.generated, alias);
    packageResults[spec.name] = {
      version: artifactVersion,
      tarball: alias,
      stagingDirectory: destination,
    };
  }

  const packageManifest = {
    schemaVersion: 1,
    artifactVersion,
    channel,
    sourceSha,
    gitHead: sourceSha,
    dependencies: lock.dependencies,
    packages: Object.fromEntries(
      Object.entries(packageResults).map(([name, value]) => [
        name,
        { version: value.version, tarball: basename(value.tarball) },
      ]),
    ),
  };
  await writeFile(
    resolve(outputRoot, "package-manifest.json"),
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  return { ...packageManifest, outputRoot, packages: packageResults };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    if (argument === "--project-root") options.projectRoot = resolve(value);
    else if (argument === "--output") options.outputRoot = resolve(value);
    else if (argument === "--source-sha") options.sourceSha = value;
    else if (argument === "--channel") options.channel = value;
    else if (argument === "--release-manifest")
      options.releaseManifestPath = resolve(value);
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

async function main() {
  const result = await prepareNpmPackages(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
