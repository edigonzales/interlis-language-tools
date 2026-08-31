# ADR 0001: Repository- und Laufzeitgrenzen

Status: akzeptiert

## Entscheidung

`ilic-fork` verantwortet den nativen Compiler, die WASM-Bindings und die
Repository-Primitiven. Dieses Repository enthält die hostunabhängige
Sprachlogik sowie die Adapter für LSP, Monaco, Diagramm, DOCX und VS Code. Die
separat deployte `interlis-web-ide` konsumiert die veröffentlichten Pakete.

Der Language Service ist die Architekturgrenze. LSP ist ein Protokolladapter,
nicht der Ort der fachlichen Sprachlogik. Monaco ruft denselben Service direkt
in einem Worker auf.

Das Live-Diagramm verwendet Sprotty und `elkjs`. Ein GLSP-Server und WebSocket
sind unnötig, weil das Diagramm eine schreibgeschützte Projektion eines
semantischen Snapshots ist.

## Konsequenzen

- Ungespeicherte Dokumente sind in jedem Host vollwertige Eingaben.
- Node- und Browser-Builds unterscheiden sich nur in Transport-, Dateisystem-
  und Cache-Adaptern.
- Repositoryübergreifende Entwicklung verwendet erzeugte Paket-Tarballs; Code-
  Kopien und Git-Submodule sind ausgeschlossen.
