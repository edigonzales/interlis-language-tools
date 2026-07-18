# Release process

## Versioning

The first coordinated candidate is:

- `@ilic/compiler-wasm` and `@ilic/tools`: `0.10.0`;
- the five language-tool packages: `1.0.0-rc.1`;
- VS Code/Open VSX extension: `0.1.0` packaged as a pre-release;
- browser IDE: `1.0.0-rc.1` (private deployment package).

Prereleases use npm tag `next`. VS Code does not accept SemVer pre-release tags
in extension manifests, so `vsce package --pre-release` marks the normal
`major.minor.patch` version instead. Only a candidate satisfying the capability
matrix and external-host smoke tests may be promoted to `latest`/extension
`1.0.0`.

## Pipelines

The CI workflow always builds and uploads npm tarballs and the universal VSIX.
The manually dispatched release workflow repeats all gates before publication.
External publication steps are independent:

| Secret      | Destination                                  |
| ----------- | -------------------------------------------- |
| `NPM_TOKEN` | npm public packages                          |
| `VSCE_PAT`  | VS Code Marketplace, publisher `edigonzales` |
| `OVSX_PAT`  | Open VSX, publisher `edigonzales`            |

Missing credentials do not block tests or artifact creation and are never
printed. GitHub Pages is deployed from the separately verified
`interlis-web-ide/dist` artifact.

## Ordering

1. Merge and publish `ilic-fork@0.10.0`.
2. Build `interlis-language-tools`; its local workspace override is used only
   for development, while packed manifests require `@ilic/compiler-wasm` 0.10.
3. Publish the five `1.0.0-rc.1` packages with npm tag `next`.
4. Package, install-smoke and publish the universal VSIX.
5. Build the Web IDE from generated local tarballs or the identical pinned
   registry versions, then deploy Pages.
6. Record external-host smoke results in the capability matrix before stable
   promotion.

Rollback does not overwrite registry versions. Publish a corrected RC, keep the
previous VSIX artifact, and redeploy the last known-good Pages artifact.
