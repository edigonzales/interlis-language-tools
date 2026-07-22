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
    return [item.selectionRange, item.endRange, item.range].some(
      (candidate) => candidate?.uri === uri && contains(candidate, position),
    );
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
    if (declaration) {
      result.unshift({
        uri: declaration.uri,
        range: toEditorRange(declaration),
      });
    }
    if (symbol?.endRange) {
      result.splice(declaration ? 1 : 0, 0, {
        uri: symbol.endRange.uri,
        range: toEditorRange(symbol.endRange),
      });
    }
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
    return [item.selectionRange, item.endRange, item.range].some(
      (candidate) => candidate?.uri === uri && contains(candidate, position),
    );
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

function comparePositions(left: EditorPosition, right: EditorPosition): number {
  return left.line - right.line || left.character - right.character;
}

function enclosingRange(
  range: EditorRange,
  additions: readonly EditorRange[],
): EditorRange {
  let start = range.start;
  let end = range.end;
  for (const addition of additions) {
    if (comparePositions(addition.start, start) < 0) start = addition.start;
    if (comparePositions(addition.end, end) > 0) end = addition.end;
  }
  return { start, end };
}

const outlineDetails: Readonly<Record<string, string>> = {
  model: "MODEL",
  topic: "TOPIC",
  class: "CLASS",
  structure: "STRUCTURE",
  association: "ASSOCIATION",
  view: "VIEW",
  domain: "DOMAIN",
  unit: "UNIT",
  function: "FUNCTION",
  constraint: "CONSTRAINT",
  graphic: "GRAPHIC",
};

const inheritedMemberKinds = new Set(["attribute", "role"]);
const viewableKinds = new Set(["class", "structure", "association", "view"]);

function normalizedKind(kind: string): string {
  return kind.toLowerCase();
}

function isOutlineVisible(kind: string, name: string): boolean {
  return !(normalizedKind(kind) === "dataunit" && name === "BASKET");
}

function cursorRange(range: EditorRange): EditorRange {
  return { start: range.start, end: range.start };
}

function outlineDetail(kind: string): string {
  return outlineDetails[normalizedKind(kind)] ?? "";
}

export function documentSymbols(
  semantic: SemanticSnapshot,
  uri: string,
): DocumentSymbol[] {
  type Symbol = SemanticSnapshot["symbols"][number];
  const allById = new Map<string, Symbol>(
    semantic.symbols.map((symbol) => [symbol.id, symbol]),
  );
  const symbols = semantic.symbols.filter(
    (symbol) =>
      symbol.range?.uri === uri &&
      symbol.range &&
      isOutlineVisible(symbol.kind, symbol.name),
  );
  const symbolsByContainer = new Map<string, Symbol[]>();
  for (const symbol of symbols) {
    const children = symbolsByContainer.get(symbol.containerId) ?? [];
    children.push(symbol);
    symbolsByContainer.set(symbol.containerId, children);
  }

  const inheritanceTarget = (symbolId: string): Symbol | undefined => {
    const reference = semantic.references.find(
      (candidate) =>
        candidate.sourceId === symbolId &&
        normalizedKind(candidate.kind) === "inheritance",
    );
    return reference ? allById.get(reference.targetId) : undefined;
  };

  const directMembers = (containerId: string): Symbol[] =>
    (symbolsByContainer.get(containerId) ?? []).filter((symbol) =>
      inheritedMemberKinds.has(normalizedKind(symbol.kind)),
    );

  const buildSymbol = (symbol: Symbol, inherited = false): DocumentSymbol => {
    const source = symbol.range!;
    const sourceRange = toEditorRange(source);
    const declaredSelection =
      symbol.selectionRange?.uri === source.uri
        ? toEditorRange(symbol.selectionRange)
        : sourceRange;
    const selectionRange = cursorRange(declaredSelection);
    const localChildren = build(symbol.id);
    const children = inherited
      ? []
      : [...localChildren, ...inheritedChildren(symbol, localChildren)];
    return {
      name: symbol.name || symbol.qualifiedName,
      detail: outlineDetail(symbol.kind),
      kind: normalizedKind(symbol.kind),
      range: enclosingRange(sourceRange, [
        declaredSelection,
        ...(symbol.endRange?.uri === source.uri
          ? [toEditorRange(symbol.endRange)]
          : []),
        ...localChildren.map((child) => child.range),
      ]),
      selectionRange,
      children,
    };
  };

  const inheritedChildren = (
    symbol: Symbol,
    localChildren: readonly DocumentSymbol[],
  ): DocumentSymbol[] => {
    if (!viewableKinds.has(normalizedKind(symbol.kind))) return [];
    const names = new Set(localChildren.map((child) => child.name));
    const result: DocumentSymbol[] = [];
    let parent = inheritanceTarget(symbol.id);
    while (parent != null) {
      if (parent.range?.uri !== uri) break;
      for (const member of directMembers(parent.id)) {
        if (names.has(member.name)) continue;
        names.add(member.name);
        result.push(buildSymbol(member, true));
      }
      parent = inheritanceTarget(parent.id);
    }
    return result;
  };

  function build(containerId: string): DocumentSymbol[] {
    return (symbolsByContainer.get(containerId) ?? []).map((symbol) =>
      buildSymbol(symbol),
    );
  }

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
