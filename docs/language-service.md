# Diagnostik im Language Service

Der Language Service führt Semantic-, Live- und Saved-Diagnosen pro Root und
URI. Semantic-Diagnosen haben Vorrang; Live- und Saved-Projektionen werden nur
für den passenden Dokumentstand ergänzt. Ein neuer Compile-Lauf ersetzt den
gesamten Root-Satz, wodurch veraltete Dateien entfernt werden.

Beim Hinzufügen eines Codes muss der Compiler-Katalog aktualisiert, das
WASM-Typmodell geprüft und ein Code-basierter Regressionstest ergänzt werden.
