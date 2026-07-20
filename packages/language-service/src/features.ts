import type {
  Diagnostic,
  SemanticSnapshot,
  SourceRange,
  SyntaxContext,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";

export interface EditorPosition {
  readonly line: number;
  readonly character: number;
}
export interface EditorRange {
  readonly start: EditorPosition;
  readonly end: EditorPosition;
}
export interface Location {
  readonly uri: string;
  readonly range: EditorRange;
}
export interface TextEdit {
  readonly range: EditorRange;
  readonly newText: string;
}
export interface TemplateEdit {
  readonly edits: readonly TextEdit[];
  readonly finalSelection: EditorRange;
}
export interface CompletionItem {
  readonly label: string;
  readonly kind:
    "keyword" | "class" | "property" | "module" | "snippet" | "value";
  readonly detail?: string;
  readonly insertText?: string;
  readonly insertTextFormat?: "plain" | "snippet";
}
export interface DocumentSymbol {
  readonly name: string;
  readonly detail: string;
  readonly kind: string;
  readonly range: EditorRange;
  readonly selectionRange: EditorRange;
  readonly children: readonly DocumentSymbol[];
}
export interface RenameResult {
  readonly changes: Readonly<Record<string, readonly TextEdit[]>>;
}
export interface HoverResult {
  readonly markdown: string;
  readonly range: EditorRange;
}

const keywordItems: Readonly<Record<string, readonly CompletionItem[]>> = {
  root: [
    {
      label: "MODEL",
      kind: "snippet",
      insertText: "MODEL ${1:Name} =\n  $0\nEND ${1:Name}.",
      insertTextFormat: "snippet",
    },
  ],
  modelDef: [
    { label: "IMPORTS", kind: "keyword" },
    {
      label: "TOPIC",
      kind: "snippet",
      insertText: "TOPIC ${1:Name} =\n  $0\nEND ${1:Name};",
      insertTextFormat: "snippet",
    },
    { label: "DOMAIN", kind: "keyword" },
    { label: "UNIT", kind: "keyword" },
  ],
  topicDef: [
    {
      label: "CLASS",
      kind: "snippet",
      insertText: "CLASS ${1:Name} =\n  $0\nEND ${1:Name};",
      insertTextFormat: "snippet",
    },
    { label: "STRUCTURE", kind: "keyword" },
    { label: "ASSOCIATION", kind: "keyword" },
    { label: "DOMAIN", kind: "keyword" },
  ],
  classDef: [
    { label: "EXTENDS", kind: "keyword" },
    { label: "MANDATORY", kind: "keyword" },
    { label: "TEXT", kind: "value" },
    { label: "NUMERIC", kind: "value" },
  ],
  attributeDef: [
    { label: "TEXT", kind: "value" },
    { label: "NUMERIC", kind: "value" },
    { label: "BOOLEAN", kind: "value" },
    { label: "DATE", kind: "value" },
  ],
};

export function toEditorRange(range: SourceRange): EditorRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

export function contains(
  range: SourceRange,
  position: EditorPosition,
): boolean {
  if (position.line < range.start.line || position.line > range.end.line)
    return false;
  if (
    position.line === range.start.line &&
    position.character < range.start.character
  )
    return false;
  return (
    position.line !== range.end.line ||
    position.character <= range.end.character
  );
}

export function contextAt(
  snapshot: SyntaxSnapshot,
  position: EditorPosition,
): SyntaxContext | undefined {
  return snapshot.contexts
    .filter((context) => contains(context.range, position))
    .sort((left, right) => {
      const leftSize = left.range.end.byteOffset - left.range.start.byteOffset;
      const rightSize =
        right.range.end.byteOffset - right.range.start.byteOffset;
      return leftSize - rightSize;
    })[0];
}

export function completionsAt(
  syntax: SyntaxSnapshot,
  semantic: SemanticSnapshot | null,
  position: EditorPosition,
): CompletionItem[] {
  const context = contextAt(syntax, position);
  const base = keywordItems[context?.kind ?? "root"] ?? keywordItems.root ?? [];
  const semanticItems = (semantic?.symbols ?? []).map((symbol) => ({
    label: symbol.name,
    kind:
      symbol.kind === "Model"
        ? ("module" as const)
        : symbol.kind === "Attribute"
          ? ("property" as const)
          : ("class" as const),
    detail: symbol.qualifiedName,
  }));
  return [...base, ...semanticItems].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.label === item.label) === index,
  );
}

