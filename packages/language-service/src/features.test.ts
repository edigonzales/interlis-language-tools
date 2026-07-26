import { describe, expect, it } from "vitest";
import type {
  Diagnostic,
  SemanticSnapshot,
  SourceRange,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import {
  completionContextAt,
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

  it.each([
    {
      name: "document root",
      text: "INTERLIS 2.4;\nMO",
      position: { line: 1, character: 2 },
      slot: "top-level-root",
      labels: ["MODEL", "MODEL Name (lang) AT ... VERSION ... = ... END Name."],
      replacement: { start: 0, end: 2 },
    },
    {
      name: "model body",
      text: 'MODEL M (de) AT "x" VERSION "1" =\n  TO\nEND M.',
      position: { line: 1, character: 4 },
      slot: "container-body-root",
      labels: ["TOPIC", "TOPIC Name = ... END Name;"],
      replacement: { start: 2, end: 4 },
    },
    {
      name: "class header modifier",
      text: "MODEL M =\n  CLASS C (AB\nEND M.",
      position: { line: 1, character: 13 },
      slot: "declaration-header-modifier-value",
      labels: ["ABSTRACT"],
      replacement: { start: 11, end: 13 },
    },
    {
      name: "attribute type",
      text: "MODEL M =\n  TOPIC T =\n    CLASS C =\n      a: TE\n    END C;\n  END T;\nEND M.",
      position: { line: 3, character: 11 },
      slot: "attribute-type-root",
      labels: ["TEXT"],
      replacement: { start: 9, end: 11 },
    },
    {
      name: "imports",
      text: "MODEL M =\n  IMPORTS Ba",
      position: { line: 1, character: 12 },
      slot: "import-model",
      labels: [],
      replacement: { start: 10, end: 12 },
    },
  ])(
    "detects the $name completion slot with precise replacement",
    ({ text, position, slot, labels, replacement }) => {
      const snapshot = syntax();
      const context = completionContextAt(snapshot, text, position);
      expect(context?.slot).toBe(slot);
      expect(context?.replaceRange).toEqual({
        start: { line: position.line, character: replacement.start },
        end: { line: position.line, character: replacement.end },
      });
      expect(
        completionsAt(snapshot, null, position, text).map((item) => item.label),
      ).toEqual(expect.arrayContaining(labels));
    },
  );

  it("returns no misleading items outside a recognized slot", () => {
    const snapshot = syntax();
    const text = "MODEL M =\n  ?? invalid";
    expect(
      completionsAt(snapshot, null, { line: 1, character: 12 }, text),
    ).toEqual([]);
  });

  it("keeps keyword and snippet items distinct and stable", () => {
    const text = "INTERLIS 2.4;\nMOD";
    const items = completionsAt(
      syntax(),
      null,
      { line: 1, character: 3 },
      text,
    ).filter((item) => item.filterText === "MODEL");
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.kind)).toEqual(["keyword", "snippet"]);
    expect(items[0]?.sortText).toBe("25-MODEL");
    expect(items[1]?.textEdit).toMatchObject({
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 3 },
      },
    });
    expect(items[1]?.insertText).toContain('AT "${3:https://example.com}"');
  });

  it("keeps block and value snippets name-first with independent tabstops", () => {
    const text = [
      "MODEL M =",
      "  TOPIC T =",
      "    ",
      "  END T;",
      "END M.",
    ].join("\n");
    const items = completionsAt(
      syntax(),
      null,
      { line: 2, character: 4 },
      text,
    );
    const classSnippet = items.find(
      (item) => item.label === "CLASS Name = ... END Name;",
    );
    expect(classSnippet?.insertText).toBe(
      "CLASS ${1:Name} ${2:}=\n      $0\n    END ${1/^([A-Za-z_][A-Za-z0-9_]*).*$/$1/};",
    );
    expect(
      items.find((item) => item.label === "DOMAIN Name = ...;")?.insertText,
    ).toBe("DOMAIN ${1:Name} ${2:}= ${3};$0");
    expect(
      items.find((item) => item.label === "UNIT Name = ...;")?.insertText,
    ).toBe("UNIT ${1:Name} ${2:}= ${3};$0");
    expect(
      items.find((item) => item.label === "VIEW TOPIC Name = ... END Name;")
        ?.insertText,
    ).toContain("DEPENDS ON ${3:Topic}");
  });

  it.each([
    ["CLASS C ", "declaration-header-after-name", "EXTENDS"],
    ["CLASS C (ABSTRACT) ", "declaration-header-after-modifier", "EXTENDS"],
    ["CLASS C EXTENDS Base ", "declaration-header-after-extends", "="],
    ["UNIT U [m] ", "declaration-header-after-name", "EXTENDS"],
    ["value: TEXT", "text-length-tail", "*"],
    ["value: 1", "inline-numeric-range-tail", ".."],
    ["value: REFERENCE", "reference-post-keyword", "TO"],
    ["value: LIST", "collection-post-keyword", "OF"],
    ["value: FORMAT INTERLIS.XMLD", "format-type-target", "XMLDate"],
    ["UNIT U = [", "unit-bracket-target", undefined],
    ["END ", "end-name", "M"],
  ])("maps %s to %s", (source, slot, expectedLabel) => {
    const text = `MODEL M =\n  ${source}`;
    const position = { line: 1, character: text.split("\n")[1]!.length };
    const context = completionContextAt(syntax(), text, position);
    expect(context?.slot).toBe(slot);
    if (expectedLabel)
      expect(
        completionsAt(syntax(), null, position, text).map((item) => item.label),
      ).toContain(expectedLabel);
  });

  it("does not apply staged Java header completion to association, view or graphic declarations", () => {
    for (const source of [
      "ASSOCIATION A (EX",
      "VIEW V (AB",
      "GRAPHIC G EXTENDS ",
    ]) {
      const text = `MODEL M =\n  ${source}`;
      expect(
        completionContextAt(syntax(), text, {
          line: 1,
          character: text.split("\n")[1]!.length,
        }),
      ).toBeNull();
    }
  });

  it.each([
    "CLASS C (GENERIC) ",
    "TOPIC T (EXTENDED) ",
    "UNIT U (FINAL) ",
    "CLASS C [abbr] ",
  ])(
    "does not suggest continuations for an invalid staged header: %s",
    (source) => {
      const text = `MODEL M =\n  ${source}`;
      expect(
        completionContextAt(syntax(), text, {
          line: 1,
          character: text.split("\n")[1]!.length,
        }),
      ).toBeNull();
    },
  );

  it("offers contextual metaattributes and values", () => {
    const rootText = "MODEL M =\n  !!@ ili2db.\n  CLASS C =";
    const rootPosition = {
      line: 1,
      character: rootText.split("\n")[1]!.length,
    };
    expect(
      completionsAt(syntax(), null, rootPosition, rootText).map(
        (item) => item.filterText,
      ),
    ).toContain("ili2db.dispName");

    const valueText = "MODEL M =\n  !!@ ili2db.mapping=\n  STRUCTURE S =";
    const valuePosition = {
      line: 1,
      character: valueText.split("\n")[1]!.length,
    };
    expect(
      completionsAt(syntax(), null, valuePosition, valueText).map(
        (item) => item.label,
      ),
    ).toContain("MultiSurface");
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
    classSyntax.tokens = [
      { kind: "TOPIC", text: "TOPIC", channel: 0, range: range(0, 0, 0, 5) },
      { kind: "NAME", text: "T", channel: 0, range: range(0, 6, 0, 7) },
      { kind: "EQUAL", text: "=", channel: 0, range: range(0, 8, 0, 9) },
      { kind: "DOMAIN", text: "DOMAIN", channel: 0, range: range(1, 2, 1, 8) },
      { kind: "NAME", text: "D", channel: 0, range: range(1, 9, 1, 10) },
      { kind: "EQUAL", text: "=", channel: 0, range: range(1, 11, 1, 12) },
    ];
    expect(
      templateForNewline(classSyntax, { line: 1, character: 13 }),
    ).toBeNull();
  });

  it.each([
    ["MODEL", ".", "  "],
    ["TOPIC", ";", "  "],
    ["CLASS", ";", "  "],
    ["STRUCTURE", ";", "  "],
    ["ASSOCIATION", ";", "  "],
    ["VIEW", ";", "  "],
    ["GRAPHIC", ";", "  "],
  ])(
    "auto-closes %s only after the typed newline",
    (keyword, terminator, childIndent) => {
      const snapshot = syntax();
      const text = `${keyword} Block =\n`;
      const edit = templateForNewline(
        snapshot,
        text,
        { line: 1, character: 0 },
        { tabSize: 2, insertSpaces: true },
      );
      expect(edit?.edits[0]).toEqual({
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: `${childIndent}\nEND Block${terminator}`,
      });
      expect(edit?.finalSelection.start).toEqual({
        line: 1,
        character: childIndent.length,
      });
    },
  );

  it("does not offer a second UNIT abbreviation", () => {
    const text = "MODEL M =\n  UNIT U [m] ";
    expect(
      completionsAt(
        syntax(),
        null,
        { line: 1, character: text.split("\n")[1]!.length },
        text,
      ).map((item) => item.label),
    ).not.toContain("[Name]");
  });

  it("supports modifiers, multi-line EXTENDS, tabs and an existing editor indent", () => {
    const snapshot = syntax();
    const text = [
      "MODEL M =",
      "\tTOPIC T =",
      "\t\tCLASS Child (ABSTRACT)",
      "\t\t  EXTENDS Base =",
      "\t\t",
    ].join("\n");
    const edit = templateForNewline(
      snapshot,
      text,
      { line: 4, character: 2 },
      { tabSize: 8, insertSpaces: false },
    );
    expect(edit?.edits[0]?.newText).toBe("\t\t\t\n\t\tEND Child;");
    expect(edit?.finalSelection.start.character).toBe(3);
  });

  it("creates the VIEW TOPIC DEPENDS ON placeholder before the body", () => {
    const edit = templateForNewline(
      syntax(),
      "VIEW TOPIC Overview =\n",
      { line: 1, character: 0 },
      { tabSize: 2, insertSpaces: true },
    );
    expect(edit?.edits[0]?.newText).toBe("  DEPENDS ON \n  \nEND Overview;");
    expect(edit?.finalSelection.start).toEqual({
      line: 1,
      character: 13,
    });
  });

  it.each([
    "DOMAIN D =\n",
    "UNIT U =\n",
    "name: TEXT =\n",
    "!!@ name =\n",
    "!! CLASS Fake =\n",
    'label: TEXT = "CLASS Fake ="\n',
  ])("does not auto-close non-block equals: %s", (text) => {
    expect(
      templateForNewline(syntax(), text, { line: 1, character: 0 }),
    ).toBeNull();
  });

  it("does not duplicate an existing matching END", () => {
    const text = "CLASS Building =\n  \nEND Building;";
    expect(
      templateForNewline(syntax(), text, { line: 1, character: 2 }),
    ).toBeNull();
  });

  it("does not auto-close when Enter is pressed again on an empty body line", () => {
    expect(
      templateForNewline(syntax(), "CLASS Building =\n\n", {
        line: 2,
        character: 0,
      }),
    ).toBeNull();
  });
});

