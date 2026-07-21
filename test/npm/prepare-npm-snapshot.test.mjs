import assert from "node:assert/strict";
import test from "node:test";
import {
  compilerSnapshotVersion,
  formatUtcTimestamp,
  languageSnapshotVersion,
  rewriteLanguageManifest,
  validateTimestamp,
} from "../../scripts/prepare-npm-snapshot.mjs";

const timestamp = "20260719190000";

test("creates deterministic compiler and language snapshot versions", () => {
  assert.equal(formatUtcTimestamp(new Date("2026-07-19T19:00:00Z")), timestamp);
  assert.equal(
    compilerSnapshotVersion(timestamp),
    `0.9.9-SNAPSHOT.${timestamp}`,
  );
  assert.equal(
    languageSnapshotVersion(timestamp),
    `0.1.0-SNAPSHOT.${timestamp}`,
  );
});

test("adds the same numeric build ID to compiler and language versions", () => {
  assert.equal(
    compilerSnapshotVersion(timestamp, "12345"),
    `0.9.9-SNAPSHOT.${timestamp}.12345`,
  );
  assert.equal(
    languageSnapshotVersion(timestamp, "12345"),
    `0.1.0-SNAPSHOT.${timestamp}.12345`,
  );
});

test("rejects malformed or impossible snapshot timestamps", () => {
  for (const value of ["2026-07-19", "20260230120000"]) {
    assert.throws(() => validateTimestamp(value), /timestamp/i);
  }
});

test("pins compiler and workspace dependencies in staged manifests", () => {
  const snapshotVersion = languageSnapshotVersion(timestamp);
  const compilerVersion = compilerSnapshotVersion(timestamp);
  const rewritten = rewriteLanguageManifest(
    {
      name: "@ilic/language-server",
      version: "0.1.0",
      dependencies: {
        "@ilic/tools": "0.9.9-SNAPSHOT",
        "@ilic/docx": "workspace:*",
        "@ilic/language-service": "workspace:*",
        "vscode-languageserver": "^9.0.1",
      },
    },
    { snapshotVersion, compilerVersion },
  );
  assert.equal(rewritten.version, snapshotVersion);
  assert.deepEqual(rewritten.dependencies, {
    "@ilic/tools": compilerVersion,
    "@ilic/docx": snapshotVersion,
    "@ilic/language-service": snapshotVersion,
    "vscode-languageserver": "^9.0.1",
  });

  const service = rewriteLanguageManifest(
    {
      name: "@ilic/language-service",
      version: "0.1.0",
      dependencies: {
        "@ilic/compiler-wasm": "0.9.9-SNAPSHOT",
      },
    },
    { snapshotVersion, compilerVersion },
  );
  assert.equal(service.dependencies["@ilic/compiler-wasm"], compilerVersion);
});
