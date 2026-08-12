# INTERLIS Language Tools

Java-free INTERLIS 2.3/2.4 language tooling for VS Code Desktop, VS Code Web,
Theia and browser-based Monaco IDEs. The public packages start on the
`0.1.1-SNAPSHOT.<UTC timestamp>` line and consume either stable
`@ilic/compiler-wasm@0.10.0` or an exact
`0.10.0-SNAPSHOT.<UTC timestamp>[.<build-id>]`.

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

Build the pinned compiler WASM once, then install and verify this workspace. The
build script automatically installs and activates the pinned Emscripten SDK when
it is not already available:

```sh
export SNAPSHOT_TIMESTAMP=20260101000000
export COMPILER_VERSION=0.10.0-SNAPSHOT.${SNAPSHOT_TIMESTAMP}
export ILIC_WASM_VERSION=${COMPILER_VERSION}

cd ../ilic-fork
./scripts/build-wasm.sh

cd ../interlis-language-tools
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm --filter @ilic/language-service test:coverage
corepack pnpm pack:verify
corepack pnpm package:vsix
```

`pack:verify` defaults to the deterministic compiler snapshot
`0.10.0-SNAPSHOT.20260101000000`. Stable compiler staging is supported only
when `COMPILER_VERSION` is supplied explicitly. For another snapshot, set
`SNAPSHOT_TIMESTAMP`, `COMPILER_VERSION`, and `ILIC_WASM_VERSION` to the same
identity before rebuilding ilic. Workspace overrides keep all compiler
packages local; registry dist-tags are never release truth.

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

`pack:verify` installs all five language-tool packages plus
`@ilic/repository-core`, `@ilic/tools` and `@ilic/compiler-wasm` in a clean
consumer. Published manifests pin every
internal dependency to one immutable timestamped version. Tarballs and VSIX
files are written below `artifacts/` and are never committed.

## Release

CI always produces verified npm tarballs and a universal VSIX. npm publication
uses GitHub OIDC trusted publishing and has no repository secret. Marketplace
publication uses only `VSCE_PAT` and `OVSX_PAT`. The Open-VSX job runs after a
successful `main` CI workflow and fails visibly when `OVSX_PAT` is missing. See
the detailed
[build and publication pipeline](docs/build-und-publikationspipeline.md),
[release process](docs/release.md),
[test strategy](docs/testing.md), [capability matrix](docs/capability-matrix.md)
and [Java-LSP migration](docs/migration-from-java-lsp.md). Repository source
layers, caches and the temporary browser aliases are described in
[model repositories](docs/model-repositories.md).

Mermaid, PlantUML, GraphML and HTML generation, Java/JRE configuration and the
legacy GLSP WebSocket transport are intentionally out of scope.
