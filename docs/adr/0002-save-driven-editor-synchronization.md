# ADR 0002: Save-driven Synchronisation von Editor, OUTLINE und Diagramm

Status: accepted

## Kontext

Eine `.ili`-Datei wird gleichzeitig in mehreren Projektionen dargestellt:

- als Text im offenen Editor;
- als Dokumentstruktur im VS-Code-OUTLINE;
- als semantisches UML-Diagramm;
- als Compiler-Output und Problems-Diagnostik.

Diese Projektionen haben unterschiedliche Lebenszyklen. VS Code fordert
Dokumentsymbole nach einer Textänderung an und cached das Resultat für die
jeweilige Dokumentversion. Ein anschliessendes Speichern erzeugt keine weitere
Textänderung. Das LSP definiert zudem keine standardisierte Notification zum
Aktualisieren von Document Symbols. Eine sofortige leere Antwort während des
Tippens kann deshalb als leeres OUTLINE für diese Dokumentversion bestehen
bleiben.

Der WASM-Compiler verwendet eine gemeinsame Session und wird global
serialisiert. Semantische Ergebnisse dürfen trotzdem nicht global behandelt
werden: Eine Kompilation von Modell B darf den gültigen Zustand von Modell A
nicht verdrängen.

## Entscheidung

Semantische Analyse bleibt nach dem initialen Laden grundsätzlich save-driven.
Beim Öffnen eines gespeicherten, editierbaren INTERLIS-Dokuments fordert die
VS-Code-Extension genau eine Kompilation mit dem Trigger `open` für die Root-URI
samt transitiven Abhängigkeiten an. Das gilt für Desktop- und Browser-URIs;
`untitled:` und schreibgeschützte `interlis-repository:`-Dokumente sind
ausgeschlossen. Ein beim Start bereits aktives Dokument verwendet weiterhin
den Trigger `startup`.

Nach dieser initialen Kompilation aktualisiert Tippen nur die effektive Quelle.
Ein Save oder ein expliziter manueller Compile kompiliert die Root-URI erneut.
Eine Änderung oder ein Save, die einen noch ausstehenden Open-Lauf überholen,
verwerfen dessen Resultat nach denselben Regeln wie andere automatische
Kompilationen.

Eine eng begrenzte Ausnahme gilt beim ersten Öffnen eines Diagramms: Existiert
für eine nichtleere, gespeicherte Root-URI noch kein semantischer Snapshot,
fordert die Extension genau eine deduplizierte Kompilation mit dem Trigger
`diagram` an. Bereits analysierte oder ungespeicherte Dokumente lösen dadurch
keine zusätzliche Kompilation aus.

Der Language Service verwaltet semantischen Zustand pro Root-URI:

- `current`: das zuletzt akzeptierte Ergebnis, auch wenn die Kompilation
  fachlich ungültig war;
- `lastGood`: der letzte gültige Snapshot für stabile UI-Projektionen;
- `latestRequestedRunId`: die neueste für dieses Root angeforderte
  Kompilation.

Die gemeinsame WASM-Session bleibt global serialisiert. Ein Resultat wird nur
publiziert, wenn für dasselbe Root keine neuere Kompilation angefordert wurde,
die beteiligten effektiven Source-Revisionen noch dem vollständigen
Compiler-Versionsvektor entsprechen und der Lauf nicht abgebrochen wurde.
Überholte Resultate erzeugen weder Notifications noch UI-Updates.

### Quellen und Invalidierung

Die effektive Quelle einer URI folgt dieser Priorität:

1. offener Editorbuffer;
2. gespeicherte Workspace-Datei;
3. Repository-Quelle.

Eine serviceeigene Source-Revision ändert sich nur bei verändertem Inhalt. Ein
Watcher-Echo für eine offene Datei aktualisiert lediglich die gespeicherte
Hintergrundquelle; der offene Buffer bleibt autoritativ und der semantische
Snapshot frisch. Beim Schliessen wird nur dann invalidiert, wenn der nun
sichtbare darunterliegende Inhalt tatsächlich abweicht.

Änderungen markieren nur Root-Snapshots als `stale`, deren Versionsvektor die
geänderte URI enthält. Nicht zuordenbare Source-Additions, Löschungen und
Repository-Wechsel invalidieren vorhandene Root-Snapshots konservativ. Der
`lastGood`-Snapshot wird dabei nicht gelöscht.

| Ereignis                             | Semantischer Zustand                                                                                          | Sichtbare Projektion                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Öffnen eines gespeicherten Dokuments | Ein `open`-Lauf erzeugt den initialen Root-Snapshot; `untitled:` und Repository-Dokumente bleiben ausgenommen | Compiler-Output, Problems, OUTLINE und offene Diagramme erhalten denselben atomaren Stand                          |
| Tippen oder Rename                   | Betroffene `current`- und gespeicherte Snapshots werden `stale`; `lastGood` bleibt bestehen                   | OUTLINE wartet auf Analyse; offene betroffene Diagramme behalten SVG und Viewport und werden als veraltet markiert |
| Save                                 | Keine zweite Invalidierung; ein gültiges Resultat ersetzt `current` und `lastGood` atomar                     | OUTLINE erhält neue Symbole; offene betroffene Diagramme werden neu gelayoutet                                     |
| Ungültiger Save                      | Das Fehlerresultat wird `current`; `lastGood` bleibt bestehen                                                 | Das vorherige OUTLINE bleibt sichtbar; Diagramme behalten SVG und Viewport und zeigen einen Fehlerstatus           |
| Watcher-Echo einer offenen Datei     | Nur die Workspace-Hintergrundquelle wird nachgeführt                                                          | Kein Flackern und keine erneute Invalidierung                                                                      |
| Überholte Kompilation                | Das Resultat wird verworfen                                                                                   | Keine Notification und kein UI-Update                                                                              |

