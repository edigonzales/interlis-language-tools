# INTERLIS Language Tools

Java-free INTERLIS 2.3/2.4 language intelligence for VS Code Desktop, VS Code
Web and compatible Theia products.

## Features

- live/save diagnostics, completion, hover, definitions, references and rename;
- document symbols, full-document and on-type formatting;
- parser-aware suggestions, snippets, templates and INTERLIS syntax themes;
- dependency-aware compile command with structured Compiler/Debug output;
- synchronized `elkjs` live UML diagram with last-good state, source navigation,
  layout settings, anchored viewport and semantic SVG export;
- DOCX documentation export;
- support for saved files, untitled buffers and browser-backed virtual files.

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
