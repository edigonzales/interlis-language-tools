# Live-Diagnostik und Navigation bei ungespeicherten Änderungen

Diese Anleitung beschreibt die Editorfunktionen für INTERLIS 2.3 und 2.4,
während eine Datei noch ungespeicherte Änderungen enthält. Die vollständige
Compileranalyse bleibt bewusst an Speichern und den Befehl **Compile Model**
gebunden.

Die unmittelbaren Eingabehilfen sind davon getrennt. Wo Vorschläge erscheinen
und wie Enter, Tab, Placeholder und das automatische Blockende funktionieren,
beschreibt die Anleitung
[Completion, Snippets und automatisches Blockende](completion-und-snippets.md).

## Zwei getrennte Analysewege

| Auslöser                         | Analyse                                            | Sichtbares Ergebnis                                                       |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| 250 ms Tipp-Pause                | kompakter `EditorSnapshot` in einem eigenen Worker | konservative Problems, Completion, Outline, Hover und Navigation          |
| Speichern oder **Compile Model** | vollständiger ilic-Compilerlauf                    | Compiler- und persistierte `ilic-lint`-Problems, Compiler-Output, Semantik, Diagramm und DOCX-Daten |

Der Live-Worker kann Speichern oder einen manuellen Compile nicht blockieren.
Jede Anfrage trägt die Dokumentversion. Trifft ein älteres Ergebnis nach einer
neueren Eingabe ein, wird es verworfen.

Nach dem Speichern bleiben konservative Lint-Warnungen wie ein unbenutzter
Import für die gespeicherte Dokumentversion in Problems sichtbar. Sie werden
zusammen mit den Compiler-Diagnostics veröffentlicht, aber nicht in den
Compiler-Output oder dessen `warningCount` aufgenommen.

Benötigt die Editoranalyse dauerhaft zu lange oder fällt ihr Worker aus,
wechselt die Erweiterung automatisch auf die weiterhin funktionierende
save-basierte Analyse. Der INTERLIS-Sprachstatus zeigt diesen Zustand
unaufdringlich an; es erscheint keine Serie technischer Parserfehler.

## Welche Live-Probleme erscheinen

Die Einstellung `interlisLanguageTools.liveDiagnostics` steht standardmässig
auf `conservative`. In diesem Modus werden nur abgeschlossene, eindeutige Fälle
markiert:

- ein falscher Name hinter `END`;
- eine zweite gleichnamige Deklaration im selben Container;
- ein Attribut ohne Kopf, Typ oder abschliessendes Semikolon;
- eine abgeschlossene unbekannte oder noch nicht sichtbare Referenz;
- ein sicher unbenutzter Import.

Unvollständige Tokens, offene Strings, Inhalte von Strings,
`!!`-Zeilenkommentare, noch bearbeitete Snippet-Köpfe und ein Pfad wie
`Model.` bleiben ohne Fehlermarkierung. `/** ... */`-Dokumentationskommentare
sind im Live-Scanner dagegen noch nicht vollständig lexikalisch abgesichert.
Enthalten sie Text, der wie eine Deklaration aussieht, kann die Live-Analyse
diesen im aktuellen Stand irrtümlich als Code behandeln. Speichern oder
**Compile Model** liefert auch in diesem Fall die autoritative
Compilerdiagnostik. Rohe Parser-Folgefehler werden nicht als Live-Problems
veröffentlicht.

Mit `interlisLanguageTools.liveDiagnostics = off` werden Live-Problems
deaktiviert. Completion und der kompakte Editor-Snapshot bleiben davon
unabhängig; nach Speichern oder manuellem Compile erscheinen weiterhin die
vollständigen Compilerdiagnosen.

## Quick Fixes

Für deterministische Änderungen bietet der Editor **Quick Fix** an:

| Problem                                    | Quick Fix                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| fehlendes `;` nach einem fertigen Attribut | `;` an der ermittelten Position einfügen                                                     |
| `END FalscherName;`                        | Namen durch den Namen des geöffneten Blocks ersetzen                                         |
| sicher unbenutzter Import                  | genau diesen Import samt passendem Komma beziehungsweise die leere `IMPORTS`-Zeile entfernen |

