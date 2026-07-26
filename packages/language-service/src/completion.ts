import type { SemanticSnapshot, SyntaxSnapshot } from "@ilic/compiler-wasm";
import type {
  CompletionItem,
  EditorPosition,
  EditorRange,
} from "./features.js";

export type CompletionSymbolKind =
  | "model"
  | "topic"
  | "class"
  | "structure"
  | "association"
  | "view"
  | "graphic"
  | "domain"
  | "unit"
  | "attribute";

export type CompletionSlot =
  | "top-level-root"
  | "container-body-root"
  | "declaration-header-after-name"
  | "declaration-header-modifier-value"
  | "declaration-header-modifier-close"
  | "declaration-header-after-modifier"
  | "declaration-header-after-extends"
  | "extends-target"
  | "attribute-type-root"
  | "domain-type-root"
  | "unit-type-root"
  | "unit-bracket-target"
  | "unit-composed-target"
  | "unit-composed-operator"
  | "text-length-tail"
  | "text-length-value-tail"
  | "inline-numeric-range-tail"
  | "inline-numeric-upper-bound-tail"
  | "format-type-target"
  | "format-bounds-tail"
  | "collection-post-keyword"
  | "collection-target"
  | "reference-post-keyword"
  | "reference-target"
  | "meta-type-tail"
  | "qualified-member"
  | "import-model"
  | "end-name"
  | "metaattribute-root"
  | "metaattribute-value";

export interface CompletionContext {
  readonly slot: CompletionSlot;
  readonly prefix: string;
  readonly replaceRange: EditorRange;
  readonly ownerKind?: CompletionSymbolKind;
  readonly ownerName?: string;
  readonly qualifierPath?: string;
  readonly subject?: string;
  readonly fixedEqualsSuffix?: boolean;
  readonly afterMandatory?: boolean;
  readonly allowedKinds?: readonly CompletionSymbolKind[];
  readonly linePrefix: string;
  readonly lineSuffix: string;
}

interface LiveSymbol {
  readonly id: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: CompletionSymbolKind;
  parentId?: string;
  readonly start: EditorPosition;
  endLine: number;
  readonly formatted: boolean;
  closedByText?: boolean;
}

interface LineInfo {
  readonly text: string;
  readonly line: number;
}

const identifier = "[A-Za-z_][A-Za-z0-9_]*";
const qualifiedIdentifier = `${identifier}(?:\\.${identifier})*`;
const qualifiedPrefix = `${identifier}(?:\\.${identifier})*\\.?`;

const topicBodyKeywords = [
  "CLASS",
  "STRUCTURE",
  "ASSOCIATION",
  "VIEW",
  "GRAPHIC",
  "DOMAIN",
  "UNIT",
  "FUNCTION",
  "CONTEXT",
  "CONSTRAINTS",
  "SIGN BASKET",
  "REFSYSTEM BASKET",
] as const;

const modelBodyKeywords = [
  "TOPIC",
  "CLASS",
  "STRUCTURE",
  "DOMAIN",
  "UNIT",
  "FUNCTION",
  "CONTEXT",
  "LINE FORM",
] as const;

const attributeRootKeywords = [
  "MANDATORY",
  "FORMAT",
  "TEXT",
  "MTEXT",
  "NAME",
  "URI",
  "BOOLEAN",
  "NUMERIC",
  "UUIDOID",
  "COORD",
  "MULTICOORD",
  "POLYLINE",
  "MULTIPOLYLINE",
  "AREA",
  "MULTIAREA",
  "SURFACE",
  "MULTISURFACE",
  "REFERENCE",
  "BAG",
  "LIST",
] as const;

const domainRootKeywords = [
  "MANDATORY",
  "FORMAT",
  "TEXT",
  "MTEXT",
  "NAME",
  "URI",
  "BOOLEAN",
  "NUMERIC",
  "UUIDOID",
  "OID",
  "COORD",
  "MULTICOORD",
  "POLYLINE",
  "MULTIPOLYLINE",
  "AREA",
  "MULTIAREA",
  "SURFACE",
  "MULTISURFACE",
  "BLACKBOX",
  "CLASS",
  "STRUCTURE",
  "ATTRIBUTE",
  "ALL OF",
] as const;

const portableDateTimeTypes = [
  "INTERLIS.XMLDate",
  "INTERLIS.XMLDateTime",
  "INTERLIS.XMLTime",
] as const;

const nativeDateTimeTypes = ["DATE", "TIMEOFDAY", "DATETIME"] as const;

const kindAliases: Readonly<Record<string, CompletionSymbolKind | undefined>> =
  {
    model: "model",
    topic: "topic",
    class: "class",
    table: "class",
    structure: "structure",
    association: "association",
    view: "view",
    graphic: "graphic",
    domain: "domain",
    unit: "unit",
    attribute: "attribute",
  };

function normalizeKind(kind: string): CompletionSymbolKind | undefined {
  return kindAliases[kind.toLowerCase()];
}

function lineAt(text: string, line: number): LineInfo {
  return { text: text.split(/\r?\n/u)[line] ?? "", line };
}

function range(
  line: number,
  startCharacter: number,
  endCharacter: number,
): EditorRange {
  return {
    start: { line, character: Math.max(0, startCharacter) },
    end: { line, character: Math.max(startCharacter, endCharacter) },
  };
}

function ownerAt(
  symbols: readonly LiveSymbol[],
  position: EditorPosition,
): LiveSymbol | undefined {
  const containers = new Set<CompletionSymbolKind>([
    "model",
    "topic",
    "class",
    "structure",
    "association",
    "view",
    "graphic",
  ]);
  return symbols
    .filter(
      (symbol) =>
        containers.has(symbol.kind) &&
        symbol.start.line <= position.line &&
        symbol.endLine >= position.line,
    )
    .sort(
      (left, right) =>
        right.start.line - left.start.line ||
        left.endLine - right.endLine ||
        right.start.character - left.start.character,
    )[0];
}

function declarationKind(value: string): CompletionSymbolKind | undefined {
  return normalizeKind(value.replace(/\s+/gu, "").toLowerCase());
}

function parserKind(kind: string): CompletionSymbolKind | undefined {
  return normalizeKind(
    kind.replace(/(?:Definition|Def)$/u, "").replace(/^table$/iu, "class"),
  );
}

function applyParserHierarchy(
  symbols: LiveSymbol[],
  syntax: SyntaxSnapshot,
): void {
  const associations = symbols.flatMap((symbol) => {
    const candidates = syntax.nodes.filter((node) => {
      const kind = parserKind(node.kind);
      return (
        kind === symbol.kind &&
        node.range.start.line <= symbol.start.line &&
        node.range.end.line >= symbol.start.line
      );
    });
    const node = candidates.sort(
      (left, right) =>
        left.range.end.byteOffset -
        left.range.start.byteOffset -
        (right.range.end.byteOffset - right.range.start.byteOffset),
    )[0];
    return node ? [{ symbol, node }] : [];
  });
  const byNodeId = new Map(
    associations.map((association) => [association.node.id, association]),
  );
  const nodesById = new Map(syntax.nodes.map((node) => [node.id, node]));
  for (const association of associations) {
    if (syntax.success || association.symbol.closedByText)
      association.symbol.endLine = Math.min(
        association.symbol.endLine,
        association.node.range.end.line,
      );
    let parentNodeId = association.node.parent;
    while (parentNodeId !== null && !byNodeId.has(parentNodeId))
      parentNodeId = nodesById.get(parentNodeId)?.parent ?? null;
    const parserParent =
      parentNodeId === null ? undefined : byNodeId.get(parentNodeId);
    if (parserParent) association.symbol.parentId = parserParent.symbol.id;
  }
}

