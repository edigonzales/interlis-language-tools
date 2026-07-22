# INTERLIS Language Tools

Java-free INTERLIS 2.3/2.4 language tooling for VS Code Desktop, VS Code Web,
Theia and browser-based Monaco IDEs. The public packages start on the
`0.1.0-SNAPSHOT.<UTC timestamp>` line and use the versioned snapshot API in
`@ilic/compiler-wasm@0.9.9-SNAPSHOT.<UTC timestamp>`.

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

Compilation is save-driven. Opening and typing only update the in-memory buffer;
they do not parse, analyze, or compile. Save and the manual compile command run
exactly one root plus its transitive imports and atomically produce compiler
Output, Problems, and editor snapshots. Output is the compiler-owned CLI-style
transcript, including the final error/warning summary; Problems contains the
same diagnostics in structured form. Unsaved changes keep the last result
visible as outdated. Future live language intelligence is tracked in
[BACKLOG.md](BACKLOG.md).

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

Build the pinned compiler WASM once, then install and verify this workspace:

```sh
cd ../ilic-fork
emcc --version
./scripts/build-wasm.sh

cd ../interlis-language-tools
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm --filter @ilic/language-service test:coverage
corepack pnpm pack:verify
corepack pnpm package:vsix
```

For day-to-day extension development, open the `interlis-language-tools`
repository root in VS Code, select either `INTERLIS Extension (Desktop)` or
`INTERLIS Extension (Web)` in **Run and Debug**, and press F5. The pre-launch
task builds all TypeScript packages, disables `edigonzales.interlis-editor` in
the Development Host and opens `examples/dev-workspace`. The example resolves
`LocalCatalog` from the workspace and `Units` from the configured repository.

After C++ or WASM changes, run `../ilic-fork/scripts/build-wasm.sh` again before
F5. Pure TypeScript changes need no separate build. To test the installable
artifact instead:

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

`pack:verify` installs all five language-tool packages plus `@ilic/tools` and
`@ilic/compiler-wasm` in a clean consumer. Published manifests pin every
internal dependency to one immutable timestamped version. Tarballs and VSIX
files are written below `artifacts/` and are never committed.

## Release

CI always produces verified npm tarballs and a universal VSIX. npm publication
uses GitHub OIDC trusted publishing and has no repository secret. Marketplace
publication uses only `VSCE_PAT` and `OVSX_PAT`; a missing secret skips only its
external publish step. See the detailed
[build and publication pipeline](docs/build-und-publikationspipeline.md),
[release process](docs/release.md),
[test strategy](docs/testing.md), [capability matrix](docs/capability-matrix.md)
and [Java-LSP migration](docs/migration-from-java-lsp.md). Repository source
layers, caches and the temporary browser aliases are described in
[model repositories](docs/model-repositories.md).

Mermaid, PlantUML, GraphML and HTML generation, Java/JRE configuration and the
legacy GLSP WebSocket transport are intentionally out of scope.
