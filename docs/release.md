# Versionierung und Release

Die fünf npm-Pakete erhalten immer eine gemeinsame Version:

```text
stabil:    X.Y.Z        Tag vX.Y.Z
Snapshot:  X.Y.Z-snapshot.g<erste 12 Zeichen des Language-Tools-SHA>
```

Der vollständige SHA, GitHub-Run-ID, Buildzeit, Toolchain und die exakten
Compiler-Abhängigkeiten stehen in `interlis-release.json`. Jeder Tarball
enthält dieses Manifest und einen vollständigen `gitHead`.

## Compiler-Lock übernehmen

`release/dependencies.lock.json` ist die einzige Releasequelle für
`@ilic/repository-core`, `@ilic/tools` und `@ilic/compiler-wasm`. Eine neue
Compiler-Publikation startet dieses Repository nicht automatisch.

```sh
node scripts/release-metadata.mjs update-compiler \
  --version <exakte-publizierte-version> \
  --source-sha <vollständiger-ilic-sha>
node scripts/release-metadata.mjs check
```

Die drei Compiler-Pakete müssen dieselbe Version und denselben SHA besitzen.
Die Änderung wird geprüft und committet, bevor ein Language-Tools-Snapshot
entsteht. Der derzeitige Lock enthält noch einen unveränderlichen historischen
Zeitstempel-Snapshot; neue Versionen verwenden ausschliesslich das
SHA-basierte Format.

## Prüfungen

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm pack:verify
corepack pnpm package:vsix
corepack pnpm licenses:check
corepack pnpm security:check
```

Der Publish-Workflow checkt zusätzlich den gelockten Compiler-SHA aus, prüft
dessen npm-`gitHead`, baut Native und WASM und installiert die fünf erzeugten
Tarballs in einem leeren Consumer. Interne Abhängigkeiten mit `workspace:*`,
`file:`, Dist-Tag oder Versionsbereich werden abgewiesen.

## Snapshot

1. Compiler-Lock und Basisversion auf einem grünen Main-Commit prüfen.
2. **Publish language-tools packages** manuell auf `main` starten. Der Workflow
   publiziert die fünf Pakete unter npm-`snapshot`.
3. **Publish VS Code extension** separat manuell starten. Der Workflow erzeugt
   einen SHA-basierten VSIX-Prerelease und publiziert ihn auf Open VSX.
4. Paketversionen, `gitHead`, npm-Provenienz und Workflow-Artefakte prüfen.
5. Eine Web-IDE-Übernahme erfolgt danach nur durch einen eigenen Lock-Commit
   im Web-Repository.

Normale CI publiziert nichts.

## Stabiler Release

1. Basisversion und Changelog vorbereiten. Alle drei Compiler-Abhängigkeiten
   müssen stabile `X.Y.Z`-Versionen sein.
2. Alle Prüfungen auf dem Release-Commit ausführen.
3. Das Commit mit dem exakt passenden `vX.Y.Z` taggen und pushen.
4. Der Tag startet npm- und VSIX/Open-VSX-Publikation. npm verwendet `latest`,
   VSIX/Open VSX die stabile numerische Version.
5. Die fünf npm-Pakete, Extension, Provenienz und `gitHead` prüfen; erst danach
   darf die Web IDE diesen Stand übernehmen.

## Authentisierung und Wiederholung

npm verwendet den auf `publish-language-tools.yml` eingeschränkten Trusted
Publisher mit GitHub OIDC und kein `NPM_TOKEN`. Open VSX verwendet dessen
eigenes Publikationsgeheimnis. Für die Web IDE wird kein Cross-Repository-
Dispatch-Geheimnis benötigt.

npm bietet keine Transaktion über fünf Pakete. Ein erneuter Lauf desselben
Commits akzeptiert eine vorhandene Version nur bei identischem vollständigem
`gitHead` und ergänzt fehlende Pakete. Bereits publizierte Versionen werden nie
gelöscht oder überschrieben. Erfordert die Korrektur Quelländerungen, wird
eine neue Version erstellt.