function buildLiveSymbols(text: string, syntax?: SyntaxSnapshot): LiveSymbol[] {
  const lines = text.split(/\r?\n/u);
  const symbols: LiveSymbol[] = [];
  const stack: LiveSymbol[] = [];
  const close = (name: string, line: number): void => {
    const index = [...stack]
      .map((entry) => entry.name.toUpperCase())
      .lastIndexOf(name.toUpperCase());
    if (index < 0) return;
    for (const entry of stack.slice(index)) {
      entry.endLine = line;
      entry.closedByText = true;
    }
    stack.splice(index);
  };
  const append = (
    name: string,
    kind: CompletionSymbolKind,
    line: number,
    character: number,
    container: boolean,
    formatted = false,
  ): LiveSymbol => {
    const parent = stack.at(-1);
    const qualifiedName = parent ? `${parent.qualifiedName}.${name}` : name;
    const symbol: LiveSymbol = {
      id: `${kind}:${line}:${character}:${name}`,
      name,
      qualifiedName,
      kind,
      parentId: parent?.id,
      start: { line, character },
      endLine: lines.length,
      formatted,
    };
    symbols.push(symbol);
    if (container) stack.push(symbol);
    return symbol;
  };
  const logicalDeclaration = (startLine: number): string => {
    const fragments: string[] = [];
    for (
      let line = startLine;
      line < Math.min(lines.length, startLine + 20);
      line += 1
    ) {
      const source = (lines[line] ?? "").replace(/!!.*$/u, "").trim();
      if (source) fragments.push(source);
      if (/[;.]\s*$/u.test(source)) break;
      if (
        line > startLine &&
        /^\s*(?:MODEL|TOPIC|CLASS|STRUCTURE|ASSOCIATION|VIEW|GRAPHIC|DOMAIN|UNIT|END)\b/iu.test(
          source,
        )
      )
        break;
    }
    return fragments.join(" ");
  };

  for (const [line, source] of lines.entries()) {
    const end = source.match(/^\s*END\s+([A-Za-z_][A-Za-z0-9_]*)\s*[.;]/iu);
    if (end?.[1]) {
      close(end[1], line);
      continue;
    }
    const viewTopic = source.match(
      /^\s*VIEW\s+TOPIC\s+([A-Za-z_][A-Za-z0-9_]*)\b/iu,
    );
    if (viewTopic?.[1]) {
      append(viewTopic[1], "topic", line, source.indexOf(viewTopic[1]), true);
      continue;
    }
    const block = source.match(
      /^\s*(MODEL|TOPIC|CLASS|STRUCTURE|ASSOCIATION|VIEW|GRAPHIC)\s+([A-Za-z_][A-Za-z0-9_]*)\b/iu,
    );
    if (block?.[1] && block[2]) {
      const kind = declarationKind(block[1]);
      if (kind) append(block[2], kind, line, source.indexOf(block[2]), true);
      continue;
    }
    const value = source.match(
      /^\s*(?:DOMAIN|UNIT)\s+([A-Za-z_][A-Za-z0-9_]*|UUIDOID)\b(.*)$/iu,
    );
    if (value?.[1]) {
      const keyword = source.trimStart().split(/\s+/u)[0]?.toLowerCase() ?? "";
      const kind = normalizeKind(keyword);
      if (kind)
        append(
          value[1],
          kind,
          line,
          source.indexOf(value[1]),
          false,
          kind === "domain" && /\bFORMAT\b/iu.test(logicalDeclaration(line)),
        );
      continue;
    }
    const attribute = source.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/u);
    if (attribute?.[1] && stack.length > 0)
      append(
        attribute[1],
        "attribute",
        line,
        source.indexOf(attribute[1]),
        false,
      );
  }
  for (const entry of stack) entry.endLine = lines.length;
  if (syntax?.nodes.length) applyParserHierarchy(symbols, syntax);
  return symbols;
}

function headerAllowedKinds(
  kind: CompletionSymbolKind | undefined,
): readonly CompletionSymbolKind[] {
  if (kind === "class") return ["class", "structure"];
  if (kind === "structure") return ["structure"];
  if (kind === "topic") return ["topic"];
  if (kind === "association") return ["association"];
  if (kind === "view") return ["view"];
  if (kind === "graphic") return ["graphic"];
  if (kind === "domain") return ["domain"];
  if (kind === "unit") return ["unit"];
  return [];
}

function allowedHeaderModifiers(
  kind: CompletionSymbolKind | undefined,
): readonly string[] {
  if (kind === "topic") return ["ABSTRACT", "FINAL"];
  if (kind === "domain") return ["ABSTRACT", "FINAL", "GENERIC"];
  if (kind === "unit") return ["ABSTRACT"];
  if (kind === "class" || kind === "structure")
    return ["ABSTRACT", "EXTENDED", "FINAL"];
  if (kind === "association" || kind === "view")
    return ["ABSTRACT", "EXTENDED", "FINAL"];
  if (kind === "graphic") return ["ABSTRACT", "FINAL"];
  return [];
}

function validHeaderShape(
  kind: CompletionSymbolKind | undefined,
  prefix: string,
  modifier?: string,
): boolean {
  if (!kind) return false;
  if (/\[[^\]]+\]/u.test(prefix) && kind !== "unit") return false;
  return (
    !modifier ||
    allowedHeaderModifiers(kind).some(
      (candidate) => candidate.toUpperCase() === modifier.toUpperCase(),
    )
  );
}

function baseContext(
  slot: CompletionSlot,
  line: LineInfo,
  prefix: string,
  suffix: string,
  replaceRange: EditorRange,
  additions: Partial<CompletionContext> = {},
): CompletionContext {
  return {
    slot,
    prefix,
    linePrefix: line.text.slice(0, replaceRange.end.character),
    lineSuffix: suffix,
    replaceRange,
    ...additions,
  };
}

function detectHeaderContext(
  line: LineInfo,
  prefix: string,
  suffix: string,
): CompletionContext | null {
  const declaration = "(CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)";
  const optionalUnitAbbreviation = "(?:\\s*\\[[^\\]]+\\])?";
  const fixed = /^\s*=\s*;?\s*$/u.test(suffix);
  let match = prefix.match(
    new RegExp(
      `^\\s*${declaration}\\s+(${identifier})${optionalUnitAbbreviation}(?:\\s*\\(\\s*(ABSTRACT|EXTENDED|FINAL|GENERIC)\\s*\\))?\\s+EXTENDS\\s+(${qualifiedIdentifier})\\s+$`,
      "iu",
    ),
  );
  if (match?.[1]) {
    const kind = declarationKind(match[1]);
    if (!validHeaderShape(kind, prefix, match[3])) return null;
    return baseContext(
      "declaration-header-after-extends",
      line,
      "",
      suffix,
      range(line.line, prefix.length, prefix.length),
      { ownerKind: kind, subject: match[4] },
    );
  }

  match = prefix.match(
    new RegExp(
      `^\\s*${declaration}\\s+(${identifier})${optionalUnitAbbreviation}(?:\\s*\\(\\s*(ABSTRACT|EXTENDED|FINAL|GENERIC)\\s*\\))?\\s+EXTENDS\\s*(${qualifiedPrefix})?$`,
      "iu",
    ),
  );
  if (match?.[1]) {
    const kind = declarationKind(match[1]);
    if (!validHeaderShape(kind, prefix, match[3])) return null;
    const subject = match[4] ?? "";
    const dot = subject.lastIndexOf(".");
    const itemPrefix = dot >= 0 ? subject.slice(dot + 1) : subject;
    return baseContext(
      "extends-target",
      line,
      itemPrefix,
      suffix,
      range(line.line, prefix.length - itemPrefix.length, prefix.length),
      {
        ownerKind: kind,
        subject,
        qualifierPath: dot >= 0 ? subject.slice(0, dot) : undefined,
        allowedKinds: headerAllowedKinds(kind),
        fixedEqualsSuffix: fixed,
      },
    );
  }

  match = prefix.match(
    new RegExp(
      `^\\s*${declaration}\\s+${identifier}${optionalUnitAbbreviation}\\s*\\(\\s*(ABSTRACT|EXTENDED|FINAL|GENERIC)\\s*$`,
      "iu",
    ),
  );
  if (match?.[1]) {
    const kind = declarationKind(match[1]);
    if (!validHeaderShape(kind, prefix, match[2])) return null;
    return baseContext(
      "declaration-header-modifier-close",
      line,
      "",
      suffix,
      range(line.line, prefix.length, prefix.length),
      { ownerKind: kind, fixedEqualsSuffix: fixed },
    );
  }

  match = prefix.match(
    new RegExp(
      `^\\s*${declaration}\\s+${identifier}${optionalUnitAbbreviation}\\s*\\(\\s*([A-Za-z_]*)$`,
      "iu",
    ),
  );
  if (match?.[1]) {
    const kind = declarationKind(match[1]);
    if (!validHeaderShape(kind, prefix)) return null;
    const itemPrefix = match[2] ?? "";
    return baseContext(
      "declaration-header-modifier-value",
      line,
      itemPrefix,
      suffix,
      range(line.line, prefix.length - itemPrefix.length, prefix.length),
      { ownerKind: kind, fixedEqualsSuffix: fixed },
    );
  }

  match = prefix.match(
    new RegExp(
      `^\\s*${declaration}\\s+${identifier}${optionalUnitAbbreviation}\\s*\\(\\s*(ABSTRACT|EXTENDED|FINAL|GENERIC)\\s*\\)\\s+([A-Za-z_]*)$`,
      "iu",
    ),
  );
  if (match?.[1]) {
    const kind = declarationKind(match[1]);
    if (!validHeaderShape(kind, prefix, match[2])) return null;
    const itemPrefix = match[3] ?? "";
    return baseContext(
      "declaration-header-after-modifier",
      line,
      itemPrefix,
      suffix,
      range(line.line, prefix.length - itemPrefix.length, prefix.length),
      { ownerKind: kind, fixedEqualsSuffix: fixed },
    );
  }

  match = prefix.match(
    new RegExp(
      `^\\s*${declaration}\\s+(${identifier})${optionalUnitAbbreviation}\\s+([A-Za-z_]*)$`,
      "iu",
    ),
  );
  if (match?.[1]) {
    const kind = declarationKind(match[1]);
    if (!validHeaderShape(kind, prefix)) return null;
    const itemPrefix = match[3] ?? "";
    return baseContext(
      "declaration-header-after-name",
      line,
      itemPrefix,
      suffix,
      range(line.line, prefix.length - itemPrefix.length, prefix.length),
      {
        ownerKind: kind,
        fixedEqualsSuffix: fixed,
        subject: /\[[^\]]+\]/u.test(prefix) ? "unit-abbreviation" : undefined,
      },
    );
  }
  return null;
}

