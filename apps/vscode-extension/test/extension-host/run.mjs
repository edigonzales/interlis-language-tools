import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const sourceExtensionPath = resolve(import.meta.dirname, "../..");
const extensionTestsPath = resolve(
  sourceExtensionPath,
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
  let extensionDevelopmentPath = sourceExtensionPath;
  if (process.env.ILIC_TEST_INSTALLED_VSIX === "1") {
    vscodeExecutablePath ??= await downloadAndUnzipVSCode("1.96.4");
    const vsix = resolve(
      sourceExtensionPath,
      "../../artifacts/interlis-language-tools.vsix",
    );
    await access(vsix);
    let installExecutable = vscodeExecutablePath;
    if (process.platform === "darwin") {
      const command =
        basename(vscodeExecutablePath).toLowerCase() === "vscodium"
          ? "codium"
          : "code";
      const candidate = resolve(
        dirname(vscodeExecutablePath),
        `../Resources/app/bin/${command}`,
      );
      await access(candidate);
      installExecutable = candidate;
    }
    const installation = spawnSync(
      installExecutable,
      [
        `--user-data-dir=${userData}`,
        `--extensions-dir=${extensions}`,
        "--install-extension",
        vsix,
        "--force",
      ],
      { encoding: "utf8" },
    );
    if (installation.status !== 0)
      throw new Error(
        `VSIX installation failed: ${installation.stderr || installation.stdout}`,
      );
    const installed = (await readdir(extensions)).find((entry) =>
      entry.startsWith("edigonzales.interlis-language-tools-"),
    );
    if (!installed)
      throw new Error("Installed INTERLIS extension directory was not found");
    extensionDevelopmentPath = join(extensions, installed);
    await access(join(extensionDevelopmentPath, "dist/server-node.js"));
    await access(
      join(extensionDevelopmentPath, "dist/compiler-worker-node.js"),
    );
  }
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
