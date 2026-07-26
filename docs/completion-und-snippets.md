# Completion, Snippets und automatisches Blockende

Diese Anleitung beschreibt die Eingabehilfen für INTERLIS 2.3 und 2.4 in VS
Code, Theia und Monaco. Der Marker `│` zeigt in den Beispielen die
Cursorposition; er gehört nicht zum Modelltext.

## Die Begriffe

- **Completion** ist die kontextabhängige Vorschlagsliste des Editors. Sie
  enthält nur Einträge, die an der aktuellen Stelle sinnvoll sind.
- Ein **Keyword** fügt ein einzelnes INTERLIS-Schlüsselwort wie `EXTENDS` oder
  `TEXT` ein.
- Ein **Completion-Snippet** fügt eine kleine Vorlage ein, zum Beispiel einen
  vollständigen `CLASS`-Block.
- Ein **Placeholder** oder **Tabstop** ist ein noch auszufüllender Bereich im
  Snippet. Der erste Placeholder ist markiert; Tab oder Enter wechselt zum
  nächsten.
- Im **Snippet-Modus** hält der Editor die Placeholder und gespiegelte Namen
  zusammen. Bei `CLASS Gebaeude` wird deshalb auch `END Gebaeude;`
  aktualisiert.
- Das **automatische Blockende** ist keine Completion und kein Snippet. Es
  reagiert auf einen echten Zeilenumbruch nach einem fertigen Blockkopf und
  ergänzt die leere Body-Zeile sowie `END`.

## Wo Vorschläge erscheinen

Die Vorschläge werden aus dem aktuellen, möglicherweise noch unvollständigen
Text ermittelt. Außerhalb eines erkannten Eingabeslots bleibt die Liste leer,
statt allgemeine, aber irreführende Keywords anzubieten.

| Cursorposition                             | Typische Vorschläge                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dokumentwurzel                             | `MODEL` als Keyword und vollständiges MODEL-Snippet                                                                                  |
| MODEL-Body                                 | `TOPIC`, `CLASS`, `STRUCTURE`, `DOMAIN`, `UNIT`, `FUNCTION`, `CONTEXT`, `LINE FORM`                                                  |
| TOPIC-Body                                 | `CLASS`, `STRUCTURE`, `ASSOCIATION`, `VIEW`, `GRAPHIC`, `DOMAIN`, `UNIT`, `FUNCTION`, `CONTEXT`, `CONSTRAINTS`, Basket-Deklarationen |
| Kopf von CLASS/STRUCTURE/TOPIC/DOMAIN/UNIT | zulässige Modifier, `EXTENDS`, `=`                                                                                                   |
| Nach `EXTENDS`                             | sichtbare, zur Deklarationsart passende Ziele                                                                                        |
| Nach `attribut:`                           | Typ-Keywords, Typsnippets und sichtbare Domains oder Strukturen                                                                      |
| Nach `DOMAIN D =`                          | Domain-Typen, Zahlenbereiche, Aufzählungen, FORMAT und sichtbare Typen                                                               |
| Nach `UNIT U =`                            | Basiseinheit, Klammer-, Produkt-, Quotient- und Potenzausdrücke                                                                      |
| `IMPORTS`                                  | noch nicht importierte Workspace- und Repository-Modelle derselben INTERLIS-Version                                                  |
| Nach `END`                                 | der Name des aktuell zu schließenden Containers                                                                                      |
| `LIST`/`BAG`                               | Kardinalität, `OF` und danach zulässige Zieltypen                                                                                    |
| `FORMAT`                                   | Datum-/Zeit-Domains und danach passende Bereichsgrenzen                                                                              |
| Nach `!!@`                                 | Metaattribute passend zur folgenden Deklaration sowie passende Werte nach `=`                                                        |

Qualifizierte Namen werden segmentweise aufgelöst. Nach `Types.` werden daher
nur Mitglieder von `Types` angeboten, die an dieser Stelle als Ziel zulässig
sind. Die aktuell eingegebenen Zeichen werden exakt ersetzt: Bei `Types.Co│`
wird nur `Co`, nicht `Types.`, durch `Code` ersetzt.

