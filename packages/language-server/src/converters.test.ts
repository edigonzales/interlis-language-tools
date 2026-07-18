import { describe, expect, it } from "vitest";
import {
  toCompletion,
  toDiagnostic,
  toDocumentSymbol,
  toLocation,
  toTextEdit,
  toWorkspaceEdit,
} from "./converters.js";

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
    expect(
      toCompletion({
        label: "CLASS",
        kind: "snippet",
        insertText: "CLASS ${1:Name}",
        insertTextFormat: "snippet",
      }).insertTextFormat,
    ).toBe(2);
    expect(
      toWorkspaceEdit({
        changes: { "memory:///M.ili": [{ range, newText: "Renamed" }] },
      }).changes?.["memory:///M.ili"]?.[0]?.newText,
    ).toBe("Renamed");
  });

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

  it("maps hierarchical symbols and unknown kinds", () => {
    const symbol = toDocumentSymbol({
      name: "M",
      detail: "M",
      kind: "Model",
      range,
      selectionRange: range,
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
    expect(symbol.children?.[0]?.name).toBe("Unknown");
  });
});
