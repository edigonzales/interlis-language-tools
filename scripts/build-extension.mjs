import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const extension = resolve(root, "apps/vscode-extension");
const dist = resolve(extension, "dist");
const compiler = resolve(root, "../ilic-fork/packages/compiler-wasm");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const shared = {
  bundle: true,
  external: ["vscode", "module"],
  format: "esm",
  legalComments: "none",
  logLevel: "warning",
  sourcemap: true,
  target: "es2022",
};

const nodeRuntimeBanner = [
  'import { createRequire as __ilicCreateRequire } from "node:module";',
  'import { fileURLToPath as __ilicFileURLToPath } from "node:url";',
  'import { dirname as __ilicDirname } from "node:path";',
  "const require = __ilicCreateRequire(import.meta.url);",
  "const __filename = __ilicFileURLToPath(import.meta.url);",
  "const __dirname = __ilicDirname(__filename);",
].join("\n");

const node = {
  ...shared,
  banner: { js: nodeRuntimeBanner },
  platform: "node",
};

await Promise.all([
  build({
    ...node,
    entryPoints: [resolve(extension, "src/extension-node.ts")],
    outfile: resolve(dist, "extension-node.js"),
  }),
  build({
    ...node,
    entryPoints: [resolve(extension, "src/server-node.ts")],
    outfile: resolve(dist, "server-node.js"),
  }),
  build({
    ...shared,
    entryPoints: [resolve(extension, "src/extension-browser.ts")],
    outfile: resolve(dist, "extension-browser.js"),
    platform: "browser",
  }),
  build({
    ...shared,
    entryPoints: [resolve(extension, "src/server-browser.ts")],
    outfile: resolve(dist, "server-browser.js"),
    platform: "browser",
  }),
]);

const terminateProcess = resolve(
  extension,
  "node_modules/vscode-languageclient/lib/node/terminateProcess.sh",
);
const bundledTerminateProcess = resolve(dist, "terminateProcess.sh");

await Promise.all([
  copyFile(resolve(compiler, "ilic.wasm"), resolve(dist, "ilic.wasm")),
  copyFile(terminateProcess, bundledTerminateProcess),
]);
await chmod(bundledTerminateProcess, 0o755);
