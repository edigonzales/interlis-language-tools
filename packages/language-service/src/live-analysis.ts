import type {
  Diagnostic,
  EditorDeclaration,
  EditorReference,
  EditorSnapshot,
  SemanticSnapshot,
  SemanticSymbol,
  SourceRange,
} from "@ilic/compiler-wasm";
import type { EditorPosition, EditorRange, TextEdit } from "./features.js";

export interface LiveQuickFix {
  readonly title: string;
  readonly diagnosticCode: string;
  readonly diagnosticRange: EditorRange;
  readonly edits: Readonly<Record<string, readonly TextEdit[]>>;
}

export interface LiveAnalysisResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly fixes: readonly LiveQuickFix[];
}

const builtinNames = new Set([
  "TEXT",
  "MTEXT",
  "NAME",
  "URI",
  "BOOLEAN",
  "NUMERIC",
  "UUIDOID",
  "OID",
  "DATE",
  "TIMEOFDAY",
  "DATETIME",
  "COORD",
  "MULTICOORD",
  "POLYLINE",
  "MULTIPOLYLINE",
  "AREA",
  "MULTIAREA",
  "SURFACE",
  "MULTISURFACE",
  "BLACKBOX",
  "ANYSTRUCTURE",
]);

function editorRange(range: SourceRange): EditorRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function comparePosition(left: EditorPosition, right: EditorPosition): number {
  return left.line - right.line || left.character - right.character;
}

function contains(range: SourceRange, position: EditorPosition): boolean {
  return (
    comparePosition(editorRange(range).start, position) <= 0 &&
    comparePosition(editorRange(range).end, position) >= 0
  );
}

function overlaps(left: SourceRange, right: SourceRange): boolean {
  return (
    comparePosition(editorRange(left).start, editorRange(right).end) < 0 &&
    comparePosition(editorRange(right).start, editorRange(left).end) < 0
  );
}

function lineStarts(text: string): number[] {
  const result = [0];
  for (let index = 0; index < text.length; index += 1)
    if (text[index] === "\n") result.push(index + 1);
  return result;
}

function sourceRange(
  uri: string,
  text: string,
  starts: readonly number[],
  line: number,
  startCharacter: number,
  endCharacter: number,
): SourceRange {
  const startIndex = (starts[line] ?? text.length) + startCharacter;
  const endIndex = (starts[line] ?? text.length) + endCharacter;
  return {
    uri,
    start: {
      line,
      character: startCharacter,
      byteOffset: new TextEncoder().encode(text.slice(0, startIndex)).length,
    },
    end: {
      line,
      character: endCharacter,
      byteOffset: new TextEncoder().encode(text.slice(0, endIndex)).length,
    },
  };
}

function diagnostic(
  code: string,
  message: string,
  range: SourceRange,
  severity: Diagnostic["severity"] = "error",
  tags?: Diagnostic["tags"],
): Diagnostic {
  return {
    severity,
    code,
    message,
    range,
    relatedInformation: [],
    notes: [],
    treatedAsError: false,
    source: severity === "warning" ? "lint" : "live",
    ...(tags ? { tags } : {}),
  };
}

function normalizeKind(kind: string): string {
  const value = kind.toLowerCase();
  if (value === "table") return "class";
  return value.replace(/(?:definition|def)$/u, "");
}

function allowedKinds(
  snapshot: EditorSnapshot,
  reference: EditorReference,
): ReadonlySet<string> {
  if (reference.kind === "reference")
    return new Set(["class", "association", "view"]);
  if (reference.kind === "collection")
    return snapshot.iliVersion === "2.4"
      ? new Set(["domain", "structure"])
      : new Set(["structure"]);
  if (reference.kind === "unit") return new Set(["unit"]);
  if (reference.kind === "extends") {
    const owner = snapshot.declarations.find(
      (declaration) => declaration.id === reference.sourceId,
    );
    if (owner?.kind === "class") return new Set(["class", "structure"]);
    if (owner?.kind === "structure") return new Set(["structure"]);
    return new Set(owner ? [owner.kind] : []);
  }
  return new Set(["domain", "structure", "class"]);
}

