import { describe, expect, it } from "vitest";
import type {
  Diagnostic,
  SemanticSnapshot,
  SourceRange,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import {
  completionsAt,
  contains,
  contextAt,
  diagnosticsFor,
  documentSymbols,
  locationsForDefinition,
  locationsForReferences,
  renameSymbol,
  symbolAt,
  templateForNewline,
} from "./features.js";

const uri = "memory:///Model.ili";
const range = (
  startLine: number,
  startCharacter: number,
  endLine = startLine,
  endCharacter = startCharacter + 1,
): SourceRange => ({
  uri,
  start: {
    line: startLine,
    character: startCharacter,
    byteOffset: startLine * 100 + startCharacter,
  },
  end: {
    line: endLine,
    character: endCharacter,
    byteOffset: endLine * 100 + endCharacter,
  },
});

const syntax = (): SyntaxSnapshot => ({
  schemaVersion: 1,
  abiVersion: 1,
  compilerVersion: "test",
  kind: "syntax",
  success: true,
  uri,
  documentVersion: 1,
  iliVersion: "2.4",
  tokens: [
    { kind: "MODEL", text: "MODEL", channel: 0, range: range(0, 0, 0, 5) },
    { kind: "NAME", text: "Model", channel: 0, range: range(0, 6, 0, 11) },
    { kind: "EQUAL", text: "=", channel: 0, range: range(0, 12, 0, 13) },
  ],
  nodes: [],
  contexts: [
    { kind: "modelDef", range: range(0, 0, 10, 10) },
    { kind: "classDef", range: range(2, 2, 5, 10) },
  ],
  imports: [],
  diagnostics: [],
});

const semantic = (): SemanticSnapshot => ({
  schemaVersion: 1,
  abiVersion: 1,
  compilerVersion: "test",
  kind: "semantic",
  success: true,
  cancelled: false,
  roots: [uri],
  documentVersions: { [uri]: 1 },
  missingModels: [],
  symbols: [
    {
      id: "model",
      name: "Model",
      qualifiedName: "Model",
      kind: "Model",
      containerId: "",
      range: range(0, 6, 0, 11),
      abstract: false,
    },
    {
      id: "class",
      name: "Building",
      qualifiedName: "Model.Building",
      kind: "Class",
      containerId: "model",
      range: range(2, 8, 2, 16),
      abstract: false,
    },
  ],
  references: [
    {
      sourceId: "class",
      targetId: "model",
      kind: "name",
      range: range(4, 4, 4, 9),
    },
  ],
  dependencies: [],
  diagram: { nodes: [], edges: [] },
  documentation: { title: "Model", sections: [] },
  diagnostics: [],
  logs: [],
});

describe("syntax-driven feature helpers", () => {
  it("uses the smallest parser context and range boundaries", () => {
    expect(contextAt(syntax(), { line: 3, character: 0 })?.kind).toBe(
      "classDef",
    );
    expect(contextAt(syntax(), { line: 20, character: 0 })).toBeUndefined();
    expect(contains(range(1, 2, 1, 4), { line: 1, character: 2 })).toBe(true);
    expect(contains(range(1, 2, 1, 4), { line: 0, character: 9 })).toBe(false);
    expect(contains(range(1, 2, 1, 4), { line: 1, character: 1 })).toBe(false);
    expect(contains(range(1, 2, 1, 4), { line: 2, character: 0 })).toBe(false);
  });

  it("combines context keywords and semantic symbols without duplicates", () => {
    const items = completionsAt(syntax(), semantic(), {
      line: 3,
      character: 0,
    });
    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["EXTENDS", "TEXT", "Model", "Building"]),
    );
    expect(
      completionsAt(syntax(), null, { line: 20, character: 0 })[0]?.label,
    ).toBe("MODEL");
  });

  it("creates structured end templates only after declaration equals tokens", () => {
    const edit = templateForNewline(syntax(), { line: 0, character: 14 });
    expect(edit?.edits[0]?.newText).toContain("END Model.");
    expect(edit?.finalSelection.start).toEqual({ line: 1, character: 2 });
    const changed = syntax();
    changed.tokens.pop();
    expect(templateForNewline(changed, { line: 0, character: 12 })).toBeNull();
    changed.tokens.push({
      kind: "EQUAL",
      text: "=",
      channel: 0,
      range: range(0, 12, 0, 13),
    });
    changed.tokens.splice(1, 1);
    expect(templateForNewline(changed, { line: 0, character: 14 })).toBeNull();

    const classSyntax = syntax();
    classSyntax.tokens = [
      { kind: "CLASS", text: "CLASS", channel: 0, range: range(2, 4, 2, 9) },
      {
        kind: "NAME",
        text: "Building",
        channel: 0,
        range: range(2, 10, 2, 18),
      },
      { kind: "EQUAL", text: "=", channel: 0, range: range(2, 19, 2, 20) },
    ];
    expect(
      templateForNewline(classSyntax, { line: 2, character: 21 })?.edits[0]
        ?.newText,
    ).toContain("END Building;");
    classSyntax.tokens = [
      { kind: "UNKNOWN", text: "?", channel: 0, range: range(2, 1) },
      { kind: "EQUAL", text: "=", channel: 0, range: range(2, 2) },
    ];
    expect(
      templateForNewline(classSyntax, { line: 2, character: 4 }),
    ).toBeNull();
  });
});

