# INTERLIS Language Tools

Java-free INTERLIS 2.3/2.4 language intelligence for VS Code Desktop, VS Code
Web and compatible Theia products.

## Features

- save/manual-compile diagnostics, plus snapshot-based completion, hover,
  definitions, references and rename for unchanged compiled documents;
- document symbols, full-document and on-type formatting;
- parser-aware suggestions, snippets, templates and INTERLIS syntax themes;
- single-root, dependency-aware compilation with structured Problems and a
  fully replaced CLI-style compiler transcript with final error/warning
  summary; Debug remains append-only;
- synchronized `elkjs` live UML diagram that refreshes open views of the saved
  root and transitively affected roots after a valid save, while preserving
  the last-good SVG and anchored viewport for stale or invalid models; includes
  source navigation, layout settings and semantic SVG export;
- DOCX documentation export;
- support for saved files, untitled buffers and browser-backed virtual files.
- repository-aware `IMPORTS` completion and transitive model resolution;
- Ctrl-click navigation into cached repository models (local read-only files on
  Desktop and virtual read-only documents in VS Code Web).

Desktop runs the bundled Node server. VS Code Web runs the browser-worker server
from the same package. No Java runtime is downloaded or required.

## Coexistence with the Java extension

This extension conflicts safely with `edigonzales.interlis-editor`: when the
Java extension is active, this extension reports the conflict and does not start
a second server. Nothing is disabled automatically. See the repository's
migration guide before replacing the Java extension in a production workflow.

Settings and commands use the `interlisLanguageTools.*` namespace. Relevant old
`interlisLsp.*` values are accepted as fallbacks; Java/JAR/JVM and GLSP transport
settings are intentionally absent.

The default repository setting is
`%ILI_DIR;https://models.interlis.ch`. `%ILI_DIR` gives workspace models highest
priority. Desktop caches repository metadata and models in the extension's
global storage. Browser hosts temporarily use the documented CORS mirrors at
`geo.so.ch` for the central INTERLIS and federal model repositories; other
browser repositories must support CORS themselves.
