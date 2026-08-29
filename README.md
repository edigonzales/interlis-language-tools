# INTERLIS Language Tools

Java-free INTERLIS 2.3/2.4 language tooling for VS Code Desktop, VS Code Web,
Theia and browser-based Monaco IDEs. The next public snapshot line uses the
deterministic form `0.1.2-snapshot.g<12-character Git SHA>`. Its compiler
version and full source SHA are committed in `release/dependencies.lock.json`.
The `0.10.0` values in source manifests are the future stable compiler base;
they are not a claim that `0.10.0` is already the npm `latest` release.

## Architecture

The LSP is an adapter, not the business-logic boundary:

```text
@ilic/compiler-wasm
        ↓
@ilic/language-service
   ↙          ↘
LSP adapter   Monaco adapter
   ↓              ↓
VS Code/Theia   Browser IDE
```

Compilation remains save-driven after the initial document load. In VS
Code-based hosts, opening a saved, editable `.ili` document runs exactly one
root plus its transitive imports; untitled buffers and read-only repository
documents are excluded. Typing only updates the in-memory buffer. Save and the
manual compile command run the root again and atomically produce compiler
Output, Problems, and editor snapshots. Output is the compiler-owned CLI-style
transcript, including the final error/warning summary; Problems contains the
compiler diagnostics in structured form and, when enabled, conservative
`ilic-lint` warnings for the current saved editor version. Those lint warnings
are intentionally not added to the compiler transcript or its warning count.
Unsaved changes keep the last save-based result visible as outdated while a
separate, versioned editor worker provides conservative live diagnostics and
dirty-code navigation. The user-facing
behavior and safety rules are documented in
[Live diagnostics and dirty navigation (German)](docs/live-diagnostik-und-dirty-navigation.md).
The state, invalidation and refresh contract between
editor buffers, VS Code OUTLINE and open diagrams is documented in
[ADR 0002](docs/adr/0002-save-driven-editor-synchronization.md). The
editor-facing behavior of contextual suggestions, snippets, placeholders and
Enter-based auto-closing is documented in
[Completion and snippets (German)](docs/completion-und-snippets.md).

## Published packages

| Package                  | Purpose                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `@ilic/language-service` | Runtime-neutral lifecycle, diagnostics, completion, navigation, rename, formatting, compile and snapshot state |
| `@ilic/language-server`  | Node and browser-worker LSP transports plus versioned INTERLIS protocol extensions                             |
| `@ilic/monaco-adapter`   | Direct Monaco providers without JSON-RPC or a second language server                                           |
| `@ilic/diagram`          | Sprotty-compatible semantic model, `elkjs` layout, last-good state, anchored viewport and SVG export           |
| `@ilic/docx`             | Browser/Node DOCX generation from the semantic snapshot                                                        |

The universal extension has the permanent identity
`edigonzales.interlis-language-tools`. It contains Node and browser entry
points, the WASM compiler, language assets, themes and the existing INTERLIS
icon. If `edigonzales.interlis-editor` is active, it reports the conflict and
does not start a second server.

## Development

The three repositories are expected as siblings:

```text
ilic-fork/
interlis-language-tools/
interlis-web-ide/
```

The complete local setup, prerequisites, WASM artifact flow and LSP/VS-Code
workflow are described in [Local development](docs/local-development.md).

Build the compiler revision recorded in the dependency lock once, then install
and verify this workspace. The build script installs the pinned Emscripten SDK
when necessary:

```sh
export ILIC_WASM_VERSION=$(node -p "require('./release/dependencies.lock.json').dependencies['@ilic/compiler-wasm'].version")

cd ../ilic-fork
./scripts/build-wasm.sh

cd ../interlis-language-tools
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm --filter @ilic/language-service test:coverage
corepack pnpm pack:verify
corepack pnpm package:vsix
```

`pack:verify` reads the exact compiler package version from the committed lock.
To adopt another compiler, run `release-metadata.mjs update-compiler` with its
published version and full SHA, review the resulting lock/manifest changes,
commit them, and only then publish a Language-Tools snapshot. Registry
dist-tags are never release truth.

For day-to-day extension development, open the `interlis-language-tools`
repository root in VS Code, select either `INTERLIS Extension (Desktop)` or
`INTERLIS Extension (Web)` in **Run and Debug**, and press F5. The pre-launch
task builds all TypeScript packages, disables `edigonzales.interlis-editor` in
the Development Host and opens `examples/dev-workspace`. The example resolves
`LocalCatalog` from the workspace and `Units` from the configured repository.

After C++ or WASM changes, run `../ilic-fork/scripts/build-wasm.sh` again before
F5, or use the `build compiler WASM` task in VS Code. Pure TypeScript changes
need no separate build. The default SDK location is `../emsdk`; set
`ILIC_EMSDK_DIR` to use another location. Set `ILIC_WASM_AUTO_SETUP=0` to
disable automatic installation. To test the installable artifact instead:

```sh
corepack pnpm package:vsix
code --install-extension artifacts/interlis-language-tools.vsix --force
```

To run the sibling Web IDE against the current package state:

```sh
cd ../interlis-language-tools
corepack pnpm pack:verify

cd ../interlis-web-ide
corepack pnpm install --force --update-checksums
corepack pnpm dev
```

`pack:verify` installs all five staged language-tool packages in a clean
consumer. Their compiler dependencies resolve to the immutable version in the
lock. Every tarball contains `interlis-release.json` and a full `gitHead`.
Tarballs and VSIX files are written below `artifacts/` and are never committed.

## Release

CI always produces verified npm tarballs and a universal VSIX but publishes
nothing. Snapshots are published only by manually starting the corresponding
workflow; stable publication requires a new matching `vX.Y.Z` tag. npm uses
GitHub OIDC trusted publishing and no npm repository secret. See the detailed
[build and publication pipeline](docs/build-und-publikationspipeline.md),
[release process](docs/release.md),
[test strategy](docs/testing.md), [capability matrix](docs/capability-matrix.md)
and [Java-LSP migration](docs/migration-from-java-lsp.md). Repository source
layers, caches and the temporary browser aliases are described in
[model repositories](docs/model-repositories.md).

Mermaid, PlantUML, GraphML and HTML generation, Java/JRE configuration and the
legacy GLSP WebSocket transport are intentionally out of scope.
