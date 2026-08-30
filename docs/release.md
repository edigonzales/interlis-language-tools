# Release process

## Version and dependency identity

The five packages `@ilic/language-service`, `@ilic/monaco-adapter`,
`@ilic/diagram`, `@ilic/docx`, and `@ilic/language-server` always receive one
common version:

- stable: `X.Y.Z` from a new matching Git tag `vX.Y.Z`;
- snapshot: `X.Y.Z-snapshot.g<12-character language-tools SHA>`.

The full 40-character Language-Tools SHA, GitHub run ID, build time, toolchain,
and exact compiler dependencies are recorded in `interlis-release.json`.
Every npm tarball also contains this file and an explicit full `gitHead`.

`release/dependencies.lock.json` is the only release input for
`@ilic/repository-core`, `@ilic/tools`, and `@ilic/compiler-wasm`. The current
lock deliberately keeps the already published compiler snapshot
`0.10.0-SNAPSHOT.20260826043335.32930660314` from ilic commit
`e901af64247082b5164252b675d87bd7a2aa829d`. The `0.10.0` values in source
manifests denote the future stable base, not a currently available stable npm
version.

Adopt a new compiler only through a committed lock change:

```sh
node scripts/release-metadata.mjs update-compiler \
  --version <exact-published-version> \
  --source-sha <full-ilic-sha>
node scripts/release-metadata.mjs check
```

Review and commit that change before starting a publication. A compiler
publication never starts a Language-Tools publication automatically.

## Channels and triggers

Normal CI builds and tests every commit but publishes nothing.

- Manually start `Publish language-tools packages` for a snapshot. npm receives
  only the dist-tag `snapshot`.
- Push a new immutable `vX.Y.Z` tag for a stable publication. npm receives only
  `latest`.
- Stable packaging is rejected while any compiler dependency in the lock is a
  snapshot.

The VSIX workflow follows the same trigger rule. A manual run produces
`X.Y.Z-snapshot.g<12 SHA>` and marks it as a pre-release; a matching stable tag
produces `X.Y.Z`. Open VSX versions are immutable and reruns use
`--skip-duplicate`. VS Code Marketplace publication remains intentionally
disabled.

## Build and publication gates

The publish workflow checks out the exact compiler SHA from the lock, builds
and tests its native and WASM variants, and then runs all Language-Tools tests.
It stages exactly five npm tarballs and installs them in a clean consumer before
the first publish. Packed internal dependencies must be exact versions; a
`workspace:*`, `file:`, dist-tag, or version range is rejected.

Only the final npm job receives `id-token: write`. It publishes through npm
Trusted Publishing with provenance and no `NPM_TOKEN`. Existing versions are
never replaced: an idempotent rerun is accepted only when npm reports the same
full `gitHead`.

After npm publication, an available `RELEASE_DISPATCH_TOKEN` sends the exact
compiler and Language-Tools identities to the Web IDE. A missing token no
longer invalidates an otherwise successful npm publication.

## Dist-tag correction before the first stable release

The five packages currently have a historical `latest` that points to an early
`0.1.0-SNAPSHOT`. Remove that misleading tag once with local npm 2FA:

```sh
for package_name in \
  @ilic/language-service \
  @ilic/monaco-adapter \
  @ilic/diagram \
  @ilic/docx \
  @ilic/language-server
do
  npm dist-tag rm "$package_name" latest --auth-type=web
done
```

Until the first stable release, installation is explicit:

```sh
npm install @ilic/language-server@snapshot
npm install @ilic/monaco-adapter@snapshot
```

Never move `latest` to a snapshot. The stable tag workflow creates or updates
`latest` only when the version is exactly `X.Y.Z`.

## Local verification

With the locked ilic checkout available as `../ilic-fork` and its WASM package
built with the locked version:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm pack:verify
corepack pnpm package:vsix
corepack pnpm licenses:check
corepack pnpm security:check
```

npm has no transaction spanning five packages. If a late publish step fails,
fix the cause and rerun the same commit; deterministic versions make the
successful prefix idempotent. Never unpublish or overwrite an earlier version.
