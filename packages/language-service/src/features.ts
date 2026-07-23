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
  readonly inherited?: boolean;
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
      ...(inherited ? { inherited: true } : {}),
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

const syntaxDeclarationKinds = new Set([
  "modelDef",
  "topicDef",
  "classDef",
  "structureDef",
  "associationDef",
  "viewDef",
  "graphicDef",
  "domainDef",
  "unitDef",
  "functionDef",
  "attributeDef",
  "roleDef",
  "constraintDef",
]);

const blockTokenKinds: Readonly<Record<string, string>> = {
  MODEL: "model",
  TOPIC: "topic",
  CLASS: "class",
  STRUCTURE: "structure",
  ASSOCIATION: "association",
  VIEW: "view",
  GRAPHIC: "graphic",
};

const tokenDeclarationKinds: Readonly<Record<string, string>> = {
  ILIDOMAIN: "domain",
  UNIT: "unit",
  FUNCTION: "function",
};

function syntaxTokensInRange(
  syntax: SyntaxSnapshot,
  range: SourceRange,
): SyntaxSnapshot["tokens"] {
  return syntax.tokens.filter(
    (token) =>
      token.channel === 0 &&
      token.range.start.byteOffset >= range.start.byteOffset &&
      token.range.end.byteOffset <= range.end.byteOffset,
  );
}

function declarationFromSyntaxNode(
  syntax: SyntaxSnapshot,
  node: SyntaxSnapshot["nodes"][number],
): Omit<DocumentSymbol, "children"> | null {
  if (!syntaxDeclarationKinds.has(node.kind)) return null;
  const tokens = syntaxTokensInRange(syntax, node.range);
  const keyword = tokens.find((token) => token.kind in blockTokenKinds);
  let kind =
    node.kind === "classDef" && keyword
      ? blockTokenKinds[keyword.kind]
      : node.kind.replace(/Def$/, "").toLowerCase();
  if (!kind) return null;
  if (node.kind === "constraintDef") kind = "constraint";
  const declarationToken =
    keyword ??
    tokens.find((token) => token.kind in tokenDeclarationKinds) ??
    tokens[0];
  let name: (typeof tokens)[number] | undefined;
  if (
    kind === "attribute" ||
    kind === "role" ||
    kind === "domain" ||
    kind === "unit"
  )
    name = tokens.find((token) => token.kind === "NAME");
  else if (kind === "constraint") {
    const marker = tokens.findIndex((token) => token.kind === "CONSTRAINT");
    const candidate = marker >= 0 ? tokens[marker + 1] : undefined;
    name =
      candidate?.kind === "NAME" && tokens[marker + 2]?.kind === "COLON"
        ? candidate
        : undefined;
  } else {
    const index = declarationToken ? tokens.indexOf(declarationToken) : -1;
    name = tokens.slice(index + 1).find((token) => token.kind === "NAME");
  }
  const range = toEditorRange(node.range);
  const selection = name ? toEditorRange(name.range) : cursorRange(range);
  return {
    name: name?.text ?? (kind === "constraint" ? "constraint" : kind),
    detail: outlineDetail(kind),
    kind,
    range,
    selectionRange: cursorRange(selection),
  };
}

function parserDocumentSymbols(syntax: SyntaxSnapshot): DocumentSymbol[] {
  interface Entry {
    readonly node: SyntaxSnapshot["nodes"][number];
    readonly symbol: Omit<DocumentSymbol, "children">;
    readonly children: Entry[];
  }
  const nodeById = new Map(syntax.nodes.map((node) => [node.id, node]));
  const entries = new Map<number, Entry>();
  for (const node of syntax.nodes) {
    const symbol = declarationFromSyntaxNode(syntax, node);
    if (symbol) entries.set(node.id, { node, symbol, children: [] });
  }
  const roots: Entry[] = [];
  for (const entry of entries.values()) {
    let parent = entry.node.parent;
    while (parent !== null && !entries.has(parent))
      parent = nodeById.get(parent)?.parent ?? null;
    const owner = parent === null ? undefined : entries.get(parent);
    if (owner) owner.children.push(entry);
    else roots.push(entry);
  }
  const build = (entry: Entry): DocumentSymbol => {
    let constraint = 0;
    const children = entry.children
      .sort(
        (left, right) =>
          left.node.range.start.byteOffset - right.node.range.start.byteOffset,
      )
      .map((child) => {
        const result = build(child);
        if (result.kind !== "constraint" || result.name !== "constraint")
          return result;
        return { ...result, name: `constraint${++constraint}` };
      });
    return { ...entry.symbol, children };
  };
  return roots
    .sort(
      (left, right) =>
        left.node.range.start.byteOffset - right.node.range.start.byteOffset,
    )
    .map(build);
}