Auf einer leeren Zeile in der Dokumentwurzel sowie in einem MODEL- oder
TOPIC-Body öffnet sich die Liste nicht automatisch. Nach einem passenden
Identifier-Prefix oder einer syntaktischen Grenze kann sie automatisch
erscheinen. Manuell lässt sie sich jederzeit über den im Editor konfigurierten
Befehl **Trigger Suggest** öffnen.

Die gestufte Header-Completion ist bewusst auf `CLASS`, `STRUCTURE`, `TOPIC`,
`DOMAIN` und `UNIT` beschränkt, entsprechend der Java-Baseline.
`ASSOCIATION`, `VIEW` und `GRAPHIC` besitzen weiterhin Completion-Snippets und
automatisches Blockende; in ihren freien Headern wird jedoch keine
Java-fremde Modifierliste eingeblendet.

## Enter, Tab und Cursortasten

- Ist die Vorschlagsliste sichtbar, akzeptiert Enter den ausgewählten
  Vorschlag.
- Im Snippet-Modus springen Enter und Tab zum nächsten Placeholder, solange
  noch einer vorhanden ist.
- Am finalen Body-Placeholder `$0` erzeugt Enter wieder einen normalen
  Zeilenumbruch.
- Left, Right, Up, Down, Home, End, Page Up und Page Down verlassen bei
  manueller Navigation in einem Blockkopf-Placeholder zuerst den Snippet-Modus
  und führen danach die gewünschte Cursorbewegung aus.
- In den vier MODEL-Header-Placeholdern bleibt die Completion unterdrückt.
- Beim Wechsel in die rechte Seite eines `DOMAIN`- oder `UNIT`-Snippets öffnet
  der Editor die Vorschlagsliste nur, wenn der Completion Provider dort
  tatsächlich Vorschläge liefert.

Die beiden technischen Hilfsbefehle für Placeholder-Wechsel und
Cursorbewegungen sind deshalb nicht in der Command Palette sichtbar. Ihre
Command-IDs bleiben für bestehende Keybindings kompatibel.

## Automatisches Blockende mit Enter

Aus

```ili
CLASS Gebaeude =│
```

wird durch Enter:

```ili
CLASS Gebaeude =
  │
END Gebaeude;
```

Das funktioniert für `MODEL`, `TOPIC`, `CLASS`, `STRUCTURE`, `ASSOCIATION`,
`VIEW` und `GRAPHIC`. Modifier, `EXTENDS` und mehrzeilige Blockköpfe bleiben
erhalten; der Name hinter `END` besteht ausschließlich aus dem Identifier.
Beim MODEL endet der Block mit einem Punkt, bei den anderen Blockarten mit
einem Semikolon.

Die Einrückung folgt zuerst vorhandenen Kindern desselben Blocks, danach den
Tab-/Space-Einstellungen des Editors und verwendet ansonsten zwei Leerzeichen.
Ein bereits vorhandenes passendes `END` wird nicht dupliziert.

`VIEW TOPIC` ist ein Sonderfall. Aus

```ili
VIEW TOPIC Uebersicht =│
```

wird:

```ili
VIEW TOPIC Uebersicht =
  DEPENDS ON │

END Uebersicht;
```

Der Cursor steht zuerst hinter `DEPENDS ON `; darunter sind Body und Blockende
bereits vorhanden.

Kein Blockende wird für Wertzuweisungen erzeugt:

```ili
DOMAIN D =│
UNIT U =│
name: TEXT =│
!!@ ili2db.dispName=│
```

Auch ein `=` in Kommentaren oder Strings löst kein Blockende aus.

## Ablauf eines CLASS-Snippets

1. Das Snippet `CLASS Name = ... END Name;` auswählen.
2. `Gebaeude` als Namen eingeben. `END Gebaeude;` wird gleichzeitig
   aktualisiert.
3. Tab oder Enter drücken, um zum optionalen Header-Suffix zu wechseln.
4. Dort beispielsweise `(ABSTRACT) EXTENDS Base ` eingeben oder den Bereich
   leer lassen. Das feste `=` bleibt erhalten.
5. Tab oder Enter drücken, um in den Body zu wechseln.
6. Der Snippet-Modus ist am finalen Body-Placeholder beendet; Enter erzeugt
   dort einen normalen Zeilenumbruch.

Das Ergebnis kann so aussehen:

