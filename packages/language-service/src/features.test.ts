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
  syntaxDocumentSymbols,
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
      selectionRange: range(0, 6, 0, 11),
      endRange: range(10, 4, 10, 9),
    },
    {
      id: "class",
      name: "Building",
      qualifiedName: "Model.Building",
      kind: "Class",
      containerId: "model",
      range: range(2, 8, 2, 16),
      abstract: false,
      selectionRange: range(2, 8, 2, 16),
      endRange: range(5, 8, 5, 16),
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

const inheritanceSemantic = (): SemanticSnapshot => ({
  ...semantic(),
  symbols: [
    {
      id: "model",
      name: "Model",
      qualifiedName: "Model",
      kind: "model",
      containerId: "",
      range: range(0, 0, 12, 1),
      selectionRange: range(0, 6, 0, 11),
      endRange: range(12, 4, 12, 9),
      abstract: false,
    },
    {
      id: "base",
      name: "Base",
      qualifiedName: "Model.Base",
      kind: "Class",
      containerId: "model",
      range: range(2, 0, 6, 1),
      selectionRange: range(2, 6, 2, 10),
      endRange: range(6, 8, 6, 12),
      abstract: false,
    },
    {
      id: "baseName",
      name: "Name",
      qualifiedName: "Model.Base.Name",
      kind: "Attribute",
      containerId: "base",
      range: range(3, 2, 3, 16),
      selectionRange: range(3, 2, 3, 6),
      endRange: null,
      abstract: false,
    },
    {
      id: "baseRole",
      name: "owner",
      qualifiedName: "Model.Base.owner",
      kind: "Role",
      containerId: "base",
      range: range(4, 2, 4, 16),
      selectionRange: range(4, 2, 4, 7),
      endRange: null,
      abstract: false,
    },
    {
      id: "child",
      name: "Child",
      qualifiedName: "Model.Child",
      kind: "class",
      containerId: "model",
      range: range(8, 0, 12, 1),
      selectionRange: range(8, 6, 8, 11),
      endRange: range(12, 8, 12, 13),
      abstract: false,
    },
    {
      id: "childName",
      name: "Name",
      qualifiedName: "Model.Child.Name",
      kind: "attribute",
      containerId: "child",
      range: range(9, 2, 9, 16),
      selectionRange: range(9, 2, 9, 6),
      endRange: null,
      abstract: false,
    },
    {
      id: "basket",
      name: "BASKET",
      qualifiedName: "Model.Child.BASKET",
      kind: "DataUnit",
      containerId: "child",
      range: range(10, 2, 10, 8),
      selectionRange: range(10, 2, 10, 8),
      endRange: null,
      abstract: false,
    },
  ],
  references: [
    {
      sourceId: "child",
      targetId: "base",
      kind: "inheritance",
      range: range(8, 12, 8, 16),
    },
    {
      sourceId: "childName",
      targetId: "baseName",
      kind: "inheritance",
      range: range(9, 2, 9, 6),
    },
  ],
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
    expect(
      locationsForDefinition(snapshot, uri, { line: 5, character: 9 })[0]?.range
        .start,
    ).toEqual({ line: 2, character: 8 });
    expect(locationsForReferences(snapshot, "model", false)).toHaveLength(1);
    expect(locationsForReferences(snapshot, "model", true)).toHaveLength(3);
    expect(locationsForReferences(snapshot, "missing", true)).toEqual([]);
    expect(
      renameSymbol(snapshot, "model", "Renamed").changes[uri],
    ).toHaveLength(3);
    expect(symbolAt(snapshot, uri, { line: 4, character: 5 })?.id).toBe(
      "model",
    );
    expect(symbolAt(snapshot, uri, { line: 9, character: 0 })).toBeUndefined();
    expect(symbolAt(snapshot, uri, { line: 2, character: 9 })?.id).toBe(
      "class",
    );
    expect(symbolAt(snapshot, uri, { line: 5, character: 9 })?.id).toBe(
      "class",
    );

    const withoutRange = semantic();
    withoutRange.symbols[0] = {
      ...withoutRange.symbols[0]!,
      range: null,
      selectionRange: null,
      endRange: null,
    };
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
        end: { line: 10, character: 9 },
      },
      selectionRange: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
      },
    });
    expect(symbols[0]?.children[0]).toMatchObject({
      name: "Building",
      range: {
        start: { line: 2, character: 0 },
        end: { line: 5, character: 16 },
      },
      selectionRange: {
        start: { line: 2, character: 8 },
        end: { line: 2, character: 8 },
      },
    });
  });

  it("falls back from missing or foreign document selection ranges", () => {
    const missingSnapshot = semantic();
    missingSnapshot.symbols = [missingSnapshot.symbols[0]!];
    const missing = documentSymbols(missingSnapshot, uri)[0];
    expect(missing?.selectionRange).toEqual({
      start: { line: 0, character: 6 },
      end: { line: 0, character: 6 },
    });

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
    expect(foreign?.selectionRange).toEqual({
      start: { line: 0, character: 6 },
      end: { line: 0, character: 6 },
    });
  });

  it("uses Java-compatible labels, filters BASKET and expands local inheritance", () => {
    const symbols = documentSymbols(inheritanceSemantic(), uri);
    const model = symbols[0]!;
    const child = model.children.find((symbol) => symbol.name === "Child")!;
    expect(model).toMatchObject({
      name: "Model",
      detail: "MODEL",
      kind: "model",
    });
    expect(child).toMatchObject({
      name: "Child",
      detail: "CLASS",
      kind: "class",
    });
    expect(child.children.map((symbol) => symbol.name)).toEqual([
      "Name",
      "owner",
    ]);
    expect(child.children[0]?.detail).toBe("");
    expect(child.children[1]?.selectionRange).toEqual({
      start: { line: 4, character: 2 },
      end: { line: 4, character: 2 },
    });
    expect(child.children[1]?.range.start).toEqual({ line: 4, character: 2 });
    expect(child.children.some((symbol) => symbol.name === "BASKET")).toBe(
      false,
    );
    expect(child.children[0]?.selectionRange.start).toEqual({
      line: 9,
      character: 2,
    });
    expect(child.children[0]?.selectionRange.end).toEqual(
      child.children[0]?.selectionRange.start,
    );
    expect(
      locationsForDefinition(inheritanceSemantic(), uri, {
        line: 9,
        character: 3,
      }),
    ).toEqual([
      {
        uri,
        range: {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 6 },
        },
      },
    ]);
  });

  it("does not project inherited members from another document", () => {
    const snapshot = inheritanceSemantic();
    snapshot.symbols = snapshot.symbols.map((symbol) =>
      symbol.id === "base" || symbol.id === "baseName"
        ? {
            ...symbol,
            range: symbol.range
              ? { ...symbol.range, uri: "memory:///Other.ili" }
              : symbol.range,
            selectionRange: symbol.selectionRange
              ? { ...symbol.selectionRange, uri: "memory:///Other.ili" }
              : symbol.selectionRange,
          }
        : symbol,
    );
    const child = documentSymbols(snapshot, uri)[0]?.children.find(
      (symbol) => symbol.name === "Child",
    );
    expect(child?.children.map((symbol) => symbol.name)).toEqual(["Name"]);
  });

  it("keeps a useful live outline when an attribute type is temporarily missing", () => {
    const text = [
      "MODEL M =",
      "  TOPIC T =",
      "    CLASS Renamed =",
      "      Name : ;",
      "    END Renamed;",
      "  END T;",
      "END M.",
    ].join("\n");
    const token = (
      kind: string,
      value: string,
      line: number,
      character: number,
    ) => ({
      kind,
      text: value,
      channel: 0,
      range: range(line, character, line, character + value.length),
    });
    const parsed: SyntaxSnapshot = {
      ...syntax(),
      success: false,
      tokens: [
        token("MODEL", "MODEL", 0, 0),
        token("NAME", "M", 0, 6),
        token("EQUAL", "=", 0, 8),
        token("TOPIC", "TOPIC", 1, 2),
        token("NAME", "T", 1, 8),
        token("EQUAL", "=", 1, 10),
        token("CLASS", "CLASS", 2, 4),
        token("NAME", "Renamed", 2, 10),
        token("EQUAL", "=", 2, 18),
        token("NAME", "Name", 3, 6),
        token("COLON", ":", 3, 11),
        token("SEMI", ";", 3, 13),
        token("END", "END", 4, 4),
        token("NAME", "Renamed", 4, 8),
        token("SEMI", ";", 4, 15),
        token("END", "END", 5, 2),
        token("NAME", "T", 5, 6),
        token("SEMI", ";", 5, 7),
        token("END", "END", 6, 0),
        token("NAME", "M", 6, 4),
        token("DOT", ".", 6, 5),
      ],
      nodes: [
        { id: 1, parent: null, kind: "modelDef", range: range(0, 0, 6, 6) },
      ],
      diagnostics: [
        {
          severity: "error",
          code: "syntax",
          message: "missing type",
          range: range(3, 13),
          relatedInformation: [],
          notes: [],
          treatedAsError: true,
        },
      ],
    };
    const baseline = [
      {
        name: "M",
        detail: "MODEL",
        kind: "model",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 6, character: 6 },
        },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
        },
        children: [
          {
            name: "T",
            detail: "TOPIC",
            kind: "topic",
            range: {
              start: { line: 1, character: 2 },
              end: { line: 5, character: 8 },
            },
            selectionRange: {
              start: { line: 1, character: 8 },
              end: { line: 1, character: 8 },
            },
            children: [
              {
                name: "Old",
                detail: "CLASS",
                kind: "class",
                range: {
                  start: { line: 2, character: 4 },
                  end: { line: 4, character: 16 },
                },
                selectionRange: {
                  start: { line: 2, character: 10 },
                  end: { line: 2, character: 10 },
                },
                children: [
                  {
                    name: "OldAttribute",
                    detail: "",
                    kind: "attribute",
                    range: {
                      start: { line: 3, character: 6 },
                      end: { line: 3, character: 20 },
                    },
                    selectionRange: {
                      start: { line: 3, character: 6 },
                      end: { line: 3, character: 6 },
                    },
                    children: [],
                  },
                  {
                    name: "Inherited",
                    detail: "",
                    kind: "attribute",
                    range: {
                      start: { line: 3, character: 6 },
                      end: { line: 3, character: 15 },
                    },
                    selectionRange: {
                      start: { line: 3, character: 6 },
                      end: { line: 3, character: 6 },
                    },
                    children: [],
                    inherited: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const outline = syntaxDocumentSymbols(parsed, text, baseline);
    const liveClass = outline[0]?.children[0]?.children[0];
    expect(liveClass?.name).toBe("Renamed");
    expect(liveClass?.children.map((child) => child.name)).toEqual([
      "Name",
      "Inherited",
    ]);
    expect(liveClass?.range.end.line).toBeLessThanOrEqual(6);
  });

  it("removes validly deleted declarations but preserves inherited members", () => {
    const parsed: SyntaxSnapshot = {
      ...syntax(),
      tokens: [
        { kind: "MODEL", text: "MODEL", channel: 0, range: range(0, 0, 0, 5) },
        { kind: "NAME", text: "M", channel: 0, range: range(0, 6, 0, 7) },
        { kind: "EQUAL", text: "=", channel: 0, range: range(0, 8, 0, 9) },
        { kind: "CLASS", text: "CLASS", channel: 0, range: range(1, 2, 1, 7) },
        { kind: "NAME", text: "C", channel: 0, range: range(1, 8, 1, 9) },
      ],
      nodes: [
        { id: 1, parent: null, kind: "modelDef", range: range(0, 0, 3, 6) },
        { id: 2, parent: 1, kind: "classDef", range: range(1, 2, 2, 8) },
      ],
    };
    const inherited = {
      name: "Inherited",
      detail: "",
      kind: "attribute",
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 9 },
      },
      selectionRange: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 2 },
      },
      children: [],
      inherited: true,
    };
    const baseline = [
      {
        name: "M",
        detail: "MODEL",
        kind: "model",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 3, character: 6 },
        },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
        },
        children: [
          {
            name: "C",
            detail: "CLASS",
            kind: "class",
            range: {
              start: { line: 1, character: 2 },
              end: { line: 2, character: 8 },
            },
            selectionRange: {
              start: { line: 1, character: 8 },
              end: { line: 1, character: 8 },
            },
            children: [
              { ...inherited, name: "Deleted", inherited: undefined },
              inherited,
            ],
          },
        ],
      },
    ];
    const outline = syntaxDocumentSymbols(
      parsed,
      "MODEL M =\n  CLASS C =\n  END C;\nEND M.",
      baseline,
    );
    expect(
      outline[0]?.children[0]?.children.map((child) => child.name),
    ).toEqual(["Inherited"]);
  });

  it("recognizes structures and association roles from parser nodes", () => {
    const token = (
      kind: string,
      value: string,
      line: number,
      character: number,
    ) => ({
      kind,
      text: value,
      channel: 0,
      range: range(line, character, line, character + value.length),
    });
    const parsed: SyntaxSnapshot = {
      ...syntax(),
      tokens: [
        token("MODEL", "MODEL", 0, 0),
        token("NAME", "M", 0, 6),
        token("STRUCTURE", "STRUCTURE", 1, 2),
        token("NAME", "S", 1, 12),
        token("ASSOCIATION", "ASSOCIATION", 3, 2),
        token("NAME", "Link", 3, 14),
        token("NAME", "source", 4, 4),
        token("ASSOCIATE", "--", 4, 11),
      ],
      nodes: [
        { id: 1, parent: null, kind: "modelDef", range: range(0, 0, 6, 6) },
        { id: 2, parent: 1, kind: "structureDef", range: range(1, 2, 2, 8) },
        {
          id: 3,
          parent: 1,
          kind: "associationDef",
          range: range(3, 2, 5, 11),
        },
        { id: 4, parent: 3, kind: "roleDef", range: range(4, 4, 4, 15) },
      ],
    };
    const result = syntaxDocumentSymbols(
      parsed,
      "MODEL M =\n  STRUCTURE S =\n  END S;\n  ASSOCIATION Link =\n    source -- S;\n  END Link;\nEND M.",
    );
    expect(result[0]?.children.map((symbol) => symbol.kind)).toEqual([
      "structure",
      "association",
    ]);
    expect(result[0]?.children[1]?.children).toEqual([
      expect.objectContaining({ name: "source", kind: "role" }),
    ]);
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
