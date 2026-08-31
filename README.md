# INTERLIS Language Tools

Javafreie Sprachwerkzeuge für INTERLIS 2.3 und 2.4 in VS Code Desktop, VS
Code Web, Theia und browserbasierten Monaco-Anwendungen.

```text
@ilic/compiler-wasm
        ↓
@ilic/language-service
   ↙          ↘
LSP-Adapter   Monaco-Adapter
   ↓              ↓
VS Code/Theia   Browser-IDE
```

Die Compileranalyse bleibt nach dem ersten Laden speichergetrieben. Eine
separate Editor-Worker-Schicht liefert konservative Live-Diagnostik,
Navigation, Vorschläge und Quick Fixes für ungespeicherte Änderungen, ohne den
Compilerzustand nachzubauen.

## Pakete

| Paket | Aufgabe |
| --- | --- |
| `@ilic/language-service` | Laufzeitneutrale Diagnostik, Navigation, Rename, Formatierung und Snapshots |
| `@ilic/language-server` | Node- und Browser-Worker-LSP sowie INTERLIS-Protokollerweiterungen |
| `@ilic/monaco-adapter` | Direkte Monaco-Provider ohne zweiten JSON-RPC-Server |
| `@ilic/diagram` | Semantisches Diagramm, Layout und SVG-Export |
| `@ilic/docx` | DOCX-Erzeugung aus dem semantischen Snapshot |

Die universelle Extension heisst dauerhaft
`edigonzales.interlis-language-tools`. Sie enthält Desktop- und Browser-
Entrypoints, Compiler-WASM, Sprachressourcen und Themes.

## Entwicklung

Compiler und Language Tools liegen als Geschwisterverzeichnisse vor. Die
Compiler-Version und ihr vollständiger SHA stehen in
`release/dependencies.lock.json`.

```sh
cd ../ilic-fork
./scripts/build-wasm.sh

cd ../interlis-language-tools
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm pack:verify
corepack pnpm package:vsix
```

Die vollständige Einrichtung steht unter
[Lokale Entwicklung](docs/local-development.md). Für die Extension kann danach
im Repository-Root die Desktop- oder Web-Konfiguration mit F5 gestartet werden.

## Release und Abhängigkeiten

Versionen, Compiler-Übernahme, npm, VSIX und Open VSX sind im
[Release-Runbook](docs/release.md) beschrieben. Ein Compiler-Release startet
keine Language-Tools-Publikation, und eine Language-Tools-Publikation deployt
keine Web IDE. Beide Übernahmen erfolgen ausschliesslich durch geprüfte,
committete Locks.

Die Gesamtbeziehungen stehen in der
[zentralen Ökosystemübersicht](https://github.com/edigonzales/ilic-fork/blob/main/docs/ecosystem.md).

Weitere Referenzen:

- [Language Service](docs/language-service.md)
- [LSP](docs/lsp.md)
- [Live-Diagnostik](docs/live-diagnostik-und-dirty-navigation.md)
- [Modell-Repositories](docs/model-repositories.md)
- [Teststrategie](docs/testing.md)
- [Capability-Matrix](docs/capability-matrix.md)

Mermaid-, PlantUML-, GraphML- und HTML-Generierung, Java/JRE-Konfiguration und
der frühere GLSP-WebSocket-Transport gehören nicht zum Projektumfang.