```ili
CLASS Gebaeude (ABSTRACT) EXTENDS Base =
  │
END Gebaeude;
```

`EXTENDED`, `ABSTRACT`, weitere zulässige Modifier und `EXTENDS` bleiben damit
vollständig möglich, ohne Teil des Endnamens zu werden.

## Weitere Snippet-Abläufe

### MODEL

Das MODEL-Snippet fügt einen neutralen vollständigen Kopf ein:

```ili
MODEL Name (de)
  AT "https://example.com"
  VERSION "YYYY-MM-DD"
  =
  │
END Name.
```

Die Reihenfolge der Placeholder ist Name, Sprache, URI, Version und Body. Name,
Sprache, URI und Datum sind editierbare Vorschläge, keine festgeschriebenen
Projektwerte.

### TOPIC und STRUCTURE

Beide verhalten sich wie das CLASS-Snippet: Name, optionaler Header-Suffix und
Body sind getrennt. Ein Suffix wie `(FINAL) EXTENDS Base ` kann eingegeben oder
leer gelassen werden. Nur der Name wird hinter `END` gespiegelt.

### DOMAIN

```ili
DOMAIN Code = │;
```

Die Placeholder sind Name, optionaler Header-Suffix und rechte Seite. Nach dem
Wechsel zur rechten Seite werden beispielsweise `TEXT`, `NUMERIC`, `FORMAT`,
Aufzählungen und sichtbare Domains vorgeschlagen. Das Snippet erzeugt bewusst
kein `END`.

### UNIT

```ili
UNIT Meter = │;
```

Nach Name und optionalem Header-Suffix folgt die rechte Seite. Dort werden
Basiseinheiten und zusammengesetzte Einheitsausdrücke angeboten. Auch dieses
Snippet bleibt einzeilig und erzeugt kein `END`.

### VIEW TOPIC

Das Snippet führt durch Name, optionalen Header-Suffix, Ziel hinter
`DEPENDS ON` und Body:

```ili
VIEW TOPIC Uebersicht =
  DEPENDS ON Basistopic
  │
END Uebersicht;
```

## Sichtbarkeit und unvollständiger Code

Lokale Deklarationen werden aus dem aktuellen Editorinhalt indexiert. Eine
lokale Deklaration, die erst hinter dem Cursor steht, wird nicht vorgeschlagen.
Containergrenzen werden beachtet; Mitglieder eines fremden Containers tauchen
nicht unqualifiziert auf.

Nach einer noch nicht kompilierbaren Änderung dürfen für importierte oder
externe Symbole Daten aus dem letzten erfolgreichen Modellstand verwendet
werden. Entscheidend bleibt jedoch die aktuelle `IMPORTS`-Zeile: Entfernt der
Benutzer einen Import im Dirty-Code, verschwinden dessen Symbole sofort aus der
Completion. Completion startet keinen Compilerlauf.

## INTERLIS-Versionen und Grenzen

Die Completion berücksichtigt INTERLIS 2.3 und 2.4. Dazu gehören insbesondere
die in 2.4 verfügbaren nativen Typen `DATE`, `TIMEOFDAY` und `DATETIME` sowie
die versionsabhängig zulässigen Ziele von `LIST OF` und `BAG OF`. Die portablen
Typen `INTERLIS.XMLDate`, `INTERLIS.XMLTime` und
`INTERLIS.XMLDateTime` bleiben verfügbar.

INTERLIS 1 kann weiterhin kompiliert werden, seine semantische Completion und
die hier beschriebenen Snippets sind in diesem Ausbauschritt jedoch nicht
unterstützt.

## Automatisierter Nachweis

Der feste Golden-Katalog basiert auf
`interlis-lsp@a7878913b479150f9832d8bf4bd5c210d9db0a28`. Er prüft für die
beschriebenen Slots INTERLIS-Version, Caret-Range und Items. Zusätzlich
durchläuft ein isolierter echter VS-Code-Extension-Host die MODEL-, CLASS-,
DOMAIN-, UNIT- und VIEW-TOPIC-Snippets, Enter-Auto-Close, Suggest-Annahme und
Cursorbewegungen. Lokal lässt sich dieser Nachweis mit
`pnpm test:extension-host` ausführen.