function detectUnitExpression(
  line: LineInfo,
  expression: string,
  expressionStart: number,
  suffix: string,
): CompletionContext {
  let match = expression.match(
    new RegExp(`\\[\\s*(${qualifiedPrefix})?$`, "iu"),
  );
  if (match) {
    const subject = match[1] ?? "";
    const dot = subject.lastIndexOf(".");
    const itemPrefix = dot >= 0 ? subject.slice(dot + 1) : subject;
    return baseContext(
      "unit-bracket-target",
      line,
      itemPrefix,
      suffix,
      range(
        line.line,
        expressionStart + expression.length - itemPrefix.length,
        expressionStart + expression.length,
      ),
      {
        qualifierPath: dot >= 0 ? subject.slice(0, dot) : undefined,
        subject,
        allowedKinds: ["unit"],
        ownerKind: "unit",
      },
    );
  }
  match = expression.match(
    new RegExp(`(?:\\(|\\*\\*|\\*|/)\\s*(${qualifiedPrefix})?$`, "iu"),
  );
  if (match) {
    const subject = match[1] ?? "";
    const dot = subject.lastIndexOf(".");
    const itemPrefix = dot >= 0 ? subject.slice(dot + 1) : subject;
    return baseContext(
      "unit-composed-target",
      line,
      itemPrefix,
      suffix,
      range(
        line.line,
        expressionStart + expression.length - itemPrefix.length,
        expressionStart + expression.length,
      ),
      {
        qualifierPath: dot >= 0 ? subject.slice(0, dot) : undefined,
        subject,
        allowedKinds: ["unit"],
        ownerKind: "unit",
      },
    );
  }
  if (new RegExp(`\\([^;)]*${qualifiedIdentifier}\\s*$`, "iu").test(expression))
    return baseContext(
      "unit-composed-operator",
      line,
      "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length,
        expressionStart + expression.length,
      ),
      { ownerKind: "unit" },
    );
  const numericPrefix = expression.match(/[0-9]*$/u)?.[0] ?? "";
  return baseContext(
    "unit-type-root",
    line,
    numericPrefix,
    suffix,
    range(
      line.line,
      expressionStart + expression.length - numericPrefix.length,
      expressionStart + expression.length,
    ),
    { ownerKind: "unit" },
  );
}

function detectTypeExpression(
  line: LineInfo,
  expression: string,
  expressionStart: number,
  suffix: string,
  rootSlot: "attribute-type-root" | "domain-type-root",
  ownerKind: CompletionSymbolKind,
): CompletionContext {
  const trimmedRight = expression.replace(/\s+$/u, "");
  let match = trimmedRight.match(/(?:MANDATORY\s+)?(?:TEXT|MTEXT)\s*\*\s*$/iu);
  if (match)
    return baseContext(
      "text-length-value-tail",
      line,
      "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length,
        expressionStart + expression.length,
      ),
      { ownerKind },
    );

  match = trimmedRight.match(/(?:MANDATORY\s+)?(?:TEXT|MTEXT)\s*$/iu);
  if (match)
    return baseContext(
      "text-length-tail",
      line,
      "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length,
        expressionStart + expression.length,
      ),
      { ownerKind },
    );

  match = trimmedRight.match(
    /(?:MANDATORY\s+)?[-+]?[0-9]+(?:\.[0-9]+)?\s*\.\.\s*$/iu,
  );
  if (match)
    return baseContext(
      "inline-numeric-upper-bound-tail",
      line,
      "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length,
        expressionStart + expression.length,
      ),
      { ownerKind },
    );

  match = trimmedRight.match(/(?:MANDATORY\s+)?[-+]?[0-9]+(?:\.[0-9]+)?\s*$/iu);
  if (match)
    return baseContext(
      "inline-numeric-range-tail",
      line,
      "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length,
        expressionStart + expression.length,
      ),
      { ownerKind },
    );

  match = trimmedRight.match(
    /(?:MANDATORY\s+)?FORMAT\s+(INTERLIS\.(?:XMLDate|XMLDateTime|XMLTime))\s*$/iu,
  );
  if (match)
    return baseContext(
      "format-bounds-tail",
      line,
      "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length,
        expressionStart + expression.length,
      ),
      { ownerKind, subject: match[1] },
    );

  match = trimmedRight.match(
    new RegExp(`(?:MANDATORY\\s+)?FORMAT\\s*(${qualifiedPrefix})?$`, "iu"),
  );
  if (match) {
    const subject = match[1] ?? "";
    const dot = subject.lastIndexOf(".");
    const itemPrefix = dot >= 0 ? subject.slice(dot + 1) : subject;
    return baseContext(
      "format-type-target",
      line,
      itemPrefix,
      suffix,
      range(
        line.line,
        expressionStart + expression.length - itemPrefix.length,
        expressionStart + expression.length,
      ),
      {
        ownerKind,
        subject,
        qualifierPath: dot >= 0 ? subject.slice(0, dot) : undefined,
        allowedKinds: ["domain"],
      },
    );
  }

  match = trimmedRight.match(
    new RegExp(
      `(?:MANDATORY\\s+)?(?:LIST|BAG)(?:\\s*\\{[^}]*\\})?\\s+OF\\s*(${qualifiedPrefix})?$`,
      "iu",
    ),
  );
  if (match) {
    const subject = match[1] ?? "";
    const dot = subject.lastIndexOf(".");
    const itemPrefix = dot >= 0 ? subject.slice(dot + 1) : subject;
    return baseContext(
      "collection-target",
      line,
      itemPrefix,
      suffix,
      range(
        line.line,
        expressionStart + expression.length - itemPrefix.length,
        expressionStart + expression.length,
      ),
      {
        ownerKind,
        subject,
        qualifierPath: dot >= 0 ? subject.slice(0, dot) : undefined,
      },
    );
  }
  if (/(?:MANDATORY\s+)?(?:LIST|BAG)(?:\s*\{[^}]*\})?\s*$/iu.test(trimmedRight))
    return baseContext(
      "collection-post-keyword",
      line,
      "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length,
        expressionStart + expression.length,
      ),
      { ownerKind },
    );

  match = trimmedRight.match(
    new RegExp(
      `(?:MANDATORY\\s+)?REFERENCE\\s+TO(?:\\s*\\(\\s*EXTERNAL\\s*\\))?\\s*(${qualifiedPrefix})?$`,
      "iu",
    ),
  );
  if (match) {
    const subject = match[1] ?? "";
    const dot = subject.lastIndexOf(".");
    const itemPrefix = dot >= 0 ? subject.slice(dot + 1) : subject;
    return baseContext(
      "reference-target",
      line,
      itemPrefix,
      suffix,
      range(
        line.line,
        expressionStart + expression.length - itemPrefix.length,
        expressionStart + expression.length,
      ),
      {
        ownerKind,
        subject,
        qualifierPath: dot >= 0 ? subject.slice(0, dot) : undefined,
        allowedKinds: ["class", "association", "view"],
      },
    );
  }
  match = trimmedRight.match(/(?:MANDATORY\s+)?REFERENCE\s*([A-Za-z_]*)$/iu);
  if (match)
    return baseContext(
      "reference-post-keyword",
      line,
      match[1] ?? "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length - (match[1]?.length ?? 0),
        expressionStart + expression.length,
      ),
      { ownerKind },
    );

  match = trimmedRight.match(/\b(CLASS|STRUCTURE|ATTRIBUTE)\s*([A-Za-z_]*)$/iu);
  if (match)
    return baseContext(
      "meta-type-tail",
      line,
      match[2] ?? "",
      suffix,
      range(
        line.line,
        expressionStart + expression.length - (match[2]?.length ?? 0),
        expressionStart + expression.length,
      ),
      { ownerKind, subject: match[1]?.toUpperCase() },
    );

  const afterMandatory = /^\s*MANDATORY\b/iu.test(expression);
  const subjectMatch = trimmedRight.match(
    new RegExp(`(${qualifiedPrefix})?$`, "iu"),
  );
  const subject = subjectMatch?.[1] ?? "";
  const dot = subject.lastIndexOf(".");
  const itemPrefix = dot >= 0 ? subject.slice(dot + 1) : subject;
  return baseContext(
    dot >= 0 ? "qualified-member" : rootSlot,
    line,
    itemPrefix,
    suffix,
    range(
      line.line,
      expressionStart + expression.length - itemPrefix.length,
      expressionStart + expression.length,
    ),
    {
      ownerKind,
      subject,
      qualifierPath: dot >= 0 ? subject.slice(0, dot) : undefined,
      afterMandatory,
      allowedKinds: ["domain", "structure"],
    },
  );
}

