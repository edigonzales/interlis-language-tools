import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const extension = resolve(root, "apps/vscode-extension");
const output = resolve(extension, "dist-test");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  bundle: true,
  entryPoints: [resolve(extension, "src/extension-host-tests.ts")],
  external: ["vscode"],
  format: "cjs",
  legalComments: "none",
  logLevel: "warning",
  outfile: resolve(output, "extension-host-tests.cjs"),
  platform: "node",
  sourcemap: true,
  target: "node20",
});
