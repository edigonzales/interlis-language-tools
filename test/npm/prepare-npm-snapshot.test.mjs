import assert from "node:assert/strict";
import test from "node:test";
import {
  compilerSnapshotVersion,
  formatUtcTimestamp,
  languageSnapshotVersion,
  parseCompilerVersion,
  parseCompilerSnapshotVersion,
  rewriteLanguageManifest,
  validateCompilerVersionForSource,
  validateFullSha,
  validateTimestamp,
} from "../../scripts/prepare-npm-snapshot.mjs";

const timestamp = "20260719190000";

test("creates deterministic compiler and language snapshot versions", () => {
  assert.equal(formatUtcTimestamp(new Date("2026-07-19T19:00:00Z")), timestamp);
  assert.equal(
    compilerSnapshotVersion(timestamp),
    `0.10.0-SNAPSHOT.${timestamp}`,
  );
  assert.equal(
    languageSnapshotVersion(timestamp),
    `0.1.2-SNAPSHOT.${timestamp}`,
  );
});

test("adds the same numeric build ID to compiler and language versions", () => {
  assert.equal(
    compilerSnapshotVersion(timestamp, "12345"),
    `0.10.0-SNAPSHOT.${timestamp}.12345`,
  );
  assert.equal(
    languageSnapshotVersion(timestamp, "12345"),
    `0.1.2-SNAPSHOT.${timestamp}.12345`,
  );
});

test("keeps compiler and language build IDs independent", () => {
  assert.deepEqual(
    parseCompilerSnapshotVersion("0.9.9-SNAPSHOT.20260719190000.98765"),
    { timestamp, buildId: "98765" },
  );
  assert.deepEqual(
    parseCompilerSnapshotVersion("0.9.9-SNAPSHOT.20260719190000"),
    { timestamp, buildId: undefined },
  );
});

test("parses stable and current compiler snapshot versions explicitly", () => {
  assert.deepEqual(parseCompilerVersion("0.10.0"), {
    kind: "stable",
    baseVersion: "0.10.0",
    version: "0.10.0",
  });
  assert.deepEqual(
    parseCompilerVersion("0.10.0-SNAPSHOT.20260719190000.123"),
    {
      kind: "snapshot",
      baseVersion: "0.10.0",
      timestamp,
      buildId: "123",
      version: "0.10.0-SNAPSHOT.20260719190000.123",
    },
  );
});

test("validates compiler versions against the checked-out source base", () => {
  assert.equal(
    validateCompilerVersionForSource("0.10.0", "0.10.0").kind,
    "stable",
  );
  assert.equal(
    validateCompilerVersionForSource(
      "0.10.0-SNAPSHOT.20260719190000",
      "0.10.0",
    ).kind,
    "snapshot",
  );
  assert.equal(
    validateCompilerVersionForSource(
      "0.9.9-SNAPSHOT.20260719190000",
      "0.9.9",
    ).baseVersion,
    "0.9.9",
  );
  assert.throws(
    () => validateCompilerVersionForSource("0.9.10", "0.9.10"),
    /stable compiler version must be 0\.10\.0/i,
  );
  assert.throws(
    () =>
      validateCompilerVersionForSource(
        "0.9.9-SNAPSHOT.20260719190000",
        "0.9.10",
      ),
    /checked-out ilic source has base 0\.9\.10/i,
  );
});

test("rejects malformed compiler versions, timestamps, and SHAs", () => {
  for (const value of [
    "v0.10.0",
    "0.10.0-SNAPSHOT.invalid",
    "0.10.0-SNAPSHOT.20260230120000",
  ]) {
    assert.throws(() => parseCompilerVersion(value), /compiler version|timestamp/i);
  }
  assert.throws(() => validateFullSha("abc"), /40-character/i);
  assert.equal(
    validateFullSha("a".repeat(40)),
    "a".repeat(40),
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
      version: "0.1.2",
      dependencies: {
        "@ilic/tools": "0.10.0",
        "@ilic/repository-core": "0.10.0",
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
    "@ilic/repository-core": compilerVersion,
    "@ilic/docx": snapshotVersion,
    "@ilic/language-service": snapshotVersion,
    "vscode-languageserver": "^9.0.1",
  });

  const service = rewriteLanguageManifest(
    {
      name: "@ilic/language-service",
      version: "0.1.2",
      dependencies: {
        "@ilic/compiler-wasm": "0.10.0",
      },
    },
    { snapshotVersion, compilerVersion },
  );
  assert.equal(service.dependencies["@ilic/compiler-wasm"], compilerVersion);
});