### Rename

Ein semantischer Rename ändert die Deklaration, alle Referenzen und den
korrespondierenden Namen in `END <Name>`. Edits werden pro URI und Range
dedupliziert. Dadurch bleibt das gespeicherte Modell nach dem Rename syntaktisch
und semantisch gültig und kann einen neuen OUTLINE-Snapshot erzeugen.

### OUTLINE

Der LSP-Handler für `textDocument/documentSymbol` antwortet sofort aus der
lebenden Outline des Language Service:

1. Ein gültiger semantischer Snapshot aktualisiert die sticky Baseline pro URI.
2. Nach einer Textänderung wird aus dem aktuellen Syntaxbaum eine neue Outline
   erzeugt und mit der Baseline zusammengeführt.
3. Eine temporär unvollständige oder fehlerhafte Deklaration leert die Outline
   nicht; weiterhin gültige Namen und Bereiche bleiben sichtbar.
4. Request-Cancellation liefert ebenfalls die aktuelle Projektion statt einer
   leeren Liste.

Das Diagramm ist als optionaler `CustomEditorProvider` mit eigenem
`CustomDocument` für dieselbe `.ili`-URI registriert. Das Custom Document
enthält nur URI und Lifecycle; die Quelle bleibt ein normales
`vscode.TextDocument` und wird vom LanguageClient synchronisiert. Beim
Fokuswechsel zwischen Text und Diagramm bleibt deshalb der Dokumentkontext
erhalten und VS Code behält die zugehörige Outline. Pro Extension Host werden
Custom Document und Diagramm-Panels aus der URI und dem aktuellen
`TextDocument` rehydriert; ein anderer VS-Code-Host darf keinen Zustand des
ursprünglichen Fensters voraussetzen.

### Diagramm

Jedes akzeptierte Kompilationsergebnis erzeugt die Server-Notification
`interlis/semanticSnapshotChanged`. Sie enthält `runId`, `trigger`, `rootUri`,
die Editorversion, Snapshot-Generation, Erfolg/Freshness und die beteiligten
Source-URIs.

Bereits offene Diagramme reagieren wie folgt:

- Fehlt beim ersten Diagrammzugriff ein gespeicherter Snapshot, wird eine
  URI-basierte Single-Flight-Kompilation mit Trigger `diagram` abgewartet und
  der Snapshot danach einmal erneut angefordert.
- Ein frischer gültiger Snapshot des eigenen Roots wird automatisch neu
  angefordert, gelayoutet und dargestellt.
- Enthält der letzte gültige Diagramm-Snapshot die gespeicherte URI als
  transitive Abhängigkeit, startet die Extension genau eine deduplizierte
  Kompilation mit dem Trigger `dependency`.
- Dependency-Kompilationen aktualisieren Snapshots und Problems, ersetzen aber
  nicht Compiler-Output oder Status des explizit gespeicherten Modells.
- Ungültige oder stale Resultate behalten das letzte gültige SVG und den
  verankerten Viewport. Nur der Status wird aktualisiert.
- Eine laufende Request-ID und die Snapshot-Generation verhindern, dass später
  eintreffende ältere Requests eine neuere Darstellung überschreiben.

Automatisch aktualisiert werden ausschliesslich bereits offene Diagramme. Es
werden keine Panels als Nebeneffekt eines Saves geöffnet; der manuelle Befehl
`Refresh / Auto-layout` bleibt verfügbar.

## Konsequenzen

- Gespeicherte editierbare Dokumente liefern beim Öffnen sofort Compiler-Output
  und Problems, ohne einen vorherigen Save oder manuellen Compile.
- UI-Projektionen bleiben während des Tippens stabil, können aber bewusst als
  veraltet markiert sein.
- Ein Save ist die atomare Grenze, an der Compilerzustand und sichtbare
  semantische Projektionen erneuert werden.
- Root-spezifische Snapshots und Diagnostik können nebeneinander bestehen.
- Watcher, Editor und Repository dürfen dieselbe URI melden, ohne bei
  identischem effektivem Inhalt zusätzliche Analysen auszulösen.
- Hosts ohne LSP, insbesondere Monaco, verwenden dieselben root-spezifischen
  Snapshots; die synchronen Provider greifen ebenfalls auf den passenden Root
  zurück.

## Verifikation

Unit- und Vertragstests decken Open-Kompilationen für Desktop- und Web-URIs,
die Ausschlüsse für Untitled- und Repository-Dokumente, Root-Isolation,
Versionsvektoren, Watcher-Echos, Cancellation, ungültige Saves, abhängige
Diagramme, Deduplizierung sowie überholte Requests ab. Die Diagrammtests decken
zusätzlich den `CustomDocument`-Lifecycle, unabhängige Fenster-Workflows,
mehrere Panels pro URI, eigene Viewports und die Rehydrierung nach einem
abgebrochenen alten Refresh ab. Die Desktop-Abnahme für „Move into New
Window“ ist in [`docs/testing.md`](../testing.md) beschrieben. Ein
Bundle-Integrationstest führt mit dem realen WASM-Compiler einen Rename durch,
wendet beide INTERLIS-Namensstellen an und prüft anschliessend einen
Document-Symbol-Request in der oben beschriebenen VS-Code-Reihenfolge.
