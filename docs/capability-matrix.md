# INTERLIS capability matrix

Parity baseline: `interlis-lsp@a7878913b479150f9832d8bf4bd5c210d9db0a28`,
including the audited client code below `client/`.

Legend: ✅ implemented, 🟡 deliberately limited or awaiting an external-host
smoke test, — not applicable/out of scope. “Automated test” names the strongest
current evidence; detailed commands are in [testing.md](testing.md).

| Capability                                               | legacy-server | legacy-client | shared-core | VS Code Desktop | VS Code Web | Theia | Monaco IDE |                                                        automated-test |
| -------------------------------------------------------- | ------------: | ------------: | ----------: | --------------: | ----------: | ----: | ---------: | --------------------------------------------------------------------: |
| Live and save diagnostics                                |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                  ✅ unit/contract/E2E |
| Import and repository-model completion                   |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                      ✅ unit/contract |
| Transitive repository resolution and warm offline cache  |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                               ✅ native/unit/contract |
| Ctrl-click into read-only repository models              |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                  ✅ unit/manual smoke |
| Definition and references                                |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ unit/adapter |
| Prepare rename and rename                                |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ unit/adapter |
| Document symbols and outline                             |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ unit/adapter |
| Hover information                                        |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ unit/adapter |
| Full-document and on-type formatting                     |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                ✅ native/unit/adapter |
| Autoclosing and structured templates                     |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                  ✅ unit/manifest/E2E |
| Parser-context suggestion activation                     |             — |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                           ✅ unit/E2E |
| Snippet key and final-caret contract                     |             — |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ unit/adapter |
| Compile command, cache and structured logs               |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                ✅ native/contract/E2E |
| Output channels, blank guards and focus preservation     |             — |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                 ✅ extension/unit/E2E |
| TextMate grammar, comments, brackets, folding and colors |             — |            ✅ |           — |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ manifest/E2E |
| Remote and offline “New from Template”                   |             — |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                           ✅ unit/E2E |
| `file:`, `untitled:`, web VFS and OPFS documents         |       🟡 file |       🟡 file |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ contract/E2E |
| Node and browser-worker LSP exports                      |             — |             — |          ✅ |              ✅ |          ✅ |    ✅ |          — |                                                 ✅ pack/VSIX contract |
| Java-extension conflict detection                        |             — |             — |           — |              ✅ |          ✅ |    ✅ |          — |                                                      ✅ manifest/unit |
| Live diagram and last-good snapshot                      |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ unit/DOM/E2E |
| Diagram settings and source navigation                   |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ unit/DOM/E2E |
| Anchor-aware viewport restoration                        |             — |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                               ✅ unit |
| Semantic full/viewport SVG export                        |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                         ✅ golden/E2E |
| DOCX export                                              |            ✅ |            ✅ |          ✅ |              ✅ |          ✅ |    ✅ |         ✅ |                                                       ✅ ZIP/unit/E2E |
| OPFS workspace and unsaved recovery                      |             — |             — |           — |               — |           — |     — |         ✅ |                                        ✅ Chromium/Firefox/WebKit E2E |
| Local Folder / reconnect state                           |             — |             — |           — |               — |           — |     — |         ✅ |                                                       ✅ Chromium E2E |
| ZIP import/export fallback                               |             — |             — |           — |               — |           — |     — |         ✅ |                                                  ✅ three-browser E2E |
| Local Git clone/status/diff/stage/commit                 |             — |             — |           — |               — |           — |     — |         ✅ |                                             ✅ unit/three-browser E2E |
| Offline PWA after first load                             |             — |             — |           — |               — |           — |     — |         ✅ | 🟡 Chromium/Firefox navigation; WebKit runner CacheStorage limitation |
| INTERLIS 1 compile and syntax diagnostics                |            ✅ |            ✅ |          🟡 |              🟡 |          🟡 |    🟡 |         🟡 |                                                      ✅ native/golden |
| INTERLIS 1 semantic editor features                      |            🟡 |            🟡 |          🟡 |              🟡 |          🟡 |    🟡 |         🟡 |                                                 — visibly unsupported |
| Mermaid / PlantUML / GraphML / HTML                      |            ✅ |            ✅ |           — |               — |           — |     — |          — |                                                            — excluded |
| Java/JRE settings and GLSP WebSocket reconnect           |            ✅ |            ✅ |           — |               — |           — |     — |          — |                                                   — replaced/excluded |

## Release interpretation

INTERLIS 2.3 and 2.4 functional cells are implemented in the common core and
all target adapters. The remaining yellow test cell is a Playwright WebKit
driver limitation: WebKit requires a persistent context for OPFS, but that
context does not expose CacheStorage/offline navigation correctly. OPFS,
recovery, ZIP, Git and the live language tools are still exercised in WebKit;
offline navigation is exercised in Chromium and Firefox.

The Java extension is not removed or disabled. The public packages remain on
the `0.1.0-SNAPSHOT.*` line and the extension remains a `0.1.0` pre-release
until Marketplace/Open VSX credentials and final installation smoke tests in
external VS Code Web and Theia hosts have completed. npm snapshots use only the
`snapshot` dist-tag in CI. During the pre-release bootstrap phase, `latest` is
manually synchronized to the same snapshot with local npm web authentication as
documented in the release process.