function declarationChain(
  snapshot: EditorSnapshot,
  sourceId: string | null,
): Set<string | null> {
  const result = new Set<string | null>([null]);
  const byId = new Map(
    snapshot.declarations.map((declaration) => [declaration.id, declaration]),
  );
  let current = sourceId ? byId.get(sourceId) : undefined;
  while (current) {
    result.add(current.id);
    result.add(current.containerId);
    current = current.containerId ? byId.get(current.containerId) : undefined;
  }
  return result;
}

function visibleLocalMatches(
  snapshot: EditorSnapshot,
  reference: EditorReference,
  includeForward = false,
): EditorDeclaration[] {
  const kinds = allowedKinds(snapshot, reference);
  const path = reference.text.toUpperCase();
  const chain = declarationChain(snapshot, reference.sourceId);
  return snapshot.declarations.filter((declaration) => {
    if (!kinds.has(declaration.kind)) return false;
    if (
      !includeForward &&
      declaration.selectionRange.start.byteOffset >=
        reference.range.start.byteOffset
    )
      return false;
    if (path.includes("."))
      return (
        declaration.qualifiedName.toUpperCase() === path ||
        declaration.qualifiedName.toUpperCase().endsWith(`.${path}`)
      );
    return (
      declaration.name.toUpperCase() === path &&
      chain.has(declaration.containerId)
    );
  });
}

function importedModel(
  snapshot: EditorSnapshot,
  symbol: SemanticSymbol,
  requireUnqualified: boolean,
): boolean {
  const model = symbol.qualifiedName.split(".", 1)[0]?.toUpperCase();
  if (!model) return false;
  return snapshot.imports.some(
    (entry) =>
      entry.model.toUpperCase() === model &&
      (!requireUnqualified || entry.unqualified),
  );
}

function semanticMatches(
  snapshot: EditorSnapshot,
  reference: EditorReference,
  semantic: SemanticSnapshot | null,
): SemanticSymbol[] {
  if (!semantic) return [];
  const kinds = allowedKinds(snapshot, reference);
  const path = reference.text.toUpperCase();
  const qualified = path.includes(".");
  return semantic.symbols.filter((symbol) => {
    if (!kinds.has(normalizeKind(symbol.kind))) return false;
    if (!importedModel(snapshot, symbol, !qualified)) return false;
    return qualified
      ? symbol.qualifiedName.toUpperCase() === path
      : symbol.name.toUpperCase() === path;
  });
}

function workspaceMatches(
  snapshot: EditorSnapshot,
  reference: EditorReference,
  declarations: readonly EditorDeclaration[],
): EditorDeclaration[] {
  const kinds = allowedKinds(snapshot, reference);
  const path = reference.text.toUpperCase();
  const qualified = path.includes(".");
  const localModel = snapshot.declarations
    .find((declaration) => declaration.kind === "model")
    ?.name.toUpperCase();
  return declarations.filter((declaration) => {
    if (declaration.selectionRange.uri === snapshot.uri) return false;
    if (!kinds.has(declaration.kind)) return false;
    const model = declaration.qualifiedName.split(".", 1)[0]?.toUpperCase();
    if (!model) return false;
    if (qualified) {
      const qualifier = path.split(".", 1)[0];
      if (
        qualifier !== localModel &&
        !snapshot.imports.some(
          (entry) => entry.model.toUpperCase() === qualifier,
        )
      )
        return false;
      const candidate = declaration.qualifiedName.toUpperCase();
      return candidate === path || candidate.endsWith(`.${path}`);
    }
    if (
      model !== localModel &&
      !snapshot.imports.some(
        (entry) => entry.unqualified && entry.model.toUpperCase() === model,
      )
    )
      return false;
    return declaration.name.toUpperCase() === path;
  });
}

