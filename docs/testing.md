# Test strategy

The release gate verifies source behavior and installed artifacts. Generated
files are never trusted merely because the workspace compiles.

## Compiler (`ilic-fork`)

- CMake/CTest covers native APIs, syntax and semantic snapshots, Unicode
  positions, repository resolution and INTERLIS regression models.
- `@ilic/compiler-wasm` executes the documented session and repository examples
  against the real WASM ABI. Its compact editor snapshot additionally enforces
  the 12 KB/150 ms and 80 KB/750 ms latency gates.
- `@ilic/tools` resolves a repository dependency closure.
- Repository tests also cover partial catalog failure and a warm cache with no
  network access.

## Language tools

```sh
pnpm check
pnpm test:extension-host
pnpm test:installed-extension
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
`check` includes deterministic Git-based version and lock/rewrite tests.
`pack:verify` stages and installs the five Language-Tools tarballs in a clean
consumer, loads the WASM compiler, and rejects moving internal dependency
specifications. It also verifies the full `gitHead` and embedded
`interlis-release.json`. `package:vsix` unpacks the extension and asserts its
identity, license, icon, WASM binary and Node/browser client and server entry
points.

`test:extension-host` builds the desktop extension and starts an isolated
VS-Code Extension Host. It executes the documented completion/snippet
workflows, including Enter/Tab-equivalent placeholder navigation,
provider-backed Suggest acceptance, cursor escape from header snippets and
on-type block closing. It also waits for conservative live squiggles, applies a
real Quick Fix and exercises definition, hover and all-occurrence rename on an
unsaved document. On macOS it reuses VSCodium when available; CI downloads the
pinned VS Code 1.96.4 test runtime and runs it under Xvfb.

`test:installed-extension` packages and inspects the VSIX, installs that exact
archive into an isolated extension directory and then runs the same activation,
language-server, diagnostics, Quick Fix, navigation and rename smoke suite from
the installed files.

Language-service tests exercise workspace precedence, transitive repository
sources, exact import navigation, generation cancellation, repository-aware
completion, 100 rapid changes, worker recovery, current imported scopes,
qualified path segments and refusal-safe rename. LSP and Monaco adapter tests
cover live diagnostic provenance, tags, Quick Fix edits, browser aliases and
virtual repository URIs. The F5 example workspace provides the Desktop/Web
Ctrl-click smoke path for `IMPORTS Units`.
The compiler worker forwards native incremental statistics, structured traces
and reset/cache operations without making a second parse decision. Normal
`putSource`/`removeSource` events stay on the current worker; replay counters
increase only after crash or explicit restart and include source count and UTF-8
bytes. The editor worker exposes the same lifecycle counters for its recovery
path.
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

## VS Code Desktop: Diagramm in einem neuen Fenster

Für die Cross-Window-Synchronisation ist zusätzlich eine manuelle Abnahme in
VS Code Desktop erforderlich. Der Diagramm-Editor ist ein read-only
`CustomEditorProvider`; die `.ili`-Quelle bleibt im normalen Texteditor und
wird in jedem Extension Host separat durch den LanguageClient synchronisiert.

1. Eine `.ili`-Datei öffnen und das Diagramm daneben anzeigen.
2. Den Diagramm-Editor mit **Move into New Window** in ein neues VS-Code-
   Fenster verschieben.
3. Die Quelle im ursprünglichen Fenster ändern und speichern. Prüfen, dass das
   Diagramm im neuen Fenster zuerst als stale markiert und nach erfolgreicher
   Synchronisation frisch aktualisiert wird.
4. Einen ungültigen Save ausführen und anschliessend den Quelltext reparieren
   und erneut speichern. Das letzte gültige SVG muss während des Fehlers
   erhalten bleiben und danach wieder aktualisiert werden.
5. Eine importierte Abhängigkeit ändern und speichern. Prüfen, dass das offene
   Diagramm die Abhängigkeit neu kompiliert und anschliessend aktualisiert.
6. Im neuen Fenster Knotennavigation, **Refresh / Auto-layout**, Zoom/Pan und
   SVG-Export prüfen.
7. Auf macOS im Diagramm mit zwei Fingern auf dem Trackpad horizontal und
   vertikal pannen. Pinch-to-Zoom muss an der Cursorposition zoomen; mit einer
   Maus bleibt die mittlere Maustaste zum Pannen und das Scrollrad zum Zoomen
   verfügbar.

## Required release evidence

- all local gates above pass;
- npm tarballs install without workspace links and contain only exact internal
  snapshot dependencies;
- the VSIX installs in VS Code Desktop and VS Code Web;
- the same server package starts in a compatible Theia host;
- Marketplace/Open VSX metadata retains
  `edigonzales.interlis-language-tools`;
- GitHub Pages starts once online and reloads offline.
