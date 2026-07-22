# Release process

The end-to-end triggers, build gates, artifacts, permissions and hand-off to
the Web IDE are documented in the
[build and publication pipeline](build-und-publikationspipeline.md). This page
covers the operational version, bootstrap, dist-tag and recovery policy.

## Version lines

The coordinated development versions are:

- `@ilic/compiler-wasm` and `@ilic/tools`: the exact compiler version supplied
  by `ilic-fork`, `0.9.9-SNAPSHOT.YYYYMMDDHHmmss.<compiler-build-id>`;
- the five language-tool packages: a separately generated version
  `0.1.0-SNAPSHOT.YYYYMMDDHHmmss.<language-build-id>`;
- VS Code/Open VSX extension: `0.1.0`, packaged as a pre-release;
- browser IDE: an independently versioned private deployment package.

The source manifests contain only the base versions `0.9.9` and `0.1.0`.
Staging writes timestamped versions into disposable directories below
`artifacts/`; it never edits a tracked manifest. npm snapshots are published
through the dist-tag `snapshot` and installed explicitly through that channel:

```sh
npm install @ilic/language-server@snapshot
npm install @ilic/monaco-adapter@snapshot
```

On the first publish of a new package, npm also creates the `latest` dist-tag.
That tag cannot be removed completely, only moved to another version. Until the
first stable release, `latest` is therefore synchronized to the current
`snapshot` after every publication. Once a stable release exists, `latest`
points to that stable version and `snapshot` remains the prerelease channel.
See the [npm dist-tag documentation](https://docs.npmjs.com/cli/dist-tag/).

The tag is a user-facing alias only. Every dependency between published
`@ilic/*` packages is an exact `*-SNAPSHOT.<timestamp>` version. A packed
manifest containing `workspace:*`, `file:`, a dist-tag or a version range for
an internal package fails verification.

VS Code Marketplace manifests cannot use a SemVer pre-release suffix. The
normal extension version is therefore marked with `vsce package --pre-release`.
Extension publication is deliberately separate from repeatable npm snapshots.

## Pipelines

`ci.yml` always builds and tests the sources, seven npm tarballs and the
universal VSIX. A successful main-branch CI completion starts the coordinated
npm workflow only after CI has completed; the release workflow then repeats
its gates from the exact CI `head_sha` and publishes only the five language
packages. A successful compiler publication can also dispatch the coordinated
workflow with an exact compiler SHA and already published compiler version.
The VSIX publication remains a separate manual release workflow:

- `publish-npm-snapshot.yml` starts after successful main CI, or through the
  coordinated/manual recovery triggers. It checks out exact compiler and
  language-tools SHAs, verifies the two compiler packages and publishes the
  five language packages, then sends the completed release to the Web IDE with
  `repository_dispatch`;
- `release.yml` publishes the already verified VSIX to the VS Code Marketplace
  and Open VSX.

The language-service coverage report runs in both CI and the release train and
is retained as a workflow artifact for inspection. Its configured thresholds
(90% statements/lines/functions and 85% branches) are currently report-only, so
a coverage shortfall does not prevent the coordinated npm publication. The
blocking gate is tracked in the [coverage backlog](../BACKLOG.md#coverage-gate-and-test-expansion)
and will be restored after the targets are met consistently.

The compiler repository dispatches only after its own npm publication succeeds.
The payload contains the full compiler SHA and exact compiler snapshot version.
A successful main-branch CI completion starts the language-tools publish run
with the exact `workflow_run.head_sha`; a coordinated dispatch or manual run
uses its explicitly supplied or resolved Language-Tools SHA. Each path resolves
the current compiler `snapshot` tag only once, verifies both compiler packages,
and then uses the resulting immutable version. The staged manifests pin that
exact compiler version, and `release-manifest.json` records both source
revisions, both independent timestamps/build IDs and all published versions.

Only the npm publish job receives:

```yaml
permissions:
  contents: read
  id-token: write
```

It runs on a GitHub-hosted runner with Node 24 and npm 11.18.0. There is no
`NPM_TOKEN`, `NODE_AUTH_TOKEN` or checked-in `.npmrc`. Public packages from this
public repository receive npm provenance automatically.

The manually configured GitHub Actions secrets are:

| Secret                   | Destination                                     |
| ------------------------ | ----------------------------------------------- |
| `VSCE_PAT`               | VS Code Marketplace, publisher `edigonzales`    |
| `OVSX_PAT`               | Open VSX, publisher `edigonzales`               |
| `RELEASE_DISPATCH_TOKEN` | Cross-repository dispatch to `interlis-web-ide` |

Missing Marketplace credentials do not block the sibling publication job or
artifact creation. GitHub Pages uses GitHub's own OIDC permissions in the Web
IDE repository and needs no manually configured secret.

`RELEASE_DISPATCH_TOKEN` is a GitHub API credential, not an npm credential. In
this repository it is stored under `Settings → Secrets and variables →
Actions` and is used only to send `release-train-published` to
`edigonzales/interlis-web-ide`. A recommended fine-grained token is restricted
to that target repository with `Contents: Read and write`. The reverse
direction uses a separate secret with the same name in `ilic-fork`, targeting
`interlis-language-tools`. npm publication remains token-free through GitHub
OIDC.

## npm trusted-publisher bootstrap

`@ilic/tools` and `@ilic/compiler-wasm` already exist on npm. Their Trusted
Publisher must point to `edigonzales/ilic-fork`, workflow filename
`publish-npm-snapshot.yml`. The five language packages use the workflow in this
repository.

For a new package or a one-time bootstrap, generate or download the verified
tarballs, authenticate locally with 2FA, and publish the five language packages
in dependency order:

```sh
npm login
npm publish artifacts/npm/ilic-language-service-snapshot.tgz --access public --tag snapshot
npm publish artifacts/npm/ilic-monaco-adapter-snapshot.tgz --access public --tag snapshot
npm publish artifacts/npm/ilic-diagram-snapshot.tgz --access public --tag snapshot
npm publish artifacts/npm/ilic-docx-snapshot.tgz --access public --tag snapshot
npm publish artifacts/npm/ilic-language-server-snapshot.tgz --access public --tag snapshot
```

For every new package, set `Package → Settings → Trusted Publisher` to:

| Field                       | Value                      |
| --------------------------- | -------------------------- |
| Provider                    | GitHub Actions             |
| GitHub user or organization | `edigonzales`              |
| Repository                  | `interlis-language-tools`  |
| Workflow filename           | `publish-npm-snapshot.yml` |
| Environment                 | empty                      |
| Allowed action              | `npm publish`              |

After one successful OIDC publication, set publishing access to **Require
two-factor authentication and disallow tokens**, revoke obsolete npm tokens
and remove any old `NPM_TOKEN` repository secret.

## Synchronize `latest` after npm publication

Trusted publishing authorizes `npm publish` or `npm stage publish`, but not
`npm dist-tag add`. The npm publication itself remains token-free; the separate
`RELEASE_DISPATCH_TOKEN` is used only for the Web-IDE dispatch. After every
successful `Publish npm snapshot` run, validate
all five versions before changing any tag, then move `latest` locally with 2FA:

```sh
language_packages=(
  @ilic/language-service
  @ilic/monaco-adapter
  @ilic/diagram
  @ilic/docx
  @ilic/language-server
)

language_snapshot_version=$(
  npm view @ilic/language-service@snapshot version
)

for package_name in "${language_packages[@]}"; do
  package_snapshot_version=$(npm view "$package_name@snapshot" version)

  if [[ "$package_snapshot_version" != "$language_snapshot_version" ]]; then
    echo "$package_name has a different snapshot version" >&2
    exit 1
  fi
done

for package_name in "${language_packages[@]}"; do
  npm dist-tag add \
    "$package_name@$language_snapshot_version" \
    latest \
    --auth-type=web
done
```

The same command applies after the interactive bootstrap. npm creates `latest`
automatically during the first publish, so the initial run only confirms the
selected policy. This step can move into GitHub Actions only after npm permits
trusted publishers to modify dist-tags; progress is tracked in the open
[npm CLI issue #8547](https://github.com/npm/cli/issues/8547).

Verify that both tags resolve to the same coordinated version:

```sh
for package_name in \
  @ilic/language-service \
  @ilic/monaco-adapter \
  @ilic/diagram \
  @ilic/docx \
  @ilic/language-server
do
  npm dist-tag ls "$package_name"
done
```

## Ordering and recovery

1. A successful `ilic-fork` `main` CI run requests a release train, or a
   successful language-tools `main` push starts one directly.
2. The release train captures both source SHAs, builds native and WASM
   compiler artifacts, verifies all seven packages, and publishes the five
   language packages in dependency order. The two compiler packages were
   already published by `ilic-fork`.
3. A repeat of the same workflow skips package versions that already exist and
   can finish a partially completed publication.
4. The workflow dispatches the exact source pair to the Web IDE Pages build.
5. Synchronize `latest` to the new `snapshot` locally with 2FA.
6. Run `Publish VS Code extension` only when the extension manifest version has
   not already been published.
7. Build the Web IDE from the same verified local tarballs or a committed
   lockfile resolving the identical registry versions.
8. Record Marketplace, Open VSX, VS Code Web and Theia smoke results in the
   capability matrix before a future stable promotion.

npm does not offer a transaction spanning several packages. All builds and
consumer tests run before the first publish. If a later package fails, fix the
cause and create a new coordinated timestamp; never overwrite or unpublish a
previous snapshot.