function nextSignificantDeclaration(
  text: string,
  start: number,
): string | undefined {
  const lines = text.split(/\r?\n/u);
  const first = lines.findIndex((candidate, index) => {
    if (index < start) return false;
    const value = candidate.trim();
    return value.length > 0 && !value.startsWith("!!");
  });
  if (first < 0) return undefined;
  const result: string[] = [];
  for (let line = first; line < Math.min(lines.length, first + 20); line += 1) {
    const value = lines[line]?.trim() ?? "";
    if (!value || value.startsWith("!!")) continue;
    result.push(value);
    if (
      /[;.=]\s*$/u.test(value) ||
      (line > first &&
        /^\s*(?:MODEL|TOPIC|CLASS|STRUCTURE|ASSOCIATION|VIEW|GRAPHIC|DOMAIN|UNIT|END)\b/iu.test(
          value,
        ))
    )
      break;
  }
  return result.join(" ").replace(/\s+/gu, " ");
}

interface LogicalPrefix {
  readonly line: LineInfo;
  readonly prefix: string;
  readonly suffix: string;
  readonly character: number;
}

const logicalDeclarationStart =
  /^\s*(?:CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)\s+[A-Za-z_][A-Za-z0-9_]*\b|^\s*IMPORTS\b|^\s*[A-Za-z_][A-Za-z0-9_]*\s*:/iu;

function isLogicalBoundary(value: string): boolean {
  const code = value.replace(/!!.*$/u, "").trim();
  return (
    /[;.]\s*$/u.test(code) ||
    /^\s*(?:END|MODEL)\b/iu.test(code) ||
    (code.includes("=") &&
      !/^\s*(?:DOMAIN|UNIT)\b/iu.test(code) &&
      !/^\s*(?:CLASS|STRUCTURE|TOPIC)\b/iu.test(code))
  );
}

function logicalPrefixAt(
  syntax: SyntaxSnapshot,
  text: string,
  position: EditorPosition,
  current: LineInfo,
  character: number,
): LogicalPrefix {
  const currentPrefix = current.text.slice(0, character);
  const suffix = current.text.slice(character);
  if (
    /^\s*(?:!!@|END\b)/iu.test(currentPrefix) ||
    logicalDeclarationStart.test(currentPrefix)
  )
    return { line: current, prefix: currentPrefix, suffix, character };

  const lines = text.split(/\r?\n/u);
  const parserStarts = syntax.nodes
    .filter(
      (node) =>
        node.range.start.line < position.line &&
        node.range.start.line >= Math.max(0, position.line - 20) &&
        /(?:class|structure|topic|domain|unit|attribute).*def/iu.test(
          node.kind,
        ),
    )
    .map((node) => node.range.start.line);
  const tokenStarts = syntax.tokens
    .filter(
      (token) =>
        token.channel === 0 &&
        token.range.start.line < position.line &&
        token.range.start.line >= Math.max(0, position.line - 20) &&
        /^(?:CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT|IMPORTS)$/iu.test(token.text),
    )
    .map((token) => token.range.start.line);
  const preferredStarts = new Set([...parserStarts, ...tokenStarts]);
  let fallbackStart = -1;
  let preferredStart = -1;
  for (
    let candidate = position.line - 1;
    candidate >= Math.max(0, position.line - 20);
    candidate -= 1
  ) {
    const source = lines[candidate] ?? "";
    if (logicalDeclarationStart.test(source)) {
      if (fallbackStart < 0) fallbackStart = candidate;
      if (preferredStarts.has(candidate)) {
        preferredStart = candidate;
        break;
      }
    }
    if (isLogicalBoundary(source)) break;
  }
  const start = preferredStart >= 0 ? preferredStart : fallbackStart;
  if (start < 0)
    return { line: current, prefix: currentPrefix, suffix, character };

  const fragments = [...lines.slice(start, position.line), currentPrefix].map(
    (value) => value.replace(/!!.*$/u, "").trim(),
  );
  const prefix = fragments.filter(Boolean).join(" ").replace(/\s+/gu, " ");
  return {
    line: { line: current.line, text: `${prefix}${suffix}` },
    prefix,
    suffix,
    character,
  };
}

function rebaseLogicalContext(
  context: CompletionContext,
  logical: LogicalPrefix,
  current: LineInfo,
): CompletionContext {
  const prefixLength = context.prefix.length;
  return {
    ...context,
    replaceRange: range(
      current.line,
      logical.character - prefixLength,
      logical.character,
    ),
    linePrefix: current.text.slice(0, logical.character),
    lineSuffix: logical.suffix,
  };
}

