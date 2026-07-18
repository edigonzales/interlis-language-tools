# Migration from the Java INTERLIS extension

The new extension has the permanent identity
`edigonzales.interlis-language-tools`. The existing Java extension remains
`edigonzales.interlis-editor`; both can be installed, but they must not run for
the same workspace at the same time.

## Safe trial

1. Install the `interlis-language-tools` VSIX or prerelease.
2. Disable the Java extension for the test workspace only.
3. Reload the window and open an `.ili` file.
4. Verify diagnostics, completion, navigation, rename, formatting, compile,
   diagram and DOCX against the capability matrix.
5. Re-enable the Java extension if a required workflow is not yet accepted.

If the Java extension is active, the TypeScript extension shows a conflict and
does not start a second language server. It never disables or uninstalls the
Java extension automatically.

## Settings

New settings use `interlisLanguageTools.*`. Relevant legacy `interlisLsp.*`
values are read as fallbacks where they still have meaning. Java-, JAR-, JVM-
and GLSP-WebSocket settings have no equivalent because no JRE or diagram server
is shipped.

The remote template keeps the established default URL and three-second timeout;
an offline template is bundled. Compiler and debug output remain visible through
dedicated output channels. `autoShowOutputOnStart` is now evaluated instead of
being declaration-only.

## Behavioral differences

- Unsaved `file:`, `untitled:`, web-VFS and OPFS buffers are primary sources;
  no temporary `.ili` or log files are created.
- Desktop uses a Node LSP transport. VS Code Web uses the browser-worker entry.
- The Monaco IDE calls the same language service directly and has no JSON-RPC
  loopback server.
- Diagrams use TypeScript, Sprotty-compatible semantic models and `elkjs`; GLSP
  reconnect settings no longer apply.
- Mermaid, PlantUML, GraphML and HTML export are intentionally not migrated.

The Java implementation must remain available until project owners accept every
required matrix row and the external Marketplace/Open VSX/Theia smoke tests are
recorded.
