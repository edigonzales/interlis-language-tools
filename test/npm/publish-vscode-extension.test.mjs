import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workflow = await readFile(
  resolve(
    import.meta.dirname,
    "../../.github/workflows/publish-vscode-extension.yml",
  ),
  "utf8",
);

test("publishes VSIX snapshots only by dispatch and stable versions only by tag", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /tags:\s*\n\s*- ['"]v\*['"]/u);
  assert.doesNotMatch(workflow, /workflow_run:/u);
  for (const fragment of [
    "release-metadata.mjs check",
    "release-metadata.mjs manifest",
    "steps.lock.outputs.compiler_sha",
    '--channel "$channel"',
    'test "$GITHUB_REF_NAME" = "v$source_version"',
    'test -n "$OVSX_PAT"',
    "--skip-duplicate",
  ]) {
    assert.ok(
      workflow.includes(fragment),
      `missing workflow fragment: ${fragment}`,
    );
  }
});
