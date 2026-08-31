# INTERLIS Language Tools für VS Code

Javafreie Sprachunterstützung für INTERLIS 2.3 und 2.4 in VS Code Desktop,
VS Code Web und kompatiblen Theia-Produkten.

## Funktionen

- konservative Live-Diagnostik sowie verbindliche Diagnostik beim Öffnen,
  Speichern und manuellen Kompilieren;
- Completion, Hover, Definition, Referenzen, Dokument-Symbole, Formatierung,
  Snippets und sicherer Rename auf aktuellen, auch ungespeicherten Dokumenten;
- transitive Repository-Auflösung und Ctrl-Klick auf schreibgeschützte
  Repository-Modelle;
- strukturierte Problems- und Compiler-Ausgabe;
- synchronisiertes `elkjs`-UML-Diagramm mit letztem gültigem Stand,
  Quellnavigation, Layout-Einstellungen und semantischem SVG-Export;
- DOCX-Export sowie Unterstützung für Dateien, unbenannte Puffer und virtuelle
  Browser-Dateisysteme.

Desktop startet den gebündelten Node-Server, VS Code Web den Browser-Worker aus
demselben Paket. Eine Java-Laufzeit wird weder benötigt noch heruntergeladen.
Die Bedienung ist unter
[Completion und Snippets](../../docs/completion-und-snippets.md) und
[Live-Diagnostik und Dirty-Navigation](../../docs/live-diagnostik-und-dirty-navigation.md)
beschrieben.

## Koexistenz mit der Java-Extension

Ist `edigonzales.interlis-editor` aktiv, meldet diese Extension den Konflikt und
startet keinen zweiten Server. Sie deaktiviert oder entfernt nichts
automatisch. Einstellungen und Befehle verwenden den Namensraum
`interlisLanguageTools.*`; passende alte `interlisLsp.*`-Werte werden als
Fallback gelesen. Java-, JAR-, JVM- und GLSP-Transporteinstellungen gehören
nicht mehr zum Produkt.

Das voreingestellte Modell-Repository ist
`%ILI_DIR;https://models.interlis.ch`. Details zu Priorität, Cache und den
temporären Browser-Mirrors stehen unter
[Modell-Repositories](../../docs/model-repositories.md).
