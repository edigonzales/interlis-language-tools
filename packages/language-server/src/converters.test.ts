import { describe, expect, it } from "vitest";
import {
  toCompletion,
  toDiagnostic,
  toDocumentSymbol,
  toLocation,
  toTextEdit,
  toWorkspaceEdit,
} from "./converters.js";
import {
  CompletionItemKind,
  DiagnosticTag,
  InsertTextFormat,
  InsertTextMode,
  SymbolKind,
} from "vscode-languageserver";

const range = {
  start: { line: 1, character: 2 },
  end: { line: 1, character: 5 },
};

describe("LSP converters", () => {
  it("maps core locations, edits, completion and rename results", () => {
    expect(toLocation({ uri: "memory:///M.ili", range }).range.start.line).toBe(
      1,
    );
    expect(toTextEdit({ range, newText: "Name" }).newText).toBe("Name");
    const completion = toCompletion({
      label: "CLASS",
      kind: "snippet",
      insertText: "CLASS ${1:Name}",
      insertTextFormat: "snippet",
      insertTextMode: "as-is",
      filterText: "CLASS",
      sortText: "30-CLASS",
      textEdit: { range, newText: "CLASS ${1:Name}" },
    });
    expect(completion).toMatchObject({
      insertTextFormat: 2,
      insertTextMode: 1,
      filterText: "CLASS",
      sortText: "30-CLASS",
      textEdit: { range, newText: "CLASS ${1:Name}" },
    });
    expect(
      toWorkspaceEdit({
        changes: { "memory:///M.ili": [{ range, newText: "Renamed" }] },
      }).changes?.["memory:///M.ili"]?.[0]?.newText,
    ).toBe("Renamed");
  });

  it.each([
    [
      "MODEL",
      "keyword",
      "MODEL",
      "25-MODEL",
      CompletionItemKind.Keyword,
      InsertTextFormat.PlainText,
    ],
    [
      "CLASS Name = ... END Name;",
      "snippet",
      "CLASS ${1:Name} ${2:}=\n  $0\nEND ${1};",
      "30-CLASS",
      CompletionItemKind.Snippet,
      InsertTextFormat.Snippet,
    ],
    [
      "External",
      "module",
      "External",
      "20-External",
      CompletionItemKind.Module,
      InsertTextFormat.PlainText,
    ],
    [
      "Code",
      "value",
      "Code",
      "10-Code",
      CompletionItemKind.Value,
      InsertTextFormat.PlainText,
    ],
  ] as const)(
    "preserves the completion contract for %s",
    (label, kind, newText, sortText, expectedKind, expectedFormat) => {
      expect(
        toCompletion({
          label,
          kind,
          insertText: newText,
          insertTextFormat: expectedFormat === 2 ? "snippet" : "plain",
          insertTextMode: "as-is",
          filterText: label.split(" ")[0],
          sortText,
          textEdit: { range, newText },
        }),
      ).toMatchObject({
        label,
        kind: expectedKind,
        insertTextFormat: expectedFormat,
        insertTextMode: InsertTextMode.asIs,
        filterText: label.split(" ")[0],
        sortText,
        textEdit: { range, newText },
      });
    },
  );

  it("maps diagnostics with related locations and safe fallback ranges", () => {
    const diagnostic = toDiagnostic({
      severity: "warning",
      code: "W1",
      message: "Warning",
      range: null,
      relatedInformation: [
        {
          range: {
            uri: "memory:///M.ili",
            start: { ...range.start, byteOffset: 2 },
            end: { ...range.end, byteOffset: 5 },
          },
          message: "related",
        },
        { range: null, message: "without location" },
      ],
      notes: [],
      treatedAsError: false,
    });
    expect(diagnostic.severity).toBe(2);
    expect(diagnostic.range.start).toEqual({ line: 0, character: 0 });
    expect(diagnostic.relatedInformation).toHaveLength(1);
  });

  it("preserves live diagnostic provenance and editor tags", () => {
    const diagnostic = toDiagnostic({
      severity: "warning",
      code: "ILIC-LINT-UNUSED-IMPORT",
      message: "Unused import",
      range: {
        uri: "memory:///M.ili",
        start: { ...range.start, byteOffset: 2 },
        end: { ...range.end, byteOffset: 5 },
      },
      relatedInformation: [],
      notes: [],
      treatedAsError: false,
      source: "lint",
      tags: ["unnecessary"],
    });
    expect(diagnostic.source).toBe("ilic-lint");
    expect(diagnostic.tags).toEqual([DiagnosticTag.Unnecessary]);
  });

  it("maps hierarchical symbols and unknown kinds", () => {
    const symbol = toDocumentSymbol({
      name: "M",
      detail: "MODEL",
      kind: "model",
      range,
      selectionRange: {
        start: range.start,
        end: range.start,
      },
      children: [
        {
          name: "Unknown",
          detail: "M.Unknown",
          kind: "Unknown",
          range,
          selectionRange: range,
          children: [],
        },
      ],
    });
    expect(symbol.kind).toBe(SymbolKind.Module);
    expect(symbol.children?.[0]?.name).toBe("Unknown");
  });

  it("maps INTERLIS member kinds to Java-compatible LSP kinds", () => {
    const kinds = [
      ["topic", SymbolKind.Namespace],
      ["class", SymbolKind.Class],
      ["structure", SymbolKind.Struct],
      ["association", SymbolKind.Interface],
      ["attribute", SymbolKind.Property],
      ["role", SymbolKind.Property],
      ["domain", SymbolKind.TypeParameter],
      ["unit", SymbolKind.Constant],
      ["function", SymbolKind.Function],
    ] as const;
    for (const [kind, expected] of kinds) {
      expect(
        toDocumentSymbol({
          name: kind,
          detail: "",
          kind,
          range,
          selectionRange: range,
          children: [],
        }).kind,
      ).toBe(expected);
    }
  });
});