describe("semantic feature helpers", () => {
  it("maps definitions, references and rename edits", () => {
    const snapshot = semantic();
    expect(
      locationsForDefinition(snapshot, uri, { line: 4, character: 5 })[0]?.range
        .start,
    ).toEqual({
      line: 0,
      character: 6,
    });
    expect(
      locationsForDefinition(snapshot, uri, { line: 8, character: 0 }),
    ).toEqual([]);
    expect(
      locationsForDefinition(snapshot, uri, { line: 2, character: 9 })[0]?.range
        .start.line,
    ).toBe(2);
    expect(locationsForReferences(snapshot, "model", false)).toHaveLength(1);
    expect(locationsForReferences(snapshot, "model", true)).toHaveLength(2);
    expect(locationsForReferences(snapshot, "missing", true)).toEqual([]);
    expect(
      renameSymbol(snapshot, "model", "Renamed").changes[uri],
    ).toHaveLength(2);
    expect(symbolAt(snapshot, uri, { line: 4, character: 5 })?.id).toBe(
      "model",
    );
    expect(symbolAt(snapshot, uri, { line: 9, character: 0 })).toBeUndefined();
    expect(symbolAt(snapshot, uri, { line: 2, character: 9 })?.id).toBe(
      "class",
    );

    const withoutRange = semantic();
    withoutRange.symbols[0] = { ...withoutRange.symbols[0]!, range: null };
    expect(
      locationsForDefinition(withoutRange, uri, { line: 4, character: 5 }),
    ).toEqual([]);
  });

  it("builds hierarchical document symbols", () => {
    const snapshot = semantic();
    snapshot.symbols[0] = {
      ...snapshot.symbols[0]!,
      range: range(0, 0, 0, 1),
      selectionRange: range(0, 6, 0, 11),
    };
    snapshot.symbols[1] = {
      ...snapshot.symbols[1]!,
      range: range(2, 0, 2, 1),
      selectionRange: range(2, 8, 2, 16),
    };

    const symbols = documentSymbols(snapshot, uri);
    expect(symbols[0]).toMatchObject({
      name: "Model",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 2, character: 16 },
      },
      selectionRange: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 11 },
      },
    });
    expect(symbols[0]?.children[0]).toMatchObject({
      name: "Building",
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 16 },
      },
      selectionRange: {
        start: { line: 2, character: 8 },
        end: { line: 2, character: 16 },
      },
    });
  });

  it("falls back from missing or foreign document selection ranges", () => {
    const missingSnapshot = semantic();
    missingSnapshot.symbols = [missingSnapshot.symbols[0]!];
    const missing = documentSymbols(missingSnapshot, uri)[0];
    expect(missing?.selectionRange).toEqual(missing?.range);

    const snapshot = semantic();
    snapshot.symbols = [
      {
        ...snapshot.symbols[0]!,
        selectionRange: {
          ...range(5, 3, 5, 8),
          uri: "memory:///Other.ili",
        },
      },
    ];
    const foreign = documentSymbols(snapshot, uri)[0];
    expect(foreign?.selectionRange).toEqual(foreign?.range);
  });

  it("combines only diagnostics for the requested URI", () => {
    const own: Diagnostic = {
      severity: "error",
      code: "E",
      message: "own",
      range: range(1, 0),
      relatedInformation: [],
      notes: [],
      treatedAsError: true,
    };
    const other = {
      ...own,
      range: { ...range(1, 0), uri: "memory:///Other.ili" },
    };
    const parsed = syntax();
    parsed.diagnostics.push(own);
    const analyzed = semantic();
    analyzed.diagnostics.push(other);
    expect(diagnosticsFor(uri, parsed, analyzed)).toEqual([own]);
  });
});