export function resolveEditorReference(
  snapshot: EditorSnapshot,
  reference: EditorReference,
  semantic: SemanticSnapshot | null,
  workspaceDeclarations: readonly EditorDeclaration[] = [],
):
  | { readonly kind: "editor"; readonly declaration: EditorDeclaration }
  | { readonly kind: "semantic"; readonly symbol: SemanticSymbol }
  | null {
  if (
    reference.text.toUpperCase().startsWith("INTERLIS.") ||
    builtinNames.has(reference.text.toUpperCase())
  )
    return null;
  const local = visibleLocalMatches(snapshot, reference);
  if (local.length === 1) return { kind: "editor", declaration: local[0]! };
  if (local.length > 1) return null;
  const workspace = workspaceMatches(
    snapshot,
    reference,
    workspaceDeclarations,
  );
  if (workspace.length === 1)
    return { kind: "editor", declaration: workspace[0]! };
  if (workspace.length > 1) return null;
  const external = semanticMatches(snapshot, reference, semantic);
  return external.length === 1
    ? { kind: "semantic", symbol: external[0]! }
    : null;
}

function enclosingDeclaration(
  snapshot: EditorSnapshot,
  position: EditorPosition,
): EditorDeclaration | undefined {
  return snapshot.declarations
    .filter((declaration) => contains(declaration.range, position))
    .sort(
      (left, right) =>
        right.range.start.byteOffset - left.range.start.byteOffset ||
        left.range.end.byteOffset - right.range.end.byteOffset,
    )[0];
}

function pathSegmentRange(
  range: SourceRange,
  text: string,
  segment: number,
): SourceRange {
  const segments = text.split(".");
  const prefix = segments.slice(0, segment).join(".");
  const startOffset = prefix.length + (segment > 0 ? 1 : 0);
  const length = segments[segment]?.length ?? 0;
  return {
    uri: range.uri,
    start: {
      line: range.start.line,
      character: range.start.character + startOffset,
      byteOffset: range.start.byteOffset + startOffset,
    },
    end: {
      line: range.start.line,
      character: range.start.character + startOffset + length,
      byteOffset: range.start.byteOffset + startOffset + length,
    },
  };
}

function referenceSegmentAt(
  reference: EditorReference,
  position: EditorPosition,
): number {
  if (position.line !== reference.range.start.line) return -1;
  const offset = position.character - reference.range.start.character;
  if (offset < 0) return -1;
  let start = 0;
  const segments = reference.text.split(".");
  for (let index = 0; index < segments.length; index += 1) {
    const end = start + (segments[index]?.length ?? 0);
    if (offset >= start && offset <= end) return index;
    start = end + 1;
  }
  return -1;
}

export function editorTargetAt(
  snapshot: EditorSnapshot,
  position: EditorPosition,
  semantic: SemanticSnapshot | null,
  workspaceDeclarations: readonly EditorDeclaration[] = [],
):
  | { readonly kind: "editor"; readonly declaration: EditorDeclaration }
  | { readonly kind: "semantic"; readonly symbol: SemanticSymbol }
  | null {
  const declaration = snapshot.declarations.find(
    (candidate) =>
      contains(candidate.selectionRange, position) ||
      Boolean(candidate.endRange && contains(candidate.endRange, position)),
  );
  if (declaration) return { kind: "editor", declaration };
  const reference = snapshot.references.find((candidate) =>
    contains(candidate.range, position),
  );
  if (!reference) return null;
  const segment = referenceSegmentAt(reference, position);
  const segments = reference.text.split(".");
  if (segment >= 0 && segment < segments.length - 1) {
    const prefix = segments
      .slice(0, segment + 1)
      .join(".")
      .toUpperCase();
    const local = [
      ...new Map(
        [...snapshot.declarations, ...workspaceDeclarations]
          .filter((candidate) => {
            const qualified = candidate.qualifiedName.toUpperCase();
            if (qualified !== prefix && !qualified.endsWith(`.${prefix}`))
              return false;
            if (candidate.selectionRange.uri === snapshot.uri) return true;
            const model = candidate.qualifiedName
              .split(".", 1)[0]
              ?.toUpperCase();
            return snapshot.imports.some(
              (entry) => entry.model.toUpperCase() === model,
            );
          })
          .map((candidate) => [
            `${candidate.selectionRange.uri}:${candidate.qualifiedName.toUpperCase()}`,
            candidate,
          ]),
      ).values(),
    ];
    if (local.length === 1) return { kind: "editor", declaration: local[0]! };
    const external =
      semantic?.symbols.filter((symbol) => {
        const qualified = symbol.qualifiedName.toUpperCase();
        return (
          (qualified === prefix || qualified.endsWith(`.${prefix}`)) &&
          (symbol.range?.uri === snapshot.uri ||
            importedModel(snapshot, symbol, false))
        );
      }) ?? [];
    if (external.length === 1)
      return { kind: "semantic", symbol: external[0]! };
    return null;
  }
  return resolveEditorReference(
    snapshot,
    reference,
    semantic,
    workspaceDeclarations,
  );
}

