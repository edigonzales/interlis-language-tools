# Build- und Publikationspipeline

[Projektübersicht](../README.md) · [Release-Betrieb](release.md) ·
[Teststrategie](testing.md)

## Einfaches Modell

```text
release/dependencies.lock.json
       │ exakte Compiler-Version + voller ilic-SHA
       ▼
ilic aus genau diesem Commit bauen und testen
       │
       ▼
Language Tools bauen und testen
       │
       ▼
5 Tarballs mit gemeinsamer Version + interlis-release.json
       │
       ├─ normale CI: nur geprüfte Artefakte
       ├─ manueller Lauf: npm-Tag snapshot
       └─ neuer vX.Y.Z-Tag: npm-Tag latest
```

Der wesentliche Vertrag ist im Downstream-Commit enthalten. Ein beweglicher
npm-Tag oder der aktuelle Stand von `ilic/main` bestimmt keine Abhängigkeit
mehr. Ein neuer Compiler verlangt zuerst eine Änderung von
`release/dependencies.lock.json` und damit einen neuen Language-Tools-Commit.

## Workflows

| Workflow                       | Auslöser                                   | Wirkung                                                                                                  |
| ------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `ci.yml`                       | Push, Pull Request, manuell                | Lock prüfen, exakt gelockten Compiler-WASM bauen, Workspace/VSIX/fünf Tarballs testen; keine Publikation |
| `publish-language-tools.yml`   | manueller Snapshot oder neuer `vX.Y.Z`-Tag | Compiler nativ und als WASM prüfen, fünf Tarballs publizieren                                            |
| `publish-vscode-extension.yml` | manueller Snapshot oder neuer `vX.Y.Z`-Tag | dieselbe Compiler-Kombination als VSIX bauen und zu Open VSX publizieren                                 |

Es gibt keinen `workflow_run` nach jedem grünen Main-Build und keinen
Compiler-Dispatch, der automatisch fünf neue Downstream-Versionen erzeugt.

## Reproduzierbare Identitäten

Ein Snapshot aus Commit `abcdef012345...` und Basis `0.1.2` heisst in npm und
Open VSX immer:

```text
0.1.2-snapshot.gabcdef012345
```

Datum und GitHub-Run-ID gehören in die Provenance, nicht in die Version. Alle
fünf Language-Tools-Pakete verwenden dieselbe Version. Ihre Abhängigkeiten auf
`@ilic/compiler-wasm` und `@ilic/tools` sind die exakten unveränderlichen
Versionen aus dem Lock.

Jeder Tarball enthält:

- `package.json` mit vollständigem `gitHead`;
- `interlis-release.json` mit vollem Language-Tools-SHA;
- genaue Compiler-Versionen und vollständigen ilic-SHAs;
- Run-ID, Zeitpunkt und Node-Toolchain.

## Cache- und Source-Rolle

Für JavaScript-Pakete ist npm der Cache bereits veröffentlichter
Abhängigkeiten. Trotzdem baut die Produzentenprüfung den gelockten ilic-Commit
erneut nativ und als WASM. Damit beschleunigt der veröffentlichte Compiler die
Installation eines Tarball-Consumers, ersetzt aber nicht die Source-Prüfung vor
einer Language-Tools-Publikation.

## Berechtigungen

| Berechtigung oder Secret | Zweck                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `contents: read`         | beide Quellen exakt auschecken                              |
| `id-token: write`        | nur im npm-Publish-Job für Trusted Publishing               |
| `RELEASE_DISPATCH_TOKEN` | optionale Übergabe der publizierten Version an das Web IDE  |
| `OVSX_PAT`               | manuelle oder taggebundene Open-VSX-Publikation             |
| `VSCE_PAT`               | reserviert; Marketplace-Publikation ist derzeit deaktiviert |

Es gibt kein npm-Token im Repository. Fehlt der optionale Web-IDE-Token, bleiben
die korrekt publizierten npm-Pakete erfolgreich; nur die nachgelagerte Übergabe
entfällt.

## Recovery

- Vor einem vollständig grünen Build wird nichts publiziert.
- Eine vorhandene npm-Version wird nur als idempotent akzeptiert, wenn ihr
  `gitHead` dem erwarteten vollen Commit entspricht.
- Bei einem Teilfehler denselben Commit erneut ausführen. Die Git-basierte
  Version bleibt identisch und bereits publizierte Pakete werden validiert und
  übersprungen.
- Nie eine bestehende Version unpublishen oder einen Tag verschieben.
- Der npm-Tag `snapshot` bezeichnet nur Vorabversionen; `latest` nur stabile
  `X.Y.Z`-Versionen.
