# INTERLIS-Funktionsmatrix

Vergleichsbasis ist `interlis-lsp@a7878913b479150f9832d8bf4bd5c210d9db0a28`
einschliesslich des damaligen Clients unter `client/`.

Legende: ✅ umgesetzt, 🟡 bewusst eingeschränkt oder noch nicht in einem
externen Host geprüft, — nicht anwendbar beziehungsweise ausserhalb des
Umfangs. Die stärksten automatisierten Nachweise sind zusammengefasst;
ausführbare Befehle stehen unter [Tests](testing.md).

| Fähigkeit | Gemeinsamer Kern | VS Code Desktop/Web und Theia | Monaco/Web IDE | Nachweis |
| --- | ---: | ---: | ---: | --- |
| Save-, manuelle und konservative Live-Diagnostik | ✅ | ✅/🟡 externe Web-Hosts | ✅ | Unit, Golden, LSP, Extension Host, E2E |
| Quick Fixes, Definition, Referenzen, Hover und sicherer Rename | ✅ | ✅/🟡 externe Web-Hosts | ✅ | Unit, Adapter, Extension Host |
| INTERLIS-2.3/2.4-Completion, Snippets und automatisches Blockende | ✅ | ✅ | ✅ | Golden, Adapter, Manifest, E2E |
| Dokument-Symbole und Formatierung | ✅ | ✅ | ✅ | Unit, Adapter |
| Transitive Repository-Auflösung, Cache und Navigation | ✅ | ✅ | ✅ | Native, Unit, Contract, Smoke |
| Compile-Befehl, strukturierte Logs und Cache-Steuerung | ✅ | ✅ | ✅ | Native, Contract, E2E |
| Node- und Browser-Worker-LSP | ✅ | ✅ | — | Pack- und VSIX-Contract |
| Live-Diagramm, Navigation und semantischer SVG-Export | ✅ | ✅ | ✅ | Unit, DOM, Golden, E2E |
| DOCX-Export | ✅ | ✅ | ✅ | ZIP, Unit, E2E |
| OPFS, Recovery, ZIP und lokales Git | — | — | ✅ | E2E in Chromium, Firefox und WebKit |
| Offline-PWA nach dem ersten Laden | — | — | 🟡 | Chromium/Firefox; WebKit-Einschränkung unten |
| INTERLIS 1: Compile und Syntaxdiagnostik | 🟡 | 🟡 | 🟡 | Native, Golden |
| INTERLIS 1: semantische Editorfunktionen | 🟡 | 🟡 | 🟡 | bewusst nicht vollständig |
| Mermaid, PlantUML, GraphML, HTML, Java/JRE und GLSP | — | — | — | ersetzt oder ausgeschlossen |

Die INTERLIS-2.3/2.4-Funktionen liegen im gemeinsamen Kern und werden von allen
Adaptern verwendet. Gelbe Zellen bei VS Code Web und Theia bedeuten, dass die
Interaktion noch in diesen externen Hosts nachzuweisen ist; der gemeinsame Code
und die lokalen Adaptertests sind vorhanden. Die Java-Extension wird bei einem
Konflikt weder entfernt noch deaktiviert.

Playwright benötigt für OPFS unter WebKit einen persistenten Kontext. Dieser
stellt im Runner `CacheStorage` für die Offline-Navigation nicht zuverlässig
bereit. Deshalb läuft genau dieser Pfad in Chromium und Firefox; OPFS,
Recovery, ZIP, Git und die Language Tools werden weiterhin in WebKit geprüft.

Die detaillierten Bedienverträge stehen unter
[Completion und Snippets](completion-und-snippets.md) sowie
[Live-Diagnostik und Dirty-Navigation](live-diagnostik-und-dirty-navigation.md).
