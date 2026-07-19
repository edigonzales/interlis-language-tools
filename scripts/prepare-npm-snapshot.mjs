#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  appendFile,
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

const BASE_VERSION = "0.1.0";
const COMPILER_BASE_VERSION = "0.9.9";
const LANGUAGE_PACKAGES = [
  { id: "language-service", name: "@ilic/language-service" },
  { id: "monaco-adapter", name: "@ilic/monaco-adapter" },
  { id: "diagram", name: "@ilic/diagram" },
  { id: "docx", name: "@ilic/docx" },
  { id: "language-server", name: "@ilic/language-server" },
];
const COMPILER_PACKAGES = [
  { id: "tools", name: "@ilic/tools", compilerId: "tools" },
  {
    id: "compiler-wasm",
    name: "@ilic/compiler-wasm",
    compilerId: "compiler_wasm",
  },
];
const INTERNAL_NAMES = new Set(LANGUAGE_PACKAGES.map(({ name }) => name));

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

export function formatUtcTimestamp(date = new Date()) {
  return (
    `${date.getUTCFullYear()}${twoDigits(date.getUTCMonth() + 1)}` +
    `${twoDigits(date.getUTCDate())}${twoDigits(date.getUTCHours())}` +
    `${twoDigits(date.getUTCMinutes())}${twoDigits(date.getUTCSeconds())}`
  );
}

export function validateTimestamp(timestamp) {
  if (!/^\d{14}$/.test(timestamp)) {
    throw new Error("Snapshot timestamp must use UTC format YYYYMMDDHHmmss");
  }
  const parts = [
    Number(timestamp.slice(0, 4)),
    Number(timestamp.slice(4, 6)),
    Number(timestamp.slice(6, 8)),
    Number(timestamp.slice(8, 10)),
    Number(timestamp.slice(10, 12)),
    Number(timestamp.slice(12, 14)),
  ];
  const date = new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]),
  );
  if (parts[0] < 2000 || formatUtcTimestamp(date) !== timestamp) {
    throw new Error(`Invalid UTC snapshot timestamp ${timestamp}`);
  }
}

export function languageSnapshotVersion(timestamp) {
  validateTimestamp(timestamp);
  return `${BASE_VERSION}-SNAPSHOT.${timestamp}`;
}

export function compilerSnapshotVersion(timestamp) {
  validateTimestamp(timestamp);
  return `${COMPILER_BASE_VERSION}-SNAPSHOT.${timestamp}`;
}

function compilerTimestamp(version) {
  const match = version.match(/^0\.9\.9-SNAPSHOT\.(\d{14})$/);
  if (!match) {
    throw new Error(
      `Compiler version must match 0.9.9-SNAPSHOT.YYYYMMDDHHmmss, received ${version}`,
    );
  }
  validateTimestamp(match[1]);
  return match[1];
}

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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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

export function rewriteLanguageManifest(
  manifest,
  { snapshotVersion, compilerVersion },
) {
  if (manifest.version !== BASE_VERSION) {
    throw new Error(
      `${manifest.name} version ${manifest.version} does not match ${BASE_VERSION}`,
    );
  }
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([name, version]) => {
      if (INTERNAL_NAMES.has(name)) return [name, snapshotVersion];
      if (name === "@ilic/compiler-wasm") return [name, compilerVersion];
      return [name, version];
    }),
  );
  return { ...manifest, version: snapshotVersion, dependencies };
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

