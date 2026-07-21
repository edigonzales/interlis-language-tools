# Test strategy

The release gate verifies source behavior and installed artifacts. Generated
files are never trusted merely because the workspace compiles.

## Compiler (`ilic-fork`)

- CMake/CTest covers native APIs, syntax and semantic snapshots, Unicode
  positions, repository resolution and INTERLIS regression models.
- `@ilic/compiler-wasm` executes the documented session and repository examples
  against the real WASM ABI.
- `@ilic/tools` resolves a repository dependency closure.
- Repository tests also cover partial catalog failure and a warm cache with no
  network access.

## Language tools

```sh
pnpm check
pnpm --filter @ilic/language-service test:coverage
pnpm pack:verify
pnpm package:vsix
pnpm licenses:check
pnpm security:check
pnpm test:repository-network
```

The core thresholds are 90% statements, lines and functions and 85% branches.
CI and the coordinated npm release train still generate this report and upload
it as an artifact, but the threshold check is currently non-blocking. The
thresholds and the missing test coverage are tracked in the
[`Coverage gate and test expansion`](../BACKLOG.md#coverage-gate-and-test-expansion)
section of the backlog; publication must become gated again once those targets
are met consistently.
`check` includes deterministic version/rewrite tests using a fixed UTC
timestamp. `pack:verify` stages and installs all seven public package tarballs
in a clean consumer, runs the WASM compiler, and rejects moving internal
dependency specifications. `package:vsix` unpacks the extension and asserts its
identity, license, icon, WASM binary and Node/browser client and server entry
points.

Language-service tests exercise workspace precedence, transitive repository
sources, exact import navigation, generation cancellation, repository-aware
completion and read-only rename. LSP adapter tests cover browser aliases and
virtual repository URIs. The F5 example workspace provides the Desktop/Web
Ctrl-click smoke path for `IMPORTS Units`.
`test:repository-network` is the separate opt-in network smoke test for the two
temporary CORS mirror catalogs; deterministic unit and release checks do not
depend on public network availability.

## Web IDE

Vitest covers workspace, repository and Git contracts. Playwright covers OPFS
recovery, ZIP, local-folder selection, local Git, shared language tooling,
compile, diagram, SVG, DOCX and offline PWA behavior in Chromium, Firefox and
WebKit. The public SOGIS clone is opt-in locally and scheduled weekly:

```sh
pnpm check
pnpm e2e
pnpm e2e:public-clone --project chromium
```

Playwright WebKit needs a persistent context for OPFS and shares that OPFS across
profiles. The test fixture clears only browser-owned test state between cases.
Its persistent context cannot currently exercise CacheStorage offline
navigation, so that single path is covered by Chromium/Firefox while the other
WebKit workflows remain active.

## Required release evidence

- all local gates above pass;
- npm tarballs install without workspace links and contain only exact internal
  snapshot dependencies;
- the VSIX installs in VS Code Desktop and VS Code Web;
- the same server package starts in a compatible Theia host;
- Marketplace/Open VSX metadata retains
  `edigonzales.interlis-language-tools`;
- GitHub Pages starts once online and reloads offline.