function tokenDocumentSymbols(syntax: SyntaxSnapshot): DocumentSymbol[] {
  interface Entry {
    name: string;
    readonly kind: string;
    readonly detail: string;
    range: EditorRange;
    readonly selectionRange: EditorRange;
    readonly children: Entry[];
  }
  const tokens = syntax.tokens.filter((token) => token.channel === 0);
  const roots: Entry[] = [];
  const stack: Entry[] = [];
  const append = (entry: Entry): void => {
    const parent = stack.at(-1);
    (parent?.children ?? roots).push(entry);
  };
  const statementEnd = (start: number): number => {
    const index = tokens
      .slice(start)
      .findIndex((token) => token.kind === "SEMI");
    return index < 0 ? Math.max(start, tokens.length - 1) : start + index;
  };
  const makeEntry = (
    kind: string,
    nameToken: (typeof tokens)[number],
    start: number,
    end = start,
  ): Entry => ({
    name: nameToken.text,
    kind,
    detail: outlineDetail(kind),
    range: {
      start: toEditorRange(tokens[start]!.range).start,
      end: toEditorRange(tokens[end]!.range).end,
    },
    selectionRange: cursorRange(toEditorRange(nameToken.range)),
    children: [],
  });
  let parenthesisDepth = 0;
  let section: "domain" | "unit" | null = null;
  const constraintCounts = new Map<Entry, number>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === "LPAREN") parenthesisDepth++;
    if (token.kind === "RPAREN")
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (token.kind in blockTokenKinds) {
      section = null;
      const name = tokens
        .slice(index + 1)
        .find((candidate) => candidate.kind === "NAME");
      if (!name) continue;
      const entry = makeEntry(blockTokenKinds[token.kind]!, name, index);
      append(entry);
      stack.push(entry);
      continue;
    }
    if (token.kind === "END") {
      section = null;
      const name = tokens[index + 1];
      const punctuation = tokens[index + 2];
      const end =
        punctuation &&
        (punctuation.kind === "SEMI" || punctuation.kind === "DOT")
          ? index + 2
          : name
            ? index + 1
            : index;
      const matching = [...stack]
        .map((entry) => entry.name)
        .lastIndexOf(name?.text ?? "");
      if (matching >= 0) {
        const entry = stack[matching]!;
        entry.range = {
          ...entry.range,
          end: toEditorRange(tokens[end]!.range).end,
        };
        stack.splice(matching);
      }
      continue;
    }
    if (token.kind === "ILIDOMAIN" || token.kind === "UNIT") {
      section = token.kind === "ILIDOMAIN" ? "domain" : "unit";
      const name = tokens[index + 1];
      if (name?.kind !== "NAME") continue;
      const end = statementEnd(index);
      append(makeEntry(section, name, index, end));
      index = end;
      continue;
    }
    if (
      section &&
      token.kind === "NAME" &&
      ["EQUAL", "EXTENDS", "SEMI"].includes(tokens[index + 1]?.kind ?? "")
    ) {
      const end = statementEnd(index);
      append(makeEntry(section, token, index, end));
      index = end;
      continue;
    }
    if (token.kind === "FUNCTION") {
      section = null;
      const name = tokens[index + 1];
      if (name?.kind !== "NAME") continue;
      const end = statementEnd(index);
      append(makeEntry("function", name, index, end));
      index = end;
      continue;
    }
    if (token.kind === "CONSTRAINT") {
      section = null;
      const owner = stack.at(-1);
      if (!owner) continue;
      const candidate = tokens[index + 1];
      const named =
        candidate?.kind === "NAME" && tokens[index + 2]?.kind === "COLON";
      const end = statementEnd(index);
      const count = (constraintCounts.get(owner) ?? 0) + 1;
      constraintCounts.set(owner, count);
      const entry = makeEntry(
        "constraint",
        named ? candidate : token,
        index,
        end,
      );
      entry.name = named ? candidate.text : `constraint${count}`;
      append(entry);
      index = end;
      continue;
    }
    const owner = stack.at(-1);
    if (
      owner?.kind === "association" &&
      token.kind === "NAME" &&
      tokens[index + 1]?.kind === "ASSOCIATE"
    ) {
      const end = statementEnd(index);
      append(makeEntry("role", token, index, end));
      index = end;
      continue;
    }
    if (
      owner &&
      ["class", "structure", "association", "view"].includes(owner.kind) &&
      parenthesisDepth === 0 &&
      token.kind === "NAME" &&
      tokens[index + 1]?.kind === "COLON"
    ) {
      const end = statementEnd(index);
      append(makeEntry("attribute", token, index, end));
      index = end;
    }
  }
  const build = (entry: Entry): DocumentSymbol => {
    const children = entry.children.map(build);
    return {
      ...entry,
      range: enclosingRange(
        entry.range,
        children.map((child) => child.range),
      ),
      children,
    };
  };
  return roots.map(build);
}