export function detectCompletionContext(
  syntax: SyntaxSnapshot,
  text: string,
  position: EditorPosition,
): CompletionContext | null {
  if (syntax.iliVersion === "1.0") return null;
  const line = lineAt(text, position.line);
  const character = Math.max(0, Math.min(position.character, line.text.length));
  const prefix = line.text.slice(0, character);
  const suffix = line.text.slice(character);
  const symbols = buildLiveSymbols(text, syntax);
  const owner = ownerAt(symbols, position);

  let match = prefix.match(/^\s*!!@\s*([A-Za-z0-9_.]*)$/u);
  if (match)
    return baseContext(
      "metaattribute-root",
      line,
      match[1] ?? "",
      suffix,
      range(line.line, character - (match[1]?.length ?? 0), character),
      {
        subject: nextSignificantDeclaration(text, position.line + 1),
        ownerKind: owner?.kind,
      },
    );
  match = prefix.match(/^\s*!!@\s*([A-Za-z0-9_.]+)\s*=\s*(.*)$/u);
  if (match)
    return baseContext(
      "metaattribute-value",
      line,
      match[2] ?? "",
      suffix,
      range(line.line, character - (match[2]?.length ?? 0), character),
      {
        qualifierPath: match[1],
        subject: nextSignificantDeclaration(text, position.line + 1),
        ownerKind: owner?.kind,
      },
    );

  const logical = logicalPrefixAt(syntax, text, position, line, character);
  const logicalPrefix = logical.prefix;
  const logicalLine = logical.line;

  match = logicalPrefix.match(/^\s*IMPORTS\b([^;]*)$/iu);
  if (match) {
    const segment = match[1] ?? "";
    const raw = segment.slice(segment.lastIndexOf(",") + 1);
    const itemPrefix = raw.trimStart();
    return rebaseLogicalContext(
      baseContext(
        "import-model",
        logicalLine,
        itemPrefix,
        logical.suffix,
        range(
          logicalLine.line,
          logicalPrefix.length - itemPrefix.length,
          logicalPrefix.length,
        ),
      ),
      logical,
      line,
    );
  }

  match = prefix.match(/\bEND\s+([A-Za-z0-9_]*)$/iu);
  if (match)
    return baseContext(
      "end-name",
      line,
      match[1] ?? "",
      suffix,
      range(line.line, character - (match[1]?.length ?? 0), character),
      {
        ownerKind: owner?.kind,
        ownerName: owner?.name,
      },
    );

  const header = detectHeaderContext(
    logicalLine,
    logicalPrefix,
    logical.suffix,
  );
  if (header) return rebaseLogicalContext(header, logical, line);

  match = logicalPrefix.match(/^\s*DOMAIN\s+.+?=\s*(.*)$/iu);
  if (match) {
    const expression = match[1] ?? "";
    return rebaseLogicalContext(
      detectTypeExpression(
        logicalLine,
        expression,
        logicalPrefix.length - expression.length,
        logical.suffix,
        "domain-type-root",
        "domain",
      ),
      logical,
      line,
    );
  }
  match = logicalPrefix.match(/^\s*UNIT\s+.+?=\s*(.*)$/iu);
  if (match) {
    const expression = match[1] ?? "";
    return rebaseLogicalContext(
      detectUnitExpression(
        logicalLine,
        expression,
        logicalPrefix.length - expression.length,
        logical.suffix,
      ),
      logical,
      line,
    );
  }
  match = logicalPrefix.match(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*(.*)$/u);
  if (match) {
    const expression = match[1] ?? "";
    return rebaseLogicalContext(
      detectTypeExpression(
        logicalLine,
        expression,
        logicalPrefix.length - expression.length,
        logical.suffix,
        "attribute-type-root",
        owner?.kind ?? "attribute",
      ),
      logical,
      line,
    );
  }

  match = prefix.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)?\s*$/u);
  if (match && suffix.trim().length === 0) {
    const itemPrefix = match[1] ?? "";
    const slot =
      owner?.kind === "model" || owner?.kind === "topic"
        ? "container-body-root"
        : owner
          ? null
          : "top-level-root";
    if (!slot) return null;
    return baseContext(
      slot,
      line,
      itemPrefix,
      suffix,
      range(line.line, character - itemPrefix.length, character),
      { ownerKind: owner?.kind, ownerName: owner?.name },
    );
  }
  return null;
}

function startsWith(value: string, prefix: string): boolean {
  return value.toUpperCase().startsWith(prefix.toUpperCase());
}

function item(
  context: CompletionContext,
  label: string,
  kind: CompletionItem["kind"],
  options: {
    insertText?: string;
    snippet?: boolean;
    filterText?: string;
    detail?: string;
    priority?: number;
    asIs?: boolean;
  } = {},
): CompletionItem | null {
  const filterText = options.filterText ?? label;
  if (
    context.prefix &&
    !startsWith(filterText, context.prefix) &&
    !startsWith(label, context.prefix)
  )
    return null;
  const newText = options.insertText ?? label;
  return {
    label,
    kind,
    detail: options.detail,
    insertText: newText,
    insertTextFormat: options.snippet ? "snippet" : "plain",
    insertTextMode: options.asIs ? "as-is" : "adjust-indentation",
    filterText,
    sortText: `${String(options.priority ?? 40).padStart(2, "0")}-${label}`,
    textEdit: { range: context.replaceRange, newText },
  };
}

function add(result: CompletionItem[], value: CompletionItem | null): void {
  if (value) result.push(value);
}

function addKeywords(
  result: CompletionItem[],
  context: CompletionContext,
  values: readonly string[],
  priority = 40,
): void {
  for (const value of values)
    add(result, item(context, value, "keyword", { priority }));
}

function indentationUnit(text: string, ownerName?: string): string {
  const lines = text.split(/\r?\n/u);
  if (ownerName) {
    const ownerLine = lines.findIndex((line) =>
      new RegExp(
        `^\\s*(?:MODEL|TOPIC|CLASS|STRUCTURE|ASSOCIATION|VIEW|GRAPHIC)\\s+${ownerName}\\b`,
        "iu",
      ).test(line),
    );
    if (ownerLine >= 0) {
      const base = lines[ownerLine]?.match(/^\s*/u)?.[0] ?? "";
      for (const line of lines.slice(ownerLine + 1)) {
        if (!line.trim() || /^\s*END\b/iu.test(line)) continue;
        const child = line.match(/^\s*/u)?.[0] ?? "";
        if (child.startsWith(base) && child.length > base.length)
          return child.slice(base.length);
      }
      if (base.includes("\t")) return "\t";
    }
  }
  return "  ";
}

function lineIndent(text: string, line: number): string {
  return text.split(/\r?\n/u)[line]?.match(/^\s*/u)?.[0] ?? "";
}

function endNameMirror(): string {
  return "${1/^([A-Za-z_][A-Za-z0-9_]*).*$/$1/}";
}

function addNamedBlockSnippet(
  result: CompletionItem[],
  context: CompletionContext,
  text: string,
  keyword: string,
  headerSuffix: boolean,
): void {
  const base = lineIndent(text, context.replaceRange.start.line);
  const child = base + indentationUnit(text, context.ownerName);
  const suffix = headerSuffix ? " ${2:}=" : " =";
  add(
    result,
    item(context, `${keyword} Name = ... END Name;`, "snippet", {
      filterText: keyword,
      insertText: `${keyword} \${1:Name}${suffix}\n${child}$0\n${base}END ${endNameMirror()};`,
      snippet: true,
      priority: 30,
      asIs: true,
    }),
  );
}

function addContainerSnippets(
  result: CompletionItem[],
  context: CompletionContext,
  text: string,
): void {
  if (context.ownerKind === "model") {
    addNamedBlockSnippet(result, context, text, "TOPIC", true);
    addNamedBlockSnippet(result, context, text, "CLASS", true);
    addNamedBlockSnippet(result, context, text, "STRUCTURE", true);
  } else {
    addNamedBlockSnippet(result, context, text, "CLASS", true);
    addNamedBlockSnippet(result, context, text, "STRUCTURE", true);
    addNamedBlockSnippet(result, context, text, "ASSOCIATION", true);
    addNamedBlockSnippet(result, context, text, "VIEW", true);
    addNamedBlockSnippet(result, context, text, "GRAPHIC", true);
    const base = lineIndent(text, context.replaceRange.start.line);
    const child = base + indentationUnit(text, context.ownerName);
    add(
      result,
      item(context, "VIEW TOPIC Name = ... END Name;", "snippet", {
        filterText: "VIEW TOPIC",
        insertText: `VIEW TOPIC \${1:Name} \${2:}=\n${child}DEPENDS ON \${3:Topic}\n${child}$0\n${base}END ${endNameMirror()};`,
        snippet: true,
        priority: 30,
        asIs: true,
      }),
    );
  }
  for (const keyword of ["DOMAIN", "UNIT"] as const)
    add(
      result,
      item(context, `${keyword} Name = ...;`, "snippet", {
        filterText: keyword,
        insertText: `${keyword} \${1:Name} \${2:}= \${3};$0`,
        snippet: true,
        priority: 30,
      }),
    );
  add(
    result,
    item(context, "CONTEXT Name = ...;", "snippet", {
      filterText: "CONTEXT",
      insertText: "CONTEXT ${1:Name} = ${2};",
      snippet: true,
      priority: 30,
    }),
  );
}

