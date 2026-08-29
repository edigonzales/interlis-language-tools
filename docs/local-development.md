# Lokale Entwicklung von LSP und VS-Code-Extension

Diese Anleitung beschreibt den normalen Entwicklungsweg für den Language
Service, den LSP und die VS-Code-Extension. Java wird dafür nicht benötigt.

## Voraussetzungen

Die drei Repositories liegen als Geschwisterverzeichnisse vor:

```text
ilic-fork/
interlis-language-tools/
interlis-web-ide/
```

Benötigt werden:

- Node.js 22 oder neuer;
- Corepack mit pnpm 11.14.0 (die Version ist im `package.json` gepinnt);
- Git und CMake 3.20 oder neuer;
- VS Code 1.96 oder neuer für den Extension-Host;
- beim ersten WASM-Build Netzwerkzugriff und Schreibrechte für das SDK-Verzeichnis.

Auf macOS werden zusätzlich die Xcode Command Line Tools benötigt. Java oder
ein JDK ist für den normalen Compiler-, LSP- und Extension-Build nicht nötig.

## Einmaliger Setup

Zuerst wird der Compiler als WASM gebaut:

```sh
cd ../ilic-fork
./scripts/build-wasm.sh
```

Das Skript liest die erwartete Emscripten-Version aus der Datei
[`.emscripten-version`](https://github.com/edigonzales/ilic-fork/blob/main/.emscripten-version)
(aktuell 3.1.64). Es verwendet ein passendes `emcc` aus dem `PATH` oder richtet
ein gepinntes SDK automatisch unter `../emsdk` ein. Ein anderer SDK-Pfad kann
mit `ILIC_EMSDK_DIR` gesetzt werden. Automatische Installation lässt sich mit
`ILIC_WASM_AUTO_SETUP=0` abschalten; dann muss ein passendes SDK bereits
aktiviert sein.

Danach werden die Language-Tools-Abhängigkeiten installiert:

```sh
cd ../interlis-language-tools
corepack pnpm install --frozen-lockfile
```

Der lokale Lockfile verweist `@ilic/compiler-wasm` und `@ilic/tools` direkt auf
`../ilic-fork`. Es ist deshalb kein manuelles Kopieren von npm-Paketen nötig.

## WASM-Artefaktfluss

`build-wasm.sh` erzeugt und aktualisiert nur die generierten Compiler-Dateien:

```text
ilic-fork/build/wasm/ilic.mjs
ilic-fork/build/wasm/ilic.wasm
        │
        └── Kopie nach packages/compiler-wasm/
            ├── ilic.mjs
            └── ilic.wasm
```

`index.js`, `worker.js`, `index.d.ts`, `package.json` und die Dokumentation des
Pakets sind versionierte Quelldateien. Sie werden nicht vom WASM-Build erzeugt
und müssen nicht kopiert werden. Für npm-Staging gibt es separat
`node scripts/prepare-npm-snapshot.mjs`; dieses schreibt nach `build/npm/`.

Beim Extension-Build werden die JavaScript-Glue-Dateien in die Server-Bundles
eingebunden und `ilic.wasm` nach `apps/vscode-extension/dist/ilic.wasm`
kopiert. F5 kompiliert WASM nicht automatisch.

## Language Service und LSP prüfen

Für reine Language-Service- oder LSP-Änderungen genügen die normalen TypeScript-
und Paketbefehle:

```sh
corepack pnpm --filter @ilic/language-service test
corepack pnpm --filter @ilic/language-server test
corepack pnpm build
```

Es gibt keinen separaten LSP-Daemon-Befehl für die VS-Code-Entwicklung. Der
Desktop-Extension-Host startet den Node-LSP; VS Code Web startet den Browser-
Worker-LSP. Beide verwenden denselben Language-Server-Code.

## VS-Code-Extension starten

1. Den Ordner `interlis-language-tools` als Workspace-Root öffnen.
2. In **Run and Debug** `INTERLIS Extension (Desktop)` oder
   `INTERLIS Extension (Web)` auswählen.
3. F5 drücken.

Die Prelaunch-Task `build language tools` baut TypeScript und die Extension,
deaktiviert die alte Java-Extension im Development Host und öffnet
`examples/dev-workspace`. Für einen manuellen WASM-Neubau steht zusätzlich der
Task **build compiler WASM** zur Verfügung.

Nach C++- oder WASM-Änderungen:

```sh
cd ../ilic-fork
./scripts/build-wasm.sh

cd ../interlis-language-tools
# danach F5 oder den Task „build language tools“ ausführen
```

Nach reinen TypeScript-Änderungen ist kein WASM-Neubau erforderlich.

## Repository-Modelle

Repository-Auflösung gehört nicht zum WASM-Modul. Das separate Paket
`@ilic/tools` übernimmt im Node-LSP `NodeFileCache` und in VS Code Web
`BrowserCache`. Es löst Kataloge und `.ili`-Quellen auf; der Host übergibt diese
Quellen anschliessend an die WASM-Compiler-Session.

## Vollständige lokale Checks

```sh
cd ../interlis-language-tools
corepack pnpm check
corepack pnpm --filter @ilic/language-service test:coverage
corepack pnpm pack:verify
corepack pnpm package:vsix
```

`pack:verify` und `package:vsix` sind für die tägliche F5-Schleife nicht nötig,
prüfen aber die installierbaren npm-Pakete und das VSIX vollständig.