export function editorOccurrences(
  snapshot: EditorSnapshot,
  target: EditorDeclaration,
  semantic: SemanticSnapshot | null,
  workspaceDeclarations: readonly EditorDeclaration[] = [],
): SourceRange[] {
  const ranges: SourceRange[] = [];
  const local = snapshot.declarations.find(
    (candidate) =>
      candidate.qualifiedName.toUpperCase() ===
      target.qualifiedName.toUpperCase(),
  );
  if (local) {
    ranges.push(local.selectionRange);
    if (local.endRange) ranges.push(local.endRange);
  }
  if (target.kind === "model") {
    for (const entry of snapshot.imports)
      if (entry.model.toUpperCase() === target.name.toUpperCase())
        ranges.push(entry.range);
    for (const reference of snapshot.references)
      if (
        reference.text.split(".", 1)[0]?.toUpperCase() ===
        target.name.toUpperCase()
      )
        ranges.push(pathSegmentRange(reference.range, reference.text, 0));
  }
  for (const reference of snapshot.references) {
    const resolved = resolveEditorReference(
      snapshot,
      reference,
      semantic,
      workspaceDeclarations,
    );
    if (
      resolved?.kind === "editor" &&
      resolved.declaration.qualifiedName.toUpperCase() ===
        target.qualifiedName.toUpperCase()
    )
      ranges.push(
        pathSegmentRange(
          reference.range,
          reference.text,
          reference.text.split(".").length - 1,
        ),
      );
  }
  return ranges;
}

function importClauseTerminated(
  text: string,
  starts: readonly number[],
  range: SourceRange,
): boolean {
  const lineStart = starts[range.start.line] ?? 0;
  const before = text.slice(0, lineStart + range.start.character);
  const importStart = before.toUpperCase().lastIndexOf("IMPORTS");
  if (importStart < 0) return false;
  const rangeEnd =
    (starts[range.end.line] ?? text.length) + range.end.character;
  const semicolon = text.indexOf(";", rangeEnd);
  if (semicolon < 0) return false;
  const boundary = text
    .slice(rangeEnd, semicolon)
    .search(/\b(?:MODEL|TOPIC|CLASS|STRUCTURE|DOMAIN|UNIT|END)\b/iu);
  return boundary < 0;
}

function referenceIsComplete(
  text: string,
  starts: readonly number[],
  reference: EditorReference,
): boolean {
  const end =
    (starts[reference.range.end.line] ?? text.length) +
    reference.range.end.character;
  const tail = text
    .slice(end)
    .replace(/!![^\n]*/gu, "")
    .replace(/"(?:\\.|[^"\\])*"/gu, '""');
  if (/^\s*\./u.test(tail)) return false;
  const terminal = tail.search(/[;=]/u);
  if (terminal < 0) return false;
  const boundary = tail.search(
    /\n\s*(?:(?:END|MODEL|TOPIC|CLASS|STRUCTURE|ASSOCIATION|VIEW|GRAPHIC|DOMAIN|UNIT)\b|[A-Za-z_][A-Za-z0-9_]*\s*:)/iu,
  );
  if (boundary >= 0 && terminal >= boundary) return false;
  if (reference.kind === "extends" && tail[terminal] === "=") {
    const body = tail
      .slice(terminal + 1)
      .split(/\n\s*END\b/iu, 1)[0]
      ?.replace(/\s/gu, "");
    if (!body) return false;
  }
  return true;
}