function localCandidates(
  context: CompletionContext,
  symbols: readonly LiveSymbol[],
  position: EditorPosition,
): LiveSymbol[] {
  const allowed = new Set(context.allowedKinds ?? []);
  const owner = ownerAt(symbols, position);
  const containerChain: LiveSymbol[] = [];
  let container = owner;
  while (container) {
    containerChain.push(container);
    container = container.parentId
      ? symbols.find((candidate) => candidate.id === container?.parentId)
      : undefined;
  }
  const visibleContainerIds = new Set(containerChain.map((entry) => entry.id));
  const declaredBeforeCaret = (symbol: LiveSymbol): boolean =>
    symbol.start.line < position.line ||
    (symbol.start.line === position.line &&
      symbol.start.character < position.character);
  const scopeDistance = (symbol: LiveSymbol): number => {
    if (!symbol.parentId) return containerChain.length + 1;
    const index = containerChain.findIndex(
      (candidate) => candidate.id === symbol.parentId,
    );
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  const baseCandidates = symbols.filter(
    (symbol) =>
      declaredBeforeCaret(symbol) &&
      symbol.id !== owner?.id &&
      (allowed.size === 0 || allowed.has(symbol.kind)),
  );

  const resolveQualifier = (path: string): LiveSymbol | undefined => {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) return undefined;
    const exact = symbols.filter(
      (symbol) =>
        symbol.qualifiedName.toUpperCase() === path.toUpperCase() &&
        declaredBeforeCaret(symbol),
    );
    if (exact.length === 1) return exact[0];
    const roots = symbols
      .filter(
        (symbol) =>
          symbol.name.toUpperCase() === parts[0]!.toUpperCase() &&
          declaredBeforeCaret(symbol) &&
          (!symbol.parentId || visibleContainerIds.has(symbol.parentId)),
      )
      .sort(
        (left, right) =>
          scopeDistance(left) - scopeDistance(right) ||
          right.start.line - left.start.line ||
          right.start.character - left.start.character,
      );
    let resolved = roots[0];
    for (const part of parts.slice(1)) {
      if (!resolved) return undefined;
      resolved = symbols
        .filter(
          (symbol) =>
            symbol.parentId === resolved?.id &&
            symbol.name.toUpperCase() === part.toUpperCase() &&
            declaredBeforeCaret(symbol),
        )
        .sort(
          (left, right) =>
            right.start.line - left.start.line ||
            right.start.character - left.start.character,
        )[0];
    }
    return resolved;
  };

  if (context.qualifierPath) {
    const parent = resolveQualifier(context.qualifierPath);
    return parent
      ? baseCandidates.filter((symbol) => symbol.parentId === parent.id)
      : [];
  }

  const candidates = baseCandidates
    .filter(
      (symbol) => !symbol.parentId || visibleContainerIds.has(symbol.parentId),
    )
    .sort(
      (left, right) =>
        scopeDistance(left) - scopeDistance(right) ||
        right.start.line - left.start.line ||
        right.start.character - left.start.character,
    );
  const visible = new Map<string, LiveSymbol>();
  for (const symbol of candidates) {
    const key = `${symbol.kind}:${symbol.name.toUpperCase()}`;
    if (!visible.has(key)) visible.set(key, symbol);
  }
  return [...visible.values()];
}

function semanticCandidates(
  context: CompletionContext,
  syntax: SyntaxSnapshot,
  semantic: SemanticSnapshot | null,
): CompletionItem[] {
  if (!semantic) return [];
  const allowed = new Set(context.allowedKinds ?? []);
  const imported = new Set(syntax.imports.map((name) => name.toUpperCase()));
  const candidates = semantic.symbols.filter((symbol) => {
    const kind = normalizeKind(symbol.kind);
    if (!kind || (allowed.size > 0 && !allowed.has(kind))) return false;
    if (symbol.range?.uri === syntax.uri) return false;
    const model = symbol.qualifiedName.split(".")[0]?.toUpperCase() ?? "";
    return model === "INTERLIS" || imported.has(model);
  });
  let filtered = candidates;
  if (context.qualifierPath) {
    const exactParents = semantic.symbols.filter(
      (symbol) =>
        symbol.qualifiedName.toUpperCase() ===
        context.qualifierPath!.toUpperCase(),
    );
    const suffixParents = semantic.symbols.filter((symbol) =>
      symbol.qualifiedName
        .toUpperCase()
        .endsWith(`.${context.qualifierPath!.toUpperCase()}`),
    );
    const parent =
      exactParents.length === 1
        ? exactParents[0]
        : suffixParents.length === 1
          ? suffixParents[0]
          : undefined;
    filtered = parent
      ? candidates.filter((symbol) => symbol.containerId === parent.id)
      : [];
  }
  return filtered.flatMap((symbol) => {
    const kind = normalizeKind(symbol.kind);
    const value = item(
      context,
      symbol.name,
      kind === "domain" || kind === "unit" ? "value" : "class",
      { detail: symbol.qualifiedName, priority: 20 },
    );
    return value ? [value] : [];
  });
}

function addTargetCandidates(
  result: CompletionItem[],
  context: CompletionContext,
  syntax: SyntaxSnapshot,
  semantic: SemanticSnapshot | null,
  text: string,
  position: EditorPosition,
): void {
  const symbols = buildLiveSymbols(text, syntax);
  for (const symbol of localCandidates(context, symbols, position))
    add(
      result,
      item(
        context,
        symbol.name,
        symbol.kind === "domain" || symbol.kind === "unit" ? "value" : "class",
        { detail: symbol.qualifiedName, priority: 10 },
      ),
    );
  result.push(...semanticCandidates(context, syntax, semantic));
}

type MetaAttributeProfile =
  | "structure"
  | "class"
  | "attribute"
  | "structure-attribute"
  | "reference-attribute"
  | "role"
  | "constraint"
  | "enum";

function metaAttributeProfiles(
  subject: string | undefined,
  symbols: readonly LiveSymbol[],
  position: EditorPosition,
): ReadonlySet<MetaAttributeProfile> {
  const value = subject?.trim() ?? "";
  if (/^STRUCTURE\b/iu.test(value)) return new Set(["structure"]);
  if (/^CLASS\b/iu.test(value)) return new Set(["class"]);
  if (
    /^(?:MANDATORY\s+CONSTRAINT|CONSTRAINT|EXISTENCE\s+CONSTRAINT|SET\s+CONSTRAINT)\b/iu.test(
      value,
    )
  )
    return new Set(["constraint"]);
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*--/u.test(value)) return new Set(["role"]);
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/u.test(value)) {
    const profiles = new Set<MetaAttributeProfile>(["attribute"]);
    if (
      /\b(?:LIST|BAG)\b(?:\s*\{[^}]*\})?\s+OF\b|\b(?:ANYSTRUCTURE|STRUCTURE)\b/iu.test(
        value,
      )
    ) {
      profiles.add("structure-attribute");
      profiles.add("reference-attribute");
      return profiles;
    }
    if (/\bREFERENCE\s+TO\b/iu.test(value)) {
      profiles.add("reference-attribute");
      return profiles;
    }
    const directType = value.match(
      /:\s*(?:MANDATORY\s+)?([A-Za-z_][A-Za-z0-9_.]*)\b/u,
    )?.[1];
    if (directType) {
      const matches = symbols.filter(
        (symbol) =>
          symbol.kind === "structure" &&
          (symbol.name.toUpperCase() === directType.toUpperCase() ||
            symbol.qualifiedName.toUpperCase() === directType.toUpperCase() ||
            symbol.qualifiedName
              .toUpperCase()
              .endsWith(`.${directType.toUpperCase()}`)) &&
          (symbol.start.line < position.line ||
            (symbol.start.line === position.line &&
              symbol.start.character < position.character)),
      );
      if (matches.length === 1) {
        profiles.add("structure-attribute");
        profiles.add("reference-attribute");
      }
    }
    return profiles;
  }
  if (/^[A-Za-z_][A-Za-z0-9_.]*(?:\s*[,()]|\s*$)/u.test(value))
    return new Set(["enum"]);
  return new Set();
}

interface MetaAttributeSnippet {
  readonly label: string;
  readonly insertText: string;
  readonly filterText?: string;
}

function severityAssignments(name: string): MetaAttributeSnippet[] {
  return ["on", "warning", "off"].map((severity) => ({
    label: `${name}=${severity}`,
    insertText: `${name}=${severity}`,
  }));
}

