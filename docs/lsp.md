# LSP-Diagnostik

Der Language-Server bildet Severity, Code, Source, Range und Related Information
auf `PublishDiagnosticsParams`. `treatedAsError` wird als Fehlerdarstellung
berücksichtigt, während die native Severity erhalten bleibt. No-range-
Diagnosen werden mit einer sicheren Fallback-Range veröffentlicht; `helpId`
wird, wenn vorhanden, als `codeDescription`-Link projiziert.