function unusedImportEdit(
  snapshot: EditorSnapshot,
  text: string,
  entry: EditorSnapshot["imports"][number],
): TextEdit {
  const lines = text.split(/\r?\n/u);
  const line = lines[entry.range.start.line] ?? "";
  const importsOnLine = snapshot.imports.filter(
    (candidate) => candidate.range.start.line === entry.range.start.line,
  );
  if (importsOnLine.length === 1 && /^\s*IMPORTS\b.*;\s*$/iu.test(line))
    return {
      range: {
        start: { line: entry.range.start.line, character: 0 },
        end: {
          line: Math.min(entry.range.start.line + 1, lines.length - 1),
          character:
            entry.range.start.line + 1 < lines.length ? 0 : line.length,
        },
      },
      newText: "",
    };

  let start = entry.range.start.character;
  let end = entry.range.end.character;
  const before = line.slice(0, start);
  const unqualified = before.match(/\bUNQUALIFIED\s*$/iu);
  if (unqualified) start -= unqualified[0].length;
  const after = line.slice(end);
  const followingComma = after.match(/^\s*,\s*/u);
  if (followingComma) end += followingComma[0].length;
  else {
    const precedingComma = line.slice(0, start).match(/,\s*$/u);
    if (precedingComma) start -= precedingComma[0].length;
  }
  return {
    range: {
      start: { line: entry.range.start.line, character: start },
      end: { line: entry.range.end.line, character: end },
    },
    newText: "",
  };
}

function attributeDiagnostics(
  snapshot: EditorSnapshot,
  text: string,
  starts: readonly number[],
): { diagnostics: Diagnostic[]; fixes: LiveQuickFix[] } {
  const diagnostics: Diagnostic[] = [];
  const fixes: LiveQuickFix[] = [];
  const lines = text.split(/\r?\n/u);
  const inAttributeContainer = (line: number): boolean => {
    const owner = enclosingDeclaration(snapshot, { line, character: 0 });
    return Boolean(
      owner &&
      ["class", "structure", "association", "view"].includes(owner.kind),
    );
  };
  const nextCodeLine = (line: number): string => {
    for (let index = line + 1; index < lines.length; index += 1) {
      const value = (lines[index] ?? "").replace(/!!.*$/u, "").trim();
      if (value) return value;
    }
    return "";
  };

  for (const [lineNumber, rawLine] of lines.entries()) {
    if (!inAttributeContainer(lineNumber)) continue;
    const line = rawLine.replace(/!!.*$/u, "");
    if (!line.trim() || /^\s*(?:!!@|END\b)/iu.test(line)) continue;
    let match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/u);
    if (match?.[2]) {
      const start = match[1]?.length ?? 0;
      diagnostics.push(
        diagnostic(
          "ILIC-LIVE-ATTRIBUTE-HEAD",
          "Missing ':' and type after attribute name",
          sourceRange(
            snapshot.uri,
            text,
            starts,
            lineNumber,
            start,
            start + match[2].length,
          ),
        ),
      );
      continue;
    }

    match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:;\s*)?$/u);
    if (
      match?.[2] &&
      (line.includes(";") || /^END\b/iu.test(nextCodeLine(lineNumber)))
    ) {
      const start = match[1]?.length ?? 0;
      const end = line.indexOf(":") + 1;
      diagnostics.push(
        diagnostic(
          "ILIC-LIVE-ATTRIBUTE-TYPE",
          "Missing type after ':' in attribute definition",
          sourceRange(snapshot.uri, text, starts, lineNumber, start, end),
        ),
      );
      continue;
    }

    match = line.match(
      /^(\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*)(-?(?:\d+(?:\.\d+)?|".*?"))\s*;/u,
    );
    if (match?.[2]) {
      const start = match[1]?.length ?? 0;
      diagnostics.push(
        diagnostic(
          "ILIC-LIVE-ATTRIBUTE-VALUE",
          "Missing type before value after ':' in attribute definition",
          sourceRange(
            snapshot.uri,
            text,
            starts,
            lineNumber,
            start,
            start + match[2].length,
          ),
        ),
      );
      continue;
    }

    match = line.match(/^(\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*)(.+?\S)\s*$/u);
    if (
      match?.[2] &&
      !line.trimEnd().endsWith(";") &&
      /^END\b/iu.test(nextCodeLine(lineNumber))
    ) {
      const start = match[1]?.length ?? 0;
      const range = sourceRange(
        snapshot.uri,
        text,
        starts,
        lineNumber,
        start,
        start + match[2].length,
      );
      const value = diagnostic(
        "ILIC-LIVE-MISSING-SEMICOLON",
        "Missing ';' after attribute definition",
        range,
      );
      diagnostics.push(value);
      fixes.push({
        title: "Insert missing ';'",
        diagnosticCode: value.code,
        diagnosticRange: editorRange(range),
        edits: {
          [snapshot.uri]: [
            {
              range: {
                start: {
                  line: lineNumber,
                  character: line.trimEnd().length,
                },
                end: {
                  line: lineNumber,
                  character: line.trimEnd().length,
                },
              },
              newText: ";",
            },
          ],
        },
      });
    }
  }
  return { diagnostics, fixes };
}

