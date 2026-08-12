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

test("publishes Open VSX after successful main CI runs", () => {
  for (const fragment of [
    "workflow_run:",
    "workflows: [CI]",
    "types: [completed]",
    "branches: [main]",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "ref: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}",
    "VSIX_PRE_RELEASE: ${{ (github.event_name == 'workflow_run' || inputs.pre_release) && '1' || '0' }}",
    'timestamp=$(date -u -d "$CI_RUN_CREATED_AT" +%Y%m%d%H%M%S)',
    'version="${source_version}-SNAPSHOT.${timestamp}.${CI_RUN_ID}"',
    "VSIX_VERSION=$version",
    'test -n "$OVSX_PAT"',
    "--skip-duplicate",
  ])
    assert.ok(
      workflow.includes(fragment),
      `missing workflow fragment: ${fragment}`,
    );
});
