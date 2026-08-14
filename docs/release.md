# Release process

The end-to-end triggers, build gates, artifacts, permissions and hand-off to
the Web IDE are documented in the
[build and publication pipeline](build-und-publikationspipeline.md). This page
covers the operational version, bootstrap, dist-tag and recovery policy.

## Version lines

The coordinated development versions are:

- `@ilic/repository-core`, `@ilic/compiler-wasm` and `@ilic/tools`: the exact
  compiler version supplied by `ilic-fork`, either stable `0.10.0` or
  `0.10.0-SNAPSHOT.YYYYMMDDHHmmss.<compiler-build-id>`;
- the five language-tool packages: a separately generated version
  `0.1.2-SNAPSHOT.YYYYMMDDHHmmss.<language-build-id>`;
- VS Code extension source: `0.1.2`, packaged as a pre-release;
- automatic Open-VSX builds: `0.1.2-SNAPSHOT.YYYYMMDDHHmmss.<github-run-id>`;
- browser IDE: an independently versioned private deployment package.

The source manifests contain only the base versions `0.10.0` and `0.1.2`.
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
Open VSX receives a unique SemVer pre-release suffix in the generated VSIX;
the source manifest remains at the base version and npm snapshot versions are
unrelated. Open VSX has no npm-style dist-tag, and an already published
namespace/extension/version combination cannot be replaced. Repeated workflow
runs therefore use `ovsx --skip-duplicate`.
The current automatic line is based on the pre-release `0.1.2`; after a stable
`0.1.2` release, the next automatic line must use the next base version, for
example `0.1.3-SNAPSHOT...`, so that it remains newer than the stable release.

## Pipelines

`ci.yml` always builds and tests the sources, eight npm tarballs and the
universal VSIX. A successful main-branch CI completion starts the coordinated
npm workflow only after CI has completed; the release workflow then repeats
its gates from the exact CI `head_sha` and publishes only the five language
packages. A successful compiler publication can also dispatch the coordinated
workflow with an exact compiler SHA and already published compiler version.
The VSIX publication runs automatically after successful main-branch CI and
can still be started manually for an intentional stable/pre-release release:

- `publish-language-tools.yml` starts after successful main CI, or through the
  coordinated/manual recovery triggers. It resolves an exact compiler version
  and source SHA, checks out that compiler commit, builds and verifies the
  native and WASM compiler artifacts, and publishes only the five language
  packages. The three compiler packages were already published by `ilic-fork`;
  after the language packages are published, the workflow sends the completed
  release to the Web IDE with `repository_dispatch`;
- `publish-vscode-extension.yml` checks out the exact successful CI commit,
  rebuilds and verifies the VSIX, assigns automatic builds a unique
  `0.1.2-SNAPSHOT...` version, and publishes it to Open VSX. Its manual mode
  remains available for intentional releases to the VS Code Marketplace and
  Open VSX.

The language-service coverage report runs in both CI and the release train and
is retained as a workflow artifact for inspection. Its configured thresholds
(90% statements/lines/functions and 85% branches) are currently report-only, so
a coverage shortfall does not prevent the coordinated npm publication. The
blocking gate is tracked in the [coverage backlog](../BACKLOG.md#coverage-gate-and-test-expansion)
and will be restored after the targets are met consistently.

The compiler repository dispatches only after its own npm publication succeeds.
The payload contains the full compiler SHA and exact stable or snapshot compiler version.
A successful main-branch CI completion starts the language-tools publish run
with the exact `workflow_run.head_sha`; a coordinated dispatch or manual run
uses its explicitly supplied or resolved Language-Tools SHA. For a workflow-run
or manual start without explicit compiler inputs, the current npm `snapshot`
version is resolved once and its npm `gitHead` is used as the compiler source;
`ilic-fork/main` is only the fallback when that metadata is unavailable. The
staged manifests pin the exact compiler version, and
`release-manifest.json` records both source revisions, both independent
timestamps/build IDs and all published versions.

The stager validates `compilerSha` against the checked-out ilic `HEAD`. Stable
input invokes ilic's stable stager; snapshot input invokes its snapshot stager.
The resulting manifest records the exact compiler version kind and SHA. Local
`file:`/workspace overrides remain development-only and are rewritten to exact
versions in every packed manifest. Compatibility with a legacy
Legacy `0.9.9-SNAPSHOT...` and `0.9.10-SNAPSHOT...` inputs remain temporarily
accepted for transition builds; stable `0.9.9` and `0.9.10` are rejected. The
compatibility entries can be removed after the first successful `0.10.0`
snapshot, stable and Pages deployments.

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

`@ilic/repository-core`, `@ilic/tools` and `@ilic/compiler-wasm` are published
by `edigonzales/ilic-fork` through `publish-npm.yml`. Their Trusted Publisher
must therefore point to that repository and workflow. The five language
packages use the workflow in this repository.

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

| Field                       | Value                        |
| --------------------------- | ---------------------------- |
| Provider                    | GitHub Actions               |
| GitHub user or organization | `edigonzales`                |
| Repository                  | `interlis-language-tools`    |
| Workflow filename           | `publish-language-tools.yml` |
| Environment                 | empty                        |
| Allowed action              | `npm publish`                |

After one successful OIDC publication, set publishing access to **Require
two-factor authentication and disallow tokens**, revoke obsolete npm tokens
and remove any old `NPM_TOKEN` repository secret.

## Synchronize `latest` after npm publication

Trusted publishing authorizes `npm publish` or `npm stage publish`, but not
`npm dist-tag add`. The npm publication itself remains token-free; the separate
`RELEASE_DISPATCH_TOKEN` is used only for the Web-IDE dispatch. After every
successful `Publish language-tools snapshots` run, validate
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
   compiler artifacts, verifies all eight packages, and publishes the five
   language packages in dependency order. The three compiler packages were
   already published by `ilic-fork`.
3. A repeat of the same workflow skips package versions that already exist and
   can finish a partially completed publication.
4. The workflow dispatches the exact source pair to the Web IDE Pages build.
5. Synchronize `latest` to the new `snapshot` locally with 2FA.
6. Automatic main-branch CI publishes a unique Open-VSX pre-release. Run
   `Publish VS Code extension` manually only for an intentional stable release
   or a recovery run.
7. Build the Web IDE from the same verified local tarballs or a committed
   lockfile resolving the identical registry versions.
8. Record Marketplace, Open VSX, VS Code Web and Theia smoke results in the
   capability matrix before a future stable promotion.

npm does not offer a transaction spanning several packages. All builds and
consumer tests run before the first publish. If a later package fails, fix the
cause and create a new coordinated timestamp; never overwrite or unpublish a
previous snapshot.