Quick Fixes werden nur für genau die Dokumentversion angeboten, aus der das
Problem stammt. Speichern bleibt danach der autoritative syntaktische und
semantische Nachweis.

## Definition, Referenzen und Hover im Dirty-Code

Deklarationen und Referenzen werden aus den aktuellen Editor-Snapshots
aufgelöst. Das gilt auch für mehrteilige Pfade:

```ili
CLASS Child EXTENDS Base.Data.Root =
```

- Ctrl/Cmd-Klick auf `Base` navigiert zum Modell `Base`.
- Ctrl/Cmd-Klick auf `Root` navigiert zur Klasse `Base.Data.Root`.
- Hover zeigt Art und qualifizierten Namen des genau getroffenen Segments.

Lokale Vorwärtsreferenzen bleiben ausgeschlossen. Deklarationen aus einer
anderen aktuellen Workspace-Datei sind nur sichtbar, wenn das Modell in der
aktuellen `IMPORTS`-Liste steht; für einen unqualifizierten Namen ist zusätzlich
`UNQUALIFIED` erforderlich. Repository- und andere externe Symbole stammen
ausschliesslich aus dem letzten erfolgreichen Compilerstand und werden
ebenfalls durch die aktuelle `IMPORTS`-Liste gefiltert.

## Konservativer Rename im Dirty-Code

Ein Rename bei ungespeicherten Änderungen wird nur ausgeführt, wenn das Ziel
und die vom Live-Index erkannten betroffenen aktuellen Dateien eindeutig sind.
Der Live-Index erfasst derzeit Referenzen in `EXTENDS`, Typangaben,
`LIST/BAG OF`, `REFERENCE TO`, Unit-Ausdrücken und `IMPORTS` sowie
qualifizierte Modellpräfixe. Für diese erkannten Stellen werden gemeinsam
geändert:

- die Deklaration;
- die vom Live-Index aufgelösten Referenzen;
- der zugehörige Name hinter `END`;
- bei einem Modell-Rename die Modellsegmente qualifizierter Pfade und
  `IMPORTS`-Einträge.

Nur das betreffende Segment wird ersetzt. Beim Rename von `Root` wird aus
`Base.Data.Root` beispielsweise `Base.Data.NewRoot`, nicht nur `NewRoot`.

Der Rename wird ohne Teiländerung abgebrochen, wenn ein Ziel mehrdeutig ist,
der neue Name im selben Container bereits existiert, ein betroffener Dirty
Snapshot noch aussteht oder eine betroffene editierbare Datei nur aus einem
älteren semantischen Stand bekannt ist. In diesem Fall zuerst die offenen
Dateien analysieren lassen oder speichern und den Rename erneut starten.
Schreibgeschützte Repository-Modelle werden nie geändert.

Referenzen in Constraints, View- und Funktionsausdrücken sowie weiteren
komplexen Konstruktionen sind im Dirty-Code noch nicht vollständig erfasst.
Der Live-Rename garantiert deshalb nicht, jede semantische Referenz der
gesamten INTERLIS-Sprache zu finden. Für einen umfassenden projektweiten Rename
das Modell zuerst speichern beziehungsweise kompilieren und den Rename auf dem
aktuellen Compilerstand ausführen.

## Bewusste Grenzen

- Live-Diagramme, DOCX-Export und vollständige Typprüfung verwenden weiterhin
  ausschliesslich den letzten Save-/Compile-Stand.
- INTERLIS 1 erhält in diesem Ausbau keine semantische Live-Analyse.
- Die Live-Diagnostik soll frühe, sichere Hinweise geben; sie ersetzt nicht den
  vollständigen Compilerlauf.

## Automatisierter Nachweis

Die Tests prüfen unter anderem Recovery, Unicode-Offsets, Import-Sichtbarkeit,
mehrere aktuelle Dateien, qualifizierte Pfadsegmente, Worker-Neustart und 100
schnelle Änderungen. Für den kompakten Compiler-Snapshot gelten feste
Performance-Gates: unter 150 ms für ungefähr 12 KB und unter 750 ms für
ungefähr 80 KB. `didChange` selbst bleibt unter 16 ms, weil die Analyse erst
asynchron im zweiten Worker erfolgt.