function endDiagnostics(
  snapshot: EditorSnapshot,
  text: string,
  starts: readonly number[],
): { diagnostics: Diagnostic[]; fixes: LiveQuickFix[] } {
  const diagnostics: Diagnostic[] = [];
  const fixes: LiveQuickFix[] = [];
  const stack: Array<{ name: string; kind: string }> = [];
  const lines = text.split(/\r?\n/u);
  for (const [lineNumber, line] of lines.entries()) {
    const block = line.match(
      /^\s*(?:VIEW\s+TOPIC|MODEL|TOPIC|CLASS|STRUCTURE|ASSOCIATION|VIEW|GRAPHIC)\s+([A-Za-z_][A-Za-z0-9_]*)\b/iu,
    );
    if (block?.[1]) stack.push({ name: block[1], kind: block[0].trim() });
    const end = line.match(/^(\s*END\s+)([A-Za-z_][A-Za-z0-9_]*)(\s*[.;])/iu);
    if (!end?.[2] || stack.length === 0) continue;
    const expected = stack.at(-1)!.name;
    const start = (end[1] ?? "").length;
    if (expected.toUpperCase() !== end[2].toUpperCase()) {
      const range = sourceRange(
        snapshot.uri,
        text,
        starts,
        lineNumber,
        start,
        start + end[2].length,
      );
      const value = diagnostic(
        "ILIC-LIVE-END-NAME",
        `Expected END ${expected}`,
        range,
      );
      diagnostics.push(value);
      fixes.push({
        title: `Replace with '${expected}'`,
        diagnosticCode: value.code,
        diagnosticRange: editorRange(range),
        edits: {
          [snapshot.uri]: [{ range: editorRange(range), newText: expected }],
        },
      });
    }
    const matching = [...stack]
      .map((entry) => entry.name.toUpperCase())
      .lastIndexOf(end[2].toUpperCase());
    if (matching >= 0) stack.splice(matching);
    else stack.pop();
  }
  return { diagnostics, fixes };
}

