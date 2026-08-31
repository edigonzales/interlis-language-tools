# Modell-Repositories

Die Language Tools lösen Importe von INTERLIS-2.3- und -2.4-Modellen im Host
auf, nicht im synchronen WASM-Aufruf. `@ilic/language-service` definiert dazu
das laufzeitneutrale `ModelRepository`; Node- und Browser-Hosts verwenden den
`RepositoryManager` aus `@ilic/tools`.

## Reihenfolge und Auflösung

Eine Compiler-Session sieht Quellen in dieser Priorität:

1. offenen Editor-Puffer;
2. gespeicherte `.ili`-Datei aus `%ILI_DIR`;
3. heruntergeladene Repository-Datei.

Beim Schliessen eines Editors verschwindet nur dessen Overlay. Die Reihenfolge
in `interlisLanguageTools.modelRepositories` ist verbindlich; Einträge mit
`browseOnly` werden weder aufgelöst noch in der Completion angeboten.
Voreinstellung:

```text
%ILI_DIR;https://models.interlis.ch
```

`%ILI_DIR` umfasst die `.ili`-Dateien des Workspace. Das alte `%JAR_DIR` wird
ignoriert und erzeugt einmalig einen Hinweis. Fällt ein Katalog aus, bleiben
Modelle aus anderen Repositories und aus dem Cache verfügbar.

Bei fehlenden Imports lädt der Language Service die vollständige transitive
Abhängigkeitshülle für die INTERLIS-Version des importierenden Dokuments. Nur
der abschliessende Compile-and-Analyze-Lauf wird publiziert; verbleibende
Fehler zeigen auf den exakten Modellnamen in `IMPORTS`.

## Cache und Navigation

VS Code Desktop speichert den Cache im globalen Extension-Speicher und legt
navigierbare, schreibgeschützte Quellen unter diesem Schema ab:

```text
repository-models/<ili-version>/<model>/<version>/<filename>.ili
```

VS Code Web verwendet `BrowserCache` und schreibgeschützte
`interlis-repository:`-URIs. Ctrl-Klick öffnet Repository-Modelle; Speichern und
Rename verändern sie nie.

## Browser-Mirrors

Solange die kanonischen Server keine passenden CORS-Header liefern, gelten nur
in Browser-Adaptern diese temporären Aliase:

- `https://models.interlis.ch` auf die Mirrors
  `https://geo.so.ch/models/mirror/interlis.ch/` und
  `https://geo.so.ch/models/mirror/geoadmin/`;
- `http(s)://models.geo.admin.ch` auf
  `https://geo.so.ch/models/mirror/geoadmin/`.

Node- und CLI-Clients verwenden weiterhin die Original-URLs. Zusätzliche
Browser-Repositories müssen CORS erlauben. Die Aliase können entfernt werden,
sobald die Originaldienste passende Header ausliefern.

Semantische Repository-Editorfunktionen für INTERLIS 1 sind bewusst nicht
vollständig. Mermaid, PlantUML, GraphML und HTML gehören nicht zum Umfang.
