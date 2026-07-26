import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = resolve(import.meta.dirname, "../..");
const extensionTestsPath = resolve(
  extensionDevelopmentPath,
  "dist-test/extension-host-tests.cjs",
);
const temporaryBase = process.platform === "darwin" ? "/tmp" : tmpdir();
const temporaryRoot = await mkdtemp(join(temporaryBase, "ilic-e2e-"));
const workspace = join(temporaryRoot, "workspace");
const userData = join(temporaryRoot, "data");
const extensions = join(temporaryRoot, "extensions");
await mkdir(join(workspace, ".vscode"), { recursive: true });
await writeFile(
  join(workspace, "Root.ili"),
  'INTERLIS 2.4;\nMODEL Root (en) AT "https://example.test" VERSION "2026-07-26" =\nEND Root.\n',
);
await writeFile(
  join(workspace, ".vscode/settings.json"),
  JSON.stringify({
    "interlisLanguageTools.autoShowOutputOnStart": false,
    "editor.quickSuggestions": true,
  }),
);

const configuredExecutable = process.env.ILIC_VSCODE_EXECUTABLE_PATH;
const vscodiumExecutable =
  process.platform === "darwin"
    ? "/Applications/VSCodium.app/Contents/MacOS/VSCodium"
    : undefined;
let vscodeExecutablePath = configuredExecutable;
if (!vscodeExecutablePath && vscodiumExecutable)
  try {
    await access(vscodiumExecutable);
    vscodeExecutablePath = vscodiumExecutable;
  } catch {
    vscodeExecutablePath = undefined;
  }

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspace,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensions}`,
    ],
    ...(vscodeExecutablePath
      ? { vscodeExecutablePath }
      : { version: "1.96.4" }),
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