export function analyzeLiveDocument(
  snapshot: EditorSnapshot,
  text: string,
  semantic: SemanticSnapshot | null,
  workspaceDeclarations: readonly EditorDeclaration[] = [],
): LiveAnalysisResult {
  if (snapshot.iliVersion === "1.0") return { diagnostics: [], fixes: [] };
  const starts = lineStarts(text);
  const diagnostics: Diagnostic[] = [...snapshot.diagnostics];
  const fixes: LiveQuickFix[] = [];

  const ends = endDiagnostics(snapshot, text, starts);
  diagnostics.push(...ends.diagnostics);
  fixes.push(...ends.fixes);

  const attributes = attributeDiagnostics(snapshot, text, starts);
  diagnostics.push(...attributes.diagnostics);
  fixes.push(...attributes.fixes);

  const duplicates = new Map<string, EditorDeclaration[]>();
  for (const declaration of snapshot.declarations) {
    const key = `${declaration.containerId ?? ""}:${declaration.name.toUpperCase()}`;
    const values = duplicates.get(key) ?? [];
    values.push(declaration);
    duplicates.set(key, values);
  }
  for (const values of duplicates.values()) {
    if (values.length < 2) continue;
    values
      .sort(
        (left, right) =>
          left.selectionRange.start.byteOffset -
          right.selectionRange.start.byteOffset,
      )
      .slice(1)
      .forEach((declaration) =>
        diagnostics.push(
          diagnostic(
            "ILIC-LIVE-DUPLICATE",
            `Duplicate declaration '${declaration.name}'`,
            declaration.selectionRange,
          ),
        ),
      );
  }

  for (const reference of snapshot.references) {
    if (
      reference.text.toUpperCase().startsWith("INTERLIS.") ||
      builtinNames.has(reference.text.toUpperCase())
    )
      continue;
    if (!referenceIsComplete(text, starts, reference)) continue;
    if (
      resolveEditorReference(
        snapshot,
        reference,
        semantic,
        workspaceDeclarations,
      )
    )
      continue;
    const forward = visibleLocalMatches(snapshot, reference, true).some(
      (declaration) =>
        declaration.selectionRange.start.byteOffset >=
        reference.range.start.byteOffset,
    );
    diagnostics.push(
      diagnostic(
        forward ? "ILIC-LIVE-FORWARD-REFERENCE" : "ILIC-LIVE-UNKNOWN-REFERENCE",
        forward
          ? `Symbol '${reference.text}' is not visible here yet`
          : `Unknown ${reference.kind} '${reference.text}'`,
        reference.range,
      ),
    );
  }

  for (const entry of snapshot.imports) {
    if (
      entry.model.toUpperCase() === "INTERLIS" ||
      !importClauseTerminated(text, starts, entry.range)
    )
      continue;
    const qualifiedUse =
      snapshot.references.some((reference) =>
        reference.text
          .toUpperCase()
          .startsWith(`${entry.model.toUpperCase()}.`),
      ) ||
      new RegExp(
        `\\b${entry.model.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\.`,
        "iu",
      ).test(text);
    const unqualifiedUse =
      entry.unqualified &&
      snapshot.references.some((reference) =>
        semanticMatches(snapshot, reference, semantic).some((symbol) =>
          symbol.qualifiedName
            .toUpperCase()
            .startsWith(`${entry.model.toUpperCase()}.`),
        ),
      );
    if (qualifiedUse || unqualifiedUse || (entry.unqualified && !semantic))
      continue;
    const value = diagnostic(
      "ILIC-LINT-UNUSED-IMPORT",
      `Imported model '${entry.model}' is never used`,
      entry.range,
      "warning",
      ["unnecessary"],
    );
    diagnostics.push(value);
    fixes.push({
      title: `Remove unused import '${entry.model}'`,
      diagnosticCode: value.code,
      diagnosticRange: editorRange(entry.range),
      edits: {
        [snapshot.uri]: [unusedImportEdit(snapshot, text, entry)],
      },
    });
  }

  const unique = diagnostics.filter(
    (value, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === value.code &&
          candidate.range?.start.line === value.range?.start.line &&
          candidate.range?.start.character === value.range?.start.character,
      ) === index,
  );
  return {
    diagnostics: unique.filter(
      (value) =>
        !unique.some(
          (candidate) =>
            candidate !== value &&
            candidate.range &&
            value.range &&
            overlaps(candidate.range, value.range) &&
            candidate.code.startsWith("ILIC-LIVE-ATTRIBUTE") &&
            value.code === "ILIC-LIVE-UNKNOWN-REFERENCE",
        ),
    ),
    fixes,
  };
}
