# INTERLIS capability matrix

Baseline: `interlis-lsp@a7878913b479150f9832d8bf4bd5c210d9db0a28`.

Legend: ✅ implemented and tested, 🟡 intentionally partial, ⬜ pending,
— out of scope.

| Capability | Legacy server | Legacy client | Shared core | VS Code Desktop | VS Code Web | Theia | Monaco IDE | Automated test |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Live and save diagnostics | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Import/repository completion | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Definition and references | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Prepare rename and rename | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Document symbols and outline | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Full/on-type formatting | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Autoclosing and templates | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Structured suggestion activation | — | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Snippet and caret workflow | — | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Compile command and logs | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| TextMate grammar/editor configuration | — | ✅ | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| New document from remote/offline template | — | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Live diagram and last-good snapshot | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Diagram settings and source navigation | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Anchor-aware viewport persistence | — | ✅ | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Semantic full/viewport SVG export | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| DOCX export | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| OPFS/local-folder/ZIP workspace | — | — | — | — | — | — | ⬜ | ⬜ |
| Local Git clone/status/diff/commit | — | — | — | — | — | — | ⬜ | ⬜ |
| INTERLIS 1 compile/syntax diagnostics | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Mermaid/PlantUML/GraphML/HTML | ✅ | ✅ | — | — | — | — | — | — |

Stable 1.0 is allowed only when every in-scope INTERLIS 2.3/2.4 cell is green.
