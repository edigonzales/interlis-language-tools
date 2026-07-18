import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "artifacts/npm");
const consumer = resolve(artifacts, "consumer");
const packages = [
  ["@ilic/compiler-wasm", resolve(root, "../ilic-fork/packages/compiler-wasm")],
  ["@ilic/language-service", resolve(root, "packages/language-service")],
  ["@ilic/language-server", resolve(root, "packages/language-server")],
  ["@ilic/monaco-adapter", resolve(root, "packages/monaco-adapter")],
  ["@ilic/diagram", resolve(root, "packages/diagram")],
  ["@ilic/docx", resolve(root, "packages/docx")],
];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}

await rm(artifacts, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });

const tarballs = [];
for (const [expectedName, directory] of packages) {
  const isCompiler = expectedName === "@ilic/compiler-wasm";
  const packed = JSON.parse(
    run(
      isCompiler ? "npm" : "pnpm",
      ["pack", "--json", "--pack-destination", artifacts],
      directory,
    ),
  );
  const result = Array.isArray(packed) ? packed[0] : packed;
  assert.equal(result.name, expectedName);
  assert.ok(result.files.some((file) => file.path === "package.json"));
  assert.ok(result.files.some((file) => file.path === "LICENSE"));
  tarballs.push(resolve(artifacts, result.filename));
}

await writeFile(
  resolve(consumer, "package.json"),
  `${JSON.stringify({ name: "interlis-language-tools-pack-smoke", private: true, type: "module" }, null, 2)}\n`,
);
await writeFile(
  resolve(consumer, "smoke.mjs"),
  `import assert from "node:assert/strict";
import { createCompiler } from "@ilic/compiler-wasm";
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

const manifests = await Promise.all(
  packages.slice(1).map(async ([name, directory]) => {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "package.json"), "utf8"),
    );
    assert.equal(manifest.publishConfig?.access, "public", name);
    assert.equal(manifest.license, "MIT", name);
    return `${name}@${manifest.version}`;
  }),
);
process.stdout.write(`Verified npm consumers: ${manifests.join(", ")}\n`);