describe("scope-aware completion", () => {
  it("only proposes locally visible declarations before the caret", () => {
    const text = [
      "MODEL M =",
      "  DOMAIN Before = TEXT;",
      "  TOPIC T =",
      "    CLASS C =",
      "      value: Be",
      "    END C;",
      "  END T;",
      "  DOMAIN Behind = TEXT;",
      "END M.",
    ].join("\n");
    const labels = completionsAt(
      syntax(),
      null,
      { line: 4, character: 15 },
      text,
    ).map((item) => item.label);
    expect(labels).toContain("Before");
    expect(labels).not.toContain("Behind");
  });

  it("resolves a qualified path one segment at a time", () => {
    const text = [
      "MODEL M =",
      "  TOPIC Types =",
      "    DOMAIN Code = TEXT;",
      "  END Types;",
      "  TOPIC Use =",
      "    CLASS C =",
      "      value: Types.Co",
      "    END C;",
      "  END Use;",
      "END M.",
    ].join("\n");
    const items = completionsAt(
      syntax(),
      null,
      { line: 6, character: 21 },
      text,
    );
    expect(items.map((item) => item.label)).toContain("Code");
    expect(
      items.find((item) => item.label === "Code")?.textEdit?.range,
    ).toEqual({
      start: { line: 6, character: 19 },
      end: { line: 6, character: 21 },
    });
  });

  it("prefers the nearest declaration when a local symbol shadows a model symbol", () => {
    const text = [
      "MODEL M =",
      "  DOMAIN Code = TEXT;",
      "  TOPIC T =",
      "    DOMAIN Code = NUMERIC;",
      "    CLASS C =",
      "      value: Co",
      "    END C;",
      "  END T;",
      "END M.",
    ].join("\n");
    const items = completionsAt(
      syntax(),
      null,
      { line: 5, character: 15 },
      text,
    ).filter((item) => item.label === "Code");
    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toBe("M.T.Code");
  });

  it("does not resolve an ambiguous simple qualifier from sibling containers", () => {
    const text = [
      "MODEL M =",
      "  TOPIC Left =",
      "    STRUCTURE Shared =",
      "    END Shared;",
      "  END Left;",
      "  TOPIC Right =",
      "    STRUCTURE Shared =",
      "    END Shared;",
      "  END Right;",
      "  TOPIC Use =",
      "    CLASS C =",
      "      values: LIST OF Shared.",
      "    END C;",
      "  END Use;",
      "END M.",
    ].join("\n");
    expect(
      completionsAt(syntax(), null, { line: 11, character: 29 }, text),
    ).toEqual([]);
  });

  it("applies the INTERLIS 2.3/2.4 DATE and collection rules", () => {
    const text = "MODEL M =\n  DOMAIN D = DA";
    const version24 = syntax();
    const version23 = syntax();
    version23.iliVersion = "2.3";
    expect(
      completionsAt(version24, null, { line: 1, character: 15 }, text).map(
        (item) => item.label,
      ),
    ).toContain("DATE");
    expect(
      completionsAt(version23, null, { line: 1, character: 15 }, text).map(
        (item) => item.label,
      ),
    ).not.toContain("DATE");

    const collectionText = [
      "MODEL M =",
      "  DOMAIN D = TEXT;",
      "  STRUCTURE S =",
      "  END S;",
      "  CLASS C =",
      "    value: LIST OF ",
      "  END C;",
      "END M.",
    ].join("\n");
    const collectionPosition = {
      line: 5,
      character: collectionText.split("\n")[5]!.length,
    };
    const labels24 = completionsAt(
      version24,
      null,
      collectionPosition,
      collectionText,
    ).map((item) => item.label);
    const labels23 = completionsAt(
      version23,
      null,
      collectionPosition,
      collectionText,
    ).map((item) => item.label);
    expect(labels24).toEqual(expect.arrayContaining(["D", "S"]));
    expect(labels23).toContain("S");
    expect(labels23).not.toContain("D");
  });

  it("uses imported semantic symbols only while the current IMPORTS allows them", () => {
    const snapshot = syntax();
    snapshot.imports = ["External"];
    const imported = semantic();
    imported.symbols = [
      {
        id: "external-code",
        name: "Code",
        qualifiedName: "External.Code",
        kind: "domain",
        containerId: "external",
        range: {
          ...range(0, 0),
          uri: "repository:///External.ili",
        },
        selectionRange: null,
        endRange: null,
        abstract: false,
      },
    ];
    const text = [
      "MODEL M =",
      "  IMPORTS External;",
      "  CLASS C =",
      "    value: Co",
      "  END C;",
      "END M.",
    ].join("\n");
    const position = { line: 3, character: 13 };
    expect(
      completionsAt(snapshot, imported, position, text).map(
        (item) => item.label,
      ),
    ).toContain("Code");
    snapshot.imports = [];
    expect(
      completionsAt(snapshot, imported, position, text).map(
        (item) => item.label,
      ),
    ).not.toContain("Code");
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
