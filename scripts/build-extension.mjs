import { copyFile, mkdir, rm } from "node:fs/promises";
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

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(extension, "src/extension-node.ts")],
    outfile: resolve(dist, "extension-node.js"),
    platform: "node",
  }),
  build({
    ...shared,
    entryPoints: [resolve(extension, "src/server-node.ts")],
    outfile: resolve(dist, "server-node.js"),
    platform: "node",
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

await copyFile(resolve(compiler, "ilic.wasm"), resolve(dist, "ilic.wasm"));
