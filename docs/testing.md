# Tests und Release-Nachweise

Die Gates prüfen sowohl das Quellverhalten als auch installierte Artefakte.
Generierte Dateien gelten nicht allein deshalb als korrekt, weil der Workspace
kompiliert.

## Language Tools

Die wichtigsten lokalen Befehle sind:

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

`pnpm check` enthält Unit-, Adapter-, Versions-, Lock- und Rewrite-Tests.
`pack:verify` installiert die fünf npm-Tarballs in einem sauberen Consumer,
lädt den WASM-Compiler und prüft exakte interne Abhängigkeiten, vollständige
`gitHead`-Werte und `interlis-release.json`. `package:vsix` kontrolliert unter
anderem Identität, Lizenz, Icon, WASM sowie Node- und Browser-Einstiegspunkte.

`test:extension-host` startet eine isolierte VS-Code-Instanz und prüft
Completion, Snippets, Live-Diagnostik, Quick Fixes, Navigation und Rename auf
ungespeicherten Dokumenten. `test:installed-extension` wiederholt den Smoke-Test
mit der tatsächlich gepackten und installierten VSIX.

Der Coverage-Bericht verlangt derzeit als Ziel 90 % für Statements, Zeilen und
Funktionen sowie 85 % für Branches. CI und npm-Publishing erzeugen ihn, das
Threshold-Gate ist aber vorübergehend nicht blockierend. Fehlende Pfade werden
als Issues geführt.

`test:repository-network` ist ein opt-in Smoke-Test für die temporären CORS-
Mirrors. Deterministische Unit- und Release-Prüfungen benötigen kein öffentliches
Netzwerk.

## Upstream-Compiler und Web IDE

`ilic-fork` prüft native APIs, Compilerregressionen, WASM-ABI,
Repository-Auflösung und Warm-Cache-Verhalten. Die Web IDE prüft Workspace,
Repository und Git mit Vitest sowie OPFS, Recovery, ZIP, lokales Git, Compiler,
Diagramm, SVG, DOCX und Offline-PWA mit Playwright. Der öffentliche SOGIS-Clone
ist lokal opt-in und läuft zusätzlich geplant:

```sh
pnpm check
pnpm e2e
pnpm e2e:public-clone --project chromium
```

Unter WebKit kann der für OPFS notwendige persistente Kontext die
`CacheStorage`-Offline-Navigation im Runner nicht zuverlässig prüfen. Dieser
eine Pfad läuft in Chromium und Firefox; die übrigen WebKit-Szenarien bleiben
aktiv.

## Manuelle Diagramm-Abnahme in VS Code Desktop

Für die fensterübergreifende Synchronisation ist zusätzlich ein kurzer
manueller Test nötig:

1. `.ili`-Datei und Diagramm öffnen, Diagramm mit **Move into New Window** in
   ein zweites Fenster verschieben.
2. Gültige und ungültige Änderungen speichern; Stale-Markierung, letztes
   gültiges SVG und anschliessende Aktualisierung prüfen.
3. Eine importierte Abhängigkeit ändern und die transitive Aktualisierung
   prüfen.
4. Knotennavigation, Layout, Zoom/Pan und SVG-Export prüfen; auf macOS zusätzlich
   Trackpad-Pan und Pinch-to-Zoom.

## Erforderliche Release-Evidenz

- alle zum Artefakt gehörenden Gates sind grün;
- npm-Tarballs enthalten keine Workspace-Links und nur exakt gelockte interne
  Versionen;
- die VSIX installiert in VS Code Desktop und VS Code Web;
- dasselbe Server-Paket startet in einem kompatiblen Theia-Host;
- Marketplace und Open VSX behalten die ID
  `edigonzales.interlis-language-tools`;
- die Web IDE startet einmal online und lässt sich danach offline neu laden.