export async function prepareNpmSnapshot({
  projectRoot = resolve(import.meta.dirname, ".."),
  compilerProjectRoot = resolve(projectRoot, "../ilic-fork"),
  outputRoot = resolve(projectRoot, "artifacts/npm"),
  timestamp = formatUtcTimestamp(),
  compilerVersion = compilerSnapshotVersion(timestamp),
} = {}) {
  projectRoot = resolve(projectRoot);
  compilerProjectRoot = resolve(compilerProjectRoot);
  outputRoot = resolve(outputRoot);
  validateTimestamp(timestamp);
  validateOutputRoot(projectRoot, outputRoot);
  const snapshotVersion = languageSnapshotVersion(timestamp);
  const resolvedCompilerTimestamp = compilerTimestamp(compilerVersion);

  const workspaceManifest = await readJson(
    resolve(projectRoot, "package.json"),
  );
  if (workspaceManifest.version !== BASE_VERSION) {
    throw new Error(
      `Workspace version ${workspaceManifest.version} does not match ${BASE_VERSION}`,
    );
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const compilerModule = await import(
    pathToFileURL(
      resolve(compilerProjectRoot, "scripts/prepare-npm-snapshot.mjs"),
    ).href
  );
  const compiler = await compilerModule.prepareNpmSnapshot({
    projectRoot: compilerProjectRoot,
    outputRoot: resolve(outputRoot, "staging/compiler"),
    timestamp: resolvedCompilerTimestamp,
  });
  if (compiler.snapshotVersion !== compilerVersion) {
    throw new Error(
      `Staged compiler version ${compiler.snapshotVersion} does not match ${compilerVersion}`,
    );
  }

  const packageResults = {};
  for (const spec of COMPILER_PACKAGES) {
    const directory = compiler.directories[spec.compilerId];
    const alias = resolve(outputRoot, `ilic-${spec.id}-snapshot.tgz`);
    const packed = pack(directory, outputRoot, alias);
    await rename(packed.generated, alias);
    packageResults[spec.name] = {
      version: compilerVersion,
      tarball: alias,
      stagingDirectory: directory,
    };
  }

  for (const spec of LANGUAGE_PACKAGES) {
    const source = resolve(projectRoot, `packages/${spec.id}`);
    const manifest = await readJson(resolve(source, "package.json"));
    if (manifest.name !== spec.name) {
      throw new Error(
        `packages/${spec.id}/package.json must be named ${spec.name}`,
      );
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error(`${spec.name} must declare a non-empty files list`);
    }
    const destination = resolve(outputRoot, `staging/language/${spec.id}`);
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
    const stagedManifest = rewriteLanguageManifest(manifest, {
      snapshotVersion,
      compilerVersion,
    });
    await writeFile(
      resolve(destination, "package.json"),
      `${JSON.stringify(stagedManifest, null, 2)}\n`,
    );
    const alias = resolve(outputRoot, `ilic-${spec.id}-snapshot.tgz`);
    const packed = pack(destination, outputRoot, alias);
    await rename(packed.generated, alias);
    packageResults[spec.name] = {
      version: snapshotVersion,
      tarball: alias,
      stagingDirectory: destination,
    };
  }

  const result = {
    schemaVersion: 1,
    timestamp,
    snapshotVersion,
    compilerVersion,
    outputRoot,
    packages: packageResults,
  };
  await writeFile(
    resolve(outputRoot, "snapshot-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: result.schemaVersion,
        timestamp,
        snapshotVersion,
        compilerVersion,
        packages: Object.fromEntries(
          Object.entries(packageResults).map(([name, value]) => [
            name,
            { version: value.version, tarball: basename(value.tarball) },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  return result;
}

function parseArguments(argv) {
  const options = {};
  let githubOutput;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (
      [
        "--project-root",
        "--compiler-project-root",
        "--output",
        "--timestamp",
        "--compiler-version",
        "--github-output",
      ].includes(argument)
    ) {
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--project-root") options.projectRoot = resolve(value);
      else if (argument === "--compiler-project-root") {
        options.compilerProjectRoot = resolve(value);
      } else if (argument === "--output") options.outputRoot = resolve(value);
      else if (argument === "--timestamp") options.timestamp = value;
      else if (argument === "--compiler-version")
        options.compilerVersion = value;
      else githubOutput = value;
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  return { options, githubOutput };
}

async function main() {
  const { options, githubOutput } = parseArguments(process.argv.slice(2));
  const result = await prepareNpmSnapshot(options);
  if (githubOutput) {
    await appendFile(
      githubOutput,
      [
        `snapshot_version=${result.snapshotVersion}`,
        `compiler_version=${result.compilerVersion}`,
        `artifact_directory=${result.outputRoot}`,
        "",
      ].join("\n"),
    );
  }
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
