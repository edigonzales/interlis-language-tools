# Diagnostik

`@ilic/language-service` behandelt Compiler-, Live-, Saved-Lint- und
Repository-Diagnosen als strukturierte Daten. Identität und Deduplizierung
verwenden Code, Severity, Source, URI/Byte-Range, Message, `treatedAsError`,
Related Information und Notes; Meldungstext allein ist kein Schlüssel.

`DiagnosticStore` hält Ergebnisse pro URI, Root, Dokumentversion und Ursprung.
`DiagnosticVersionGate` verwirft Ergebnisse aus älteren Generationen,
Compilation-Epochen, Runs oder Dokumentversionen.

Quick Fixes und Code Actions verwenden stabile Codes, nicht Message-Matching.
Neue Compilerfelder werden additiv durch LSP und Monaco gereicht.