function metaAttributeRootSnippets(
  profiles: ReadonlySet<MetaAttributeProfile>,
): readonly MetaAttributeSnippet[] {
  const result: MetaAttributeSnippet[] = [];
  if (profiles.has("structure")) {
    for (const mapping of [
      "MultiSurface",
      "MultiLine",
      "MultiPoint",
      "Multilingual",
      "Localised",
    ])
      result.push({
        label: `ili2db.mapping=${mapping}`,
        insertText: `ili2db.mapping=${mapping}`,
      });
    result.push({
      label: 'ili2db.dispName="..."',
      insertText: 'ili2db.dispName="${1:Text}"',
    });
  }
  if (profiles.has("class"))
    result.push(
      {
        label: 'ili2db.dispName="..."',
        insertText: 'ili2db.dispName="${1:Text}"',
      },
      {
        label: "ili2db.oid=INTERLIS.UUIDOID",
        insertText: "ili2db.oid=${1:INTERLIS.UUIDOID}",
      },
      {
        label: 'ilivalid.keymsg="..."',
        insertText: 'ilivalid.keymsg="${1:Text}"',
      },
      {
        label: 'ilivalid.keymsg_<lang>="..."',
        insertText: 'ilivalid.keymsg_${1:de}="${2:Text}"',
      },
    );
  if (profiles.has("attribute"))
    result.push(
      {
        label: 'ili2db.dispName="..."',
        insertText: 'ili2db.dispName="${1:Text}"',
      },
      ...severityAssignments("ilivalid.type"),
      ...severityAssignments("ilivalid.multiplicity"),
    );
  if (profiles.has("structure-attribute"))
    for (const mapping of ["ARRAY", "JSON", "EXPAND"])
      result.push({
        label: `ili2db.mapping=${mapping}`,
        insertText: `ili2db.mapping=${mapping}`,
      });
  if (
    profiles.has("structure-attribute") ||
    profiles.has("reference-attribute")
  )
    result.push({
      label: "ilivalid.requiredIn=bid1",
      insertText: "ilivalid.requiredIn=${1:bid1}",
    });
  if (profiles.has("role"))
    result.push(
      ...severityAssignments("ilivalid.target"),
      ...severityAssignments("ilivalid.multiplicity"),
      {
        label: "ilivalid.requiredIn=bid1",
        insertText: "ilivalid.requiredIn=${1:bid1}",
      },
    );
  if (profiles.has("constraint"))
    result.push(
      ...severityAssignments("ilivalid.check"),
      { label: "category=...", insertText: "category=${1:category}" },
      {
        label: 'ilivalid.msg="..."',
        insertText: 'ilivalid.msg="${1:Text}"',
      },
      {
        label: 'ilivalid.msg_<lang>="..."',
        insertText: 'ilivalid.msg_${1:de}="${2:Text}"',
      },
      { label: 'message="..."', insertText: 'message="${1:Text}"' },
      {
        label: 'message_<lang>="..."',
        insertText: 'message_${1:de}="${2:Text}"',
      },
      { label: "name=c1023", insertText: "name=${1:c1023}" },
    );
  if (profiles.has("enum"))
    result.push({
      label: 'ili2db.dispName="..."',
      insertText: 'ili2db.dispName="${1:Text}"',
    });
  return result;
}

function addMetaAttributeItems(
  result: CompletionItem[],
  context: CompletionContext,
  syntax: SyntaxSnapshot,
  text: string,
  position: EditorPosition,
): void {
  const profiles = metaAttributeProfiles(
    context.subject,
    buildLiveSymbols(text, syntax),
    position,
  );
  if (profiles.size === 0) return;
  if (context.slot === "metaattribute-root") {
    for (const snippet of metaAttributeRootSnippets(profiles))
      add(
        result,
        item(context, snippet.label, "snippet", {
          filterText:
            snippet.filterText ??
            snippet.label.slice(0, snippet.label.indexOf("=")),
          insertText: snippet.insertText,
          snippet: true,
          priority: 30,
        }),
      );
    return;
  }
  const name = context.qualifierPath?.toLowerCase() ?? "";
  if (name === "ili2db.mapping") {
    const values = profiles.has("structure")
      ? ["MultiSurface", "MultiLine", "MultiPoint", "Multilingual", "Localised"]
      : profiles.has("structure-attribute")
        ? ["ARRAY", "JSON", "EXPAND"]
        : [];
    addKeywords(result, context, values, 10);
    return;
  }
  if (
    [
      "ilivalid.type",
      "ilivalid.multiplicity",
      "ilivalid.target",
      "ilivalid.check",
    ].includes(name)
  ) {
    addKeywords(result, context, ["on", "warning", "off"], 10);
    return;
  }
  const quoted = [
    "ili2db.dispname",
    "ilivalid.keymsg",
    "ilivalid.msg",
    "message",
  ].some((candidate) => name === candidate || name.startsWith(`${candidate}_`));
  const defaults: Readonly<
    Record<string, readonly [string, string] | undefined>
  > = {
    "ili2db.oid": ["INTERLIS.UUIDOID", "${1:INTERLIS.UUIDOID}"],
    "ilivalid.requiredin": ["bid1", "${1:bid1}"],
    category: ["category", "${1:category}"],
    name: ["c1023", "${1:c1023}"],
  };
  const value = quoted ? ['"..."', '"${1:Text}"'] : defaults[name];
  if (value)
    add(
      result,
      item(context, value[0], "snippet", {
        insertText: value[1],
        snippet: true,
        priority: 10,
      }),
    );
}

