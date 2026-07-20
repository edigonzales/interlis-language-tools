# Release process

## Version lines

The coordinated development versions are:

- `@ilic/compiler-wasm` and `@ilic/tools`:
  `0.9.9-SNAPSHOT.YYYYMMDDHHmmss`;
- the five language-tool packages:
  `0.1.0-SNAPSHOT.YYYYMMDDHHmmss`;
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
universal VSIX. External publication is split into two manually dispatched
workflows:

- `publish-npm-snapshot.yml` publishes the five language packages with npm
  trusted publishing and GitHub OIDC;
- `release.yml` publishes the already verified VSIX to the VS Code Marketplace
  and Open VSX.

The npm workflow resolves `@ilic/compiler-wasm@snapshot` once, validates that
`@ilic/tools@snapshot` has the same version, reads the package's `gitHead` and
checks out that exact compiler commit. The staged `@ilic/language-service`
manifest pins the resolved compiler version. The workflow then publishes in
dependency order: Language Service, Monaco Adapter, Diagram, DOCX, Language
Server.

Only the npm publish job receives:

```yaml
permissions:
  contents: read
  id-token: write
```

It runs on a GitHub-hosted runner with Node 24 and npm 11.18.0. There is no
`NPM_TOKEN`, `NODE_AUTH_TOKEN` or checked-in `.npmrc`. Public packages from this
public repository receive npm provenance automatically.

The only manually configured GitHub Actions secrets are:

| Secret     | Destination                                  |
| ---------- | -------------------------------------------- |
| `VSCE_PAT` | VS Code Marketplace, publisher `edigonzales` |
| `OVSX_PAT` | Open VSX, publisher `edigonzales`            |

Missing Marketplace credentials do not block the sibling publication job or
artifact creation. GitHub Pages uses GitHub's own OIDC permissions in the Web
IDE repository and needs no manually configured secret.

## npm trusted-publisher bootstrap

`@ilic/tools` and `@ilic/compiler-wasm` already exist on npm. After publishing
the first compiler snapshot containing the editor snapshot API, configure and
verify the trusted publisher described in `ilic-fork/docs/npm-publikation.md`.

The five language packages do not yet exist and therefore need one interactive
bootstrap publish. Generate or download the verified tarballs, authenticate
locally with 2FA, and publish them in dependency order:

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
`npm dist-tag add`. The GitHub workflow therefore remains token-free and only
moves `snapshot`. After every successful `Publish npm snapshot` run, validate
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

1. Publish matching `@ilic/tools` and `@ilic/compiler-wasm` snapshots from
   `ilic-fork`.
2. Run `Publish npm snapshot` in this repository. It pins the exact compiler
   snapshot and creates one timestamp for all five language packages.
3. Synchronize `latest` to the new `snapshot` locally with 2FA.
4. Run `Publish VS Code extension` only when the extension manifest version has
   not already been published.
5. Build the Web IDE from the same verified local tarballs or a committed
   lockfile resolving the identical registry versions.
6. Record Marketplace, Open VSX, VS Code Web and Theia smoke results in the
   capability matrix before a future stable promotion.

npm does not offer a transaction spanning several packages. All builds and
consumer tests run before the first publish. If a later package fails, fix the
cause and create a new coordinated timestamp; never overwrite or unpublish a
previous snapshot.