function clampDocumentSymbol(
  symbol: DocumentSymbol,
  text: string,
): DocumentSymbol {
  const lines = text.split("\n");
  const clampPosition = (position: EditorPosition): EditorPosition => {
    const line = Math.max(0, Math.min(position.line, lines.length - 1));
    return {
      line,
      character: Math.max(
        0,
        Math.min(position.character, lines[line]?.length ?? 0),
      ),
    };
  };
  const start = clampPosition(symbol.range.start);
  const end = clampPosition(symbol.range.end);
  const selection = clampPosition(symbol.selectionRange.start);
  const children = symbol.children.map((child) =>
    clampDocumentSymbol(child, text),
  );
  const clampedRange =
    comparePositions(start, end) <= 0 ? { start, end } : { start, end: start };
  return {
    ...symbol,
    range: enclosingRange(
      clampedRange,
      children.map((child) => child.range),
    ),
    selectionRange: { start: selection, end: selection },
    children,
  };
}

function mergeSymbolLists(
  current: readonly DocumentSymbol[],
  baseline: readonly DocumentSymbol[],
  preserveUnmatched: boolean,
): DocumentSymbol[] {
  const unused = new Set(baseline.map((_, index) => index));
  const result = current.map((symbol) => {
    const matchingName = baseline.findIndex(
      (candidate, candidateIndex) =>
        unused.has(candidateIndex) &&
        candidate.kind === symbol.kind &&
        candidate.name === symbol.name,
    );
    const matchingPosition = baseline.findIndex(
      (candidate, candidateIndex) =>
        unused.has(candidateIndex) && candidate.kind === symbol.kind,
    );
    const match = matchingName >= 0 ? matchingName : matchingPosition;
    if (match < 0) return symbol;
    unused.delete(match);
    const previous = baseline[match]!;
    return {
      ...symbol,
      children: mergeSymbolLists(
        symbol.children,
        previous.children,
        preserveUnmatched,
      ),
    };
  });
  for (const index of unused) {
    const symbol = baseline[index]!;
    if (preserveUnmatched || symbol.inherited) result.push(symbol);
  }
  return result;
}

export function syntaxDocumentSymbols(
  syntax: SyntaxSnapshot,
  text: string,
  baseline: readonly DocumentSymbol[] = [],
): DocumentSymbol[] {
  if (
    syntax.success &&
    syntax.nodes.length === 0 &&
    syntax.tokens.length === 0 &&
    baseline.length > 0
  )
    return baseline.map((symbol) => clampDocumentSymbol(symbol, text));
  const parser = parserDocumentSymbols(syntax);
  const tokens = tokenDocumentSymbols(syntax);
  const current =
    syntax.success && parser.length > 0
      ? parser
      : mergeSymbolLists(tokens, parser, false);
  return mergeSymbolLists(current, baseline, !syntax.success).map((symbol) =>
    clampDocumentSymbol(symbol, text),
  );
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