export function completionItemsAt(
  syntax: SyntaxSnapshot,
  text: string,
  semantic: SemanticSnapshot | null,
  position: EditorPosition,
): CompletionItem[] {
  const context = detectCompletionContext(syntax, text, position);
  if (!context) return [];
  const result: CompletionItem[] = [];
  const language24 = syntax.iliVersion === "2.4";

  switch (context.slot) {
    case "top-level-root":
      add(result, item(context, "MODEL", "keyword", { priority: 25 }));
      add(
        result,
        item(
          context,
          "MODEL Name (lang) AT ... VERSION ... = ... END Name.",
          "snippet",
          {
            filterText: "MODEL",
            insertText:
              'MODEL ${1:Name} (${2:de})\n  AT "${3:https://example.com}"\n  VERSION "${4:YYYY-MM-DD}"\n  =\n  $0\nEND ${1/^([A-Za-z_][A-Za-z0-9_]*).*$/$1/}.',
            snippet: true,
            priority: 30,
            asIs: true,
          },
        ),
      );
      break;
    case "container-body-root":
      addKeywords(
        result,
        context,
        context.ownerKind === "model" ? modelBodyKeywords : topicBodyKeywords,
        25,
      );
      addContainerSnippets(result, context, text);
      break;
    case "declaration-header-after-name":
      if (
        context.ownerKind === "unit" &&
        context.subject !== "unit-abbreviation"
      )
        add(
          result,
          item(context, "[Name]", "snippet", {
            insertText: "[${1:abbr}] ",
            snippet: true,
            priority: 5,
          }),
        );
      for (const modifier of allowedHeaderModifiers(context.ownerKind))
        add(
          result,
          item(context, `(${modifier})`, "keyword", {
            insertText: `(${modifier}) `,
            priority: 5,
          }),
        );
      add(
        result,
        item(context, "EXTENDS", "keyword", {
          insertText: "EXTENDS ",
          priority: 5,
        }),
      );
      if (!context.fixedEqualsSuffix)
        add(
          result,
          item(context, "=", "keyword", { insertText: "= ", priority: 5 }),
        );
      break;
    case "declaration-header-modifier-value":
      addKeywords(
        result,
        context,
        allowedHeaderModifiers(context.ownerKind),
        5,
      );
      break;
    case "declaration-header-modifier-close":
      add(result, item(context, ")", "keyword", { priority: 5 }));
      break;
    case "declaration-header-after-modifier":
      add(
        result,
        item(context, "EXTENDS", "keyword", {
          insertText: "EXTENDS ",
          priority: 5,
        }),
      );
      if (!context.fixedEqualsSuffix)
        add(
          result,
          item(context, "=", "keyword", { insertText: "= ", priority: 5 }),
        );
      break;
    case "declaration-header-after-extends":
      add(
        result,
        item(context, "=", "keyword", { insertText: "= ", priority: 5 }),
      );
      break;
    case "extends-target":
    case "reference-target":
    case "unit-bracket-target":
    case "unit-composed-target":
      addTargetCandidates(result, context, syntax, semantic, text, position);
      break;
    case "collection-target": {
      const allowed: CompletionSymbolKind[] = language24
        ? ["domain", "structure"]
        : ["structure"];
      const target = { ...context, allowedKinds: allowed };
      addTargetCandidates(result, target, syntax, semantic, text, position);
      break;
    }
    case "attribute-type-root": {
      const keywords = context.afterMandatory
        ? attributeRootKeywords.filter((value) => value !== "MANDATORY")
        : attributeRootKeywords;
      addKeywords(result, context, keywords);
      if (language24) addKeywords(result, context, nativeDateTimeTypes);
      addKeywords(result, context, portableDateTimeTypes);
      for (const [label, insertText, filterText] of [
        ["LIST OF ...", "LIST OF ${1:Type}", "LIST"],
        ["LIST {...} OF ...", "LIST {${1:0..*}} OF ${2:Type}", "LIST"],
        ["BAG OF ...", "BAG OF ${1:Type}", "BAG"],
        ["BAG {...} OF ...", "BAG {${1:0..*}} OF ${2:Type}", "BAG"],
        ["REFERENCE TO ...", "REFERENCE TO ${1:Target}", "REFERENCE"],
      ] as const)
        add(
          result,
          item(context, label, "snippet", {
            insertText,
            filterText,
            snippet: true,
            priority: 30,
          }),
        );
      if (context.prefix)
        addKeywords(
          result,
          context,
          ["CLASS", "STRUCTURE", "ATTRIBUTE", "ANYSTRUCTURE"],
          50,
        );
      addTargetCandidates(result, context, syntax, semantic, text, position);
      break;
    }
    case "domain-type-root": {
      const keywords = context.afterMandatory
        ? domainRootKeywords.filter((value) => value !== "MANDATORY")
        : domainRootKeywords;
      addKeywords(result, context, keywords);
      if (language24) addKeywords(result, context, nativeDateTimeTypes);
      addKeywords(result, context, portableDateTimeTypes);
      for (const [label, insertText, filterText] of [
        ["TEXT*<length>", "TEXT*${1:255}", "TEXT"],
        ["MTEXT*<length>", "MTEXT*${1:255}", "MTEXT"],
        ["(A, B, C)", "(${1:A}, ${2:B}, ${3:C})", "("],
        ["1 .. 10", "${1:1} .. ${2:10}", ""],
        [
          "CLASS RESTRICTION (...)",
          "CLASS RESTRICTION (${1:Viewable})",
          "CLASS",
        ],
        ["ALL OF BaseDomain", "ALL OF ${1:BaseDomain}", "ALL"],
      ] as const)
        add(
          result,
          item(context, label, "snippet", {
            insertText,
            filterText,
            snippet: true,
            priority: 30,
          }),
        );
      addTargetCandidates(result, context, syntax, semantic, text, position);
      break;
    }
    case "unit-type-root":
      for (const [label, insertText] of [
        ["[BaseUnit]", "[${1:BaseUnit}]"],
        ["1000 [BaseUnit]", "${1:1000} [${2:BaseUnit}]"],
        ["(UnitA / UnitB)", "(${1:UnitA} / ${2})"],
        ["(UnitA * UnitB)", "(${1:UnitA} * ${2})"],
      ] as const)
        add(
          result,
          item(context, label, "snippet", {
            insertText,
            snippet: true,
            priority: 30,
          }),
        );
      break;
    case "unit-composed-operator":
      addKeywords(result, context, ["*", "/", "**", ")"], 5);
      break;
    case "text-length-tail":
      add(result, item(context, "*", "keyword", { priority: 5 }));
      add(
        result,
        item(context, "* <length>", "snippet", {
          filterText: "*",
          insertText: "*${1:255}",
          snippet: true,
          priority: 30,
        }),
      );
      break;
    case "text-length-value-tail":
      add(
        result,
        item(context, "<length>", "snippet", {
          insertText: "${1:255}",
          snippet: true,
          priority: 30,
        }),
      );
      break;
    case "inline-numeric-range-tail":
      add(
        result,
        item(context, "..", "keyword", { insertText: ".. ", priority: 5 }),
      );
      add(
        result,
        item(context, ".. <upper>", "snippet", {
          insertText: ".. ${1}",
          snippet: true,
          priority: 30,
        }),
      );
      break;
    case "inline-numeric-upper-bound-tail":
      add(
        result,
        item(context, "<upper>", "snippet", {
          insertText: "${1}",
          snippet: true,
          priority: 30,
        }),
      );
      break;
    case "format-type-target": {
      if (context.qualifierPath?.toUpperCase() === "INTERLIS")
        addKeywords(
          result,
          context,
          portableDateTimeTypes.map((value) => value.slice("INTERLIS.".length)),
        );
      else addKeywords(result, context, portableDateTimeTypes);
      add(
        result,
        item(context, "BASED ON ...", "snippet", {
          filterText: "BASED",
          insertText: "BASED ON ${1:BaseDomain}",
          snippet: true,
          priority: 30,
        }),
      );
      const liveSymbols = buildLiveSymbols(text, syntax);
      for (const symbol of localCandidates(
        { ...context, allowedKinds: ["domain"], qualifierPath: undefined },
        liveSymbols,
        position,
      ).filter((candidate) => candidate.formatted))
        add(
          result,
          item(context, symbol.name, "value", {
            detail: symbol.qualifiedName,
            priority: 10,
          }),
        );
      break;
    }
    case "format-bounds-tail": {
      const defaults = context.subject?.endsWith("XMLTime")
        ? ['"00:00:00"', '"23:59:59"']
        : context.subject?.endsWith("XMLDateTime")
          ? ['"2000-01-01T00:00:00"', '"2099-12-31T23:59:59"']
          : ['"2000-01-01"', '"2099-12-31"'];
      add(
        result,
        item(context, "<min> .. <max>", "snippet", {
          insertText: `${defaults[0]} .. ${defaults[1]}`,
          snippet: true,
          priority: 30,
        }),
      );
      break;
    }
    case "collection-post-keyword":
      addKeywords(result, context, ["{", "OF"], 5);
      break;
    case "reference-post-keyword":
      add(
        result,
        item(context, "TO", "keyword", { insertText: "TO ", priority: 5 }),
      );
      break;
    case "meta-type-tail":
      if (context.subject === "ATTRIBUTE")
        add(
          result,
          item(context, "OF", "keyword", { insertText: "OF ", priority: 5 }),
        );
      else
        add(
          result,
          item(context, "RESTRICTION", "keyword", {
            insertText: "RESTRICTION (",
            priority: 5,
          }),
        );
      break;
    case "qualified-member": {
      if (context.qualifierPath?.toUpperCase() === "INTERLIS") {
        addKeywords(
          result,
          context,
          portableDateTimeTypes.map((value) => value.slice("INTERLIS.".length)),
        );
      } else {
        addTargetCandidates(result, context, syntax, semantic, text, position);
      }
      break;
    }
    case "end-name":
      if (context.ownerName)
        add(
          result,
          item(context, context.ownerName, "value", {
            priority: 5,
            detail: context.ownerKind?.toUpperCase(),
          }),
        );
      break;
    case "metaattribute-root":
    case "metaattribute-value":
      addMetaAttributeItems(result, context, syntax, text, position);
      break;
    case "import-model":
      {
        const already = new Set(
          syntax.imports.map((value) => value.toUpperCase()),
        );
        const modelNames = new Set(
          buildLiveSymbols(text, syntax)
            .filter(
              (symbol) =>
                symbol.kind === "model" && symbol.start.line < position.line,
            )
            .map((symbol) => symbol.name),
        );
        for (const symbol of semantic?.symbols ?? [])
          if (normalizeKind(symbol.kind) === "model")
            modelNames.add(symbol.name);
        for (const model of [...modelNames].sort((left, right) =>
          left.localeCompare(right),
        ))
          if (!already.has(model.toUpperCase()))
            add(
              result,
              item(context, model, "module", {
                priority: 20,
              }),
            );
      }
      break;
  }

  const seen = new Set<string>();
  return result.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.label}:${candidate.textEdit?.newText ?? candidate.insertText ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