export function diagnosticsFor(
  uri: string,
  syntax: SyntaxSnapshot,
  semantic: SemanticSnapshot | null,
): Diagnostic[] {
  return [...syntax.diagnostics, ...(semantic?.diagnostics ?? [])].filter(
    (diagnostic) => diagnostic.range?.uri === uri,
  );
}

export function locationsForDefinition(
  semantic: SemanticSnapshot,
  uri: string,
  position: EditorPosition,
): Location[] {
  const reference = semantic.references.find(
    (item) =>
      item.range?.uri === uri && item.range && contains(item.range, position),
  );
  const direct = semantic.symbols.find((item) => {
    const selection = item.selectionRange ?? item.range;
    return selection?.uri === uri && contains(selection, position);
  });
  const targetId = reference?.targetId ?? direct?.id;
  if (!targetId) return [];
  const target = semantic.symbols.find((item) => item.id === targetId);
  const targetRange = target?.selectionRange ?? target?.range;
  return targetRange
    ? [{ uri: targetRange.uri, range: toEditorRange(targetRange) }]
    : [];
}

export function locationsForReferences(
  semantic: SemanticSnapshot,
  symbolId: string,
  includeDeclaration: boolean,
): Location[] {
  const result = semantic.references
    .filter((reference) => reference.targetId === symbolId && reference.range)
    .map((reference) => ({
      uri: reference.range!.uri,
      range: toEditorRange(reference.range!),
    }));
  if (includeDeclaration) {
    const symbol = semantic.symbols.find(
      (candidate) => candidate.id === symbolId,
    );
    const declaration = symbol?.selectionRange ?? symbol?.range;
    if (declaration)
      result.unshift({
        uri: declaration.uri,
        range: toEditorRange(declaration),
      });
  }
  return result;
}

export function symbolAt(
  semantic: SemanticSnapshot,
  uri: string,
  position: EditorPosition,
) {
  const reference = semantic.references.find(
    (item) =>
      item.range?.uri === uri && item.range && contains(item.range, position),
  );
  if (reference)
    return semantic.symbols.find((item) => item.id === reference.targetId);
  return semantic.symbols.find((item) => {
    const selection = item.selectionRange ?? item.range;
    return selection?.uri === uri && contains(selection, position);
  });
}

export function renameSymbol(
  semantic: SemanticSnapshot,
  symbolId: string,
  newName: string,
): RenameResult {
  const changes: Record<string, TextEdit[]> = {};
  for (const location of locationsForReferences(semantic, symbolId, true)) {
    (changes[location.uri] ??= []).push({
      range: location.range,
      newText: newName,
    });
  }
  return { changes };
}

export function documentSymbols(
  semantic: SemanticSnapshot,
  uri: string,
): DocumentSymbol[] {
  const symbols = semantic.symbols.filter(
    (symbol) => symbol.range?.uri === uri && symbol.range,
  );
  const build = (containerId: string): DocumentSymbol[] =>
    symbols
      .filter((symbol) => symbol.containerId === containerId && symbol.range)
      .map((symbol) => ({
        name: symbol.name,
        detail: symbol.qualifiedName,
        kind: symbol.kind,
        range: toEditorRange(symbol.range!),
        selectionRange: toEditorRange(symbol.selectionRange ?? symbol.range!),
        children: build(symbol.id),
      }));
  return build("");
}

export function templateForNewline(
  syntax: SyntaxSnapshot,
  position: EditorPosition,
): TemplateEdit | null {
  const before = syntax.tokens.filter((token) => {
    const start = token.range.start;
    return (
      start.line < position.line ||
      (start.line === position.line && start.character < position.character)
    );
  });
  const equal = before.at(-1);
  if (equal?.kind !== "EQUAL") return null;
  const declaration = [...before]
    .reverse()
    .find((token) =>
      ["MODEL", "TOPIC", "CLASS", "STRUCTURE", "ASSOCIATION"].includes(
        token.kind,
      ),
    );
  if (!declaration) return null;
  const name = before
    .slice(before.indexOf(declaration) + 1)
    .find((token) => token.kind === "NAME")?.text;
  if (!name) return null;
  const indent =
    declaration.kind === "MODEL"
      ? ""
      : "  ".repeat(Math.max(1, declaration.range.start.character / 2));
  const terminator = declaration.kind === "MODEL" ? "." : ";";
  const insertion = `\n${indent}  \n${indent}END ${name}${terminator}`;
  const cursor = {
    line: position.line + 1,
    character: indent.length + 2,
  };
  return {
    edits: [{ range: { start: position, end: position }, newText: insertion }],
    finalSelection: { start: cursor, end: cursor },
  };
}
