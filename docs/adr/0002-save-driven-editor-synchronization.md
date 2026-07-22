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

Semantische Analyse bleibt save-driven. Öffnen und Tippen aktualisieren nur die
effektive Quelle; sie starten keine Kompilation. Ein Save oder ein expliziter
manueller Compile kompiliert genau eine Root-URI samt transitiven Abhängigkeiten.

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

| Ereignis                         | Semantischer Zustand                                                                        | Sichtbare Projektion                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tippen oder Rename               | Betroffene `current`- und gespeicherte Snapshots werden `stale`; `lastGood` bleibt bestehen | OUTLINE wartet auf Analyse; offene betroffene Diagramme behalten SVG und Viewport und werden als veraltet markiert |
| Save                             | Keine zweite Invalidierung; ein gültiges Resultat ersetzt `current` und `lastGood` atomar   | OUTLINE erhält neue Symbole; offene betroffene Diagramme werden neu gelayoutet                                     |
| Ungültiger Save                  | Das Fehlerresultat wird `current`; `lastGood` bleibt bestehen                               | Das vorherige OUTLINE bleibt sichtbar; Diagramme behalten SVG und Viewport und zeigen einen Fehlerstatus           |
| Watcher-Echo einer offenen Datei | Nur die Workspace-Hintergrundquelle wird nachgeführt                                        | Kein Flackern und keine erneute Invalidierung                                                                      |
| Überholte Kompilation            | Das Resultat wird verworfen                                                                 | Keine Notification und kein UI-Update                                                                              |

### Rename

Ein semantischer Rename ändert die Deklaration, alle Referenzen und den
korrespondierenden Namen in `END <Name>`. Edits werden pro URI und Range
dedupliziert. Dadurch bleibt das gespeicherte Modell nach dem Rename syntaktisch
und semantisch gültig und kann einen neuen OUTLINE-Snapshot erzeugen.

### OUTLINE

Der LSP-Handler für `textDocument/documentSymbol` verwendet
`waitForDocumentSymbols(uri, documentVersion, signal)`:

1. Für einen frischen Snapshot der exakten Editorversion antwortet er sofort.
2. Nach einer Textänderung bleibt die Anfrage bis zum Save oder manuellen
   Compile dieser Version offen. VS Code behält währenddessen sein vorheriges
   OUTLINE.
3. Eine neuere Textversion, Request-Cancellation oder das Schliessen des
   Dokuments entfernt den alten Waiter.
4. Ein gültiger Compile liefert Namen und Ranges aus dem neuen Snapshot. Bei
   einem ungültigen Compile bleibt die Projektion aus `lastGood` erhalten.

Die Reihenfolge

```text
didChange → documentSymbol → didSave → compilation → symbol response
```

ist damit ausdrücklich unterstützt. Sie ist der normale VS-Code-Ablauf und
kein Sonderfall.

### Diagramm

Jedes akzeptierte Kompilationsergebnis erzeugt die Server-Notification
`interlis/semanticSnapshotChanged`. Sie enthält `runId`, `trigger`, `rootUri`,
die Editorversion, Snapshot-Generation, Erfolg/Freshness und die beteiligten
Source-URIs.

Bereits offene Diagramme reagieren wie folgt:

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

Unit- und Vertragstests decken Root-Isolation, Versionsvektoren,
Watcher-Echos, Cancellation, ungültige Saves, abhängige Diagramme,
Deduplizierung sowie überholte Requests ab. Ein Bundle-Integrationstest führt
mit dem realen WASM-Compiler einen Rename durch, wendet beide INTERLIS-
Namensstellen an und prüft anschliessend einen Document-Symbol-Request in der
oben beschriebenen VS-Code-Reihenfolge.
