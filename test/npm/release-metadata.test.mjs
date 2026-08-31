import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertStableDependencies,
  createReleaseManifest,
  loadDependencyLock,
  snapshotVersion,
  syncDependencyFiles,
} from "../../scripts/release-metadata.mjs";
import { rewriteLanguageManifest } from "../../scripts/prepare-npm-snapshot.mjs";

const root = resolve(import.meta.dirname, "../..");
const sourceSha = "0123456789abcdef0123456789abcdef01234567";

test("derives one deterministic lowercase snapshot identity from Git", () => {
  assert.equal(
    snapshotVersion("0.1.2", sourceSha),
    "0.1.2-snapshot.g0123456789ab",
  );
  assert.notEqual(
    snapshotVersion("0.1.2", `a${sourceSha.slice(1)}`),
    snapshotVersion("0.1.2", sourceSha),
  );
  for (const legacy of [
    "0.1.2-SNAPSHOT.20260826044748.32930961069",
    "0.1.2-snapshot.123",
  ])
    assert.notEqual(snapshotVersion("0.1.2", sourceSha), legacy);
});

test("keeps the exact currently published compiler snapshot in one lock", async () => {
  const lock = await loadDependencyLock(root);
  const identities = new Set(
    Object.values(lock.dependencies).map(
      ({ version, sourceSha: sha }) => `${version}@${sha}`,
    ),
  );
  assert.deepEqual(
    [...identities],
    [
      "0.10.0-SNAPSHOT.20260826043335.32930660314@e901af64247082b5164252b675d87bd7a2aa829d",
    ],
  );
  await syncDependencyFiles(root, true);
});

test("release manifest records full source and dependency SHAs", async () => {
  const manifest = await createReleaseManifest({
    projectRoot: root,
    sourceSha,
    channel: "snapshot",
    runId: "42",
    builtAt: "2026-08-29T12:00:00Z",
    toolchain: "node-24",
  });
  assert.equal(manifest.artifactVersion, "0.1.2-snapshot.g0123456789ab");
  assert.equal(manifest.gitHead, sourceSha);
  assert.match(
    manifest.dependencies["@ilic/compiler-wasm"].sourceSha,
    /^[0-9a-f]{40}$/u,
  );
});

test("staged manifests use one language version and exact locked compiler versions", async () => {
  const lock = await loadDependencyLock(root);
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "packages/language-server/package.json"),
      "utf8",
    ),
  );
  const artifactVersion = snapshotVersion(lock.artifactBaseVersion, sourceSha);
  const rewritten = rewriteLanguageManifest(manifest, {
    artifactVersion,
    sourceSha,
    dependencies: lock.dependencies,
  });
  assert.equal(rewritten.version, artifactVersion);
  assert.equal(rewritten.gitHead, sourceSha);
  assert.equal(
    rewritten.dependencies["@ilic/language-service"],
    artifactVersion,
  );
  assert.equal(rewritten.dependencies["@ilic/docx"], artifactVersion);
  assert.equal(
    rewritten.dependencies["@ilic/tools"],
    "0.10.0-SNAPSHOT.20260826043335.32930660314",
  );
  assert.ok(rewritten.files.includes("interlis-release.json"));
});

test("stable language releases reject snapshot compiler dependencies", async () => {
  const lock = await loadDependencyLock(root);
  assert.throws(() => assertStableDependencies(lock), /require stable/u);
});

test("publish workflow is manual for snapshots and tag-only for stable releases", async () => {
  const workflow = await readFile(
    resolve(root, ".github/workflows/publish-language-tools.yml"),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /tags:\s*\n\s*- ['"]v\*['"]/u);
  assert.doesNotMatch(workflow, /workflow_run:|repository_dispatch:/u);
  assert.doesNotMatch(workflow, /RELEASE_DISPATCH_TOKEN|\/dispatches/u);
  assert.match(workflow, /--tag "\$NPM_DIST_TAG"/u);
});
