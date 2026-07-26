import { describe, expect, it } from "vitest";
import type {
  SemanticSnapshot,
  SourceRange,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import {
  completionGoldenCatalog,
  javaCompletionBaselineCommit,
} from "./completion-golden-catalog.test-data.js";
import { completionItemsAt, detectCompletionContext } from "./completion.js";

const uri = "memory:///CompletionGolden.ili";

function sourceRange(line: number, character: number): SourceRange {
  return {
    uri,
    start: { line, character, byteOffset: line * 100 + character },
    end: {
      line,
      character: character + 1,
      byteOffset: line * 100 + character + 1,
    },
  };
}

function caret(source: string): {
  readonly text: string;
  readonly position: { line: number; character: number };
} {
  const offset = source.indexOf("│");
  if (offset < 0 || source.indexOf("│", offset + 1) >= 0)
    throw new Error("Each golden source must contain exactly one caret.");
  const before = source.slice(0, offset);
  return {
    text: `${before}${source.slice(offset + 1)}`,
    position: {
      line: before.split("\n").length - 1,
      character: before.length - (before.lastIndexOf("\n") + 1),
    },
  };
}

function snapshot(text: string, iliVersion: "2.3" | "2.4"): SyntaxSnapshot {
  return {
    schemaVersion: 1,
    abiVersion: 1,
    compilerVersion: "golden",
    kind: "syntax",
    success: false,
    uri,
    documentVersion: 1,
    iliVersion,
    tokens: [],
    nodes: [],
    contexts: [],
    imports:
      text
        .match(/\bIMPORTS\b([\s\S]*?);/iu)?.[1]
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? [],
    diagnostics: [],
  };
}

const semantic: SemanticSnapshot = {
  schemaVersion: 1,
  abiVersion: 1,
  compilerVersion: "golden",
  kind: "semantic",
  success: true,
  cancelled: false,
  roots: [uri],
  documentVersions: { [uri]: 1 },
  missingModels: [],
  symbols: [
    {
      id: "external",
      name: "External",
      qualifiedName: "External",
      kind: "model",
      containerId: "",
      range: { ...sourceRange(0, 0), uri: "repository:///External.ili" },
      selectionRange: null,
      endRange: null,
      abstract: false,
    },
  ],
  references: [],
  dependencies: [],
  diagram: { nodes: [], edges: [] },
  documentation: { title: "", sections: [] },
  diagnostics: [],
  logs: [],
};

describe(`Java completion golden catalog ${javaCompletionBaselineCommit}`, () => {
  it.each(completionGoldenCatalog)(
    "$id",
    ({
      source,
      iliVersion,
      slot,
      replaceText,
      expectedItems,
      absentLabels,
    }) => {
      const document = caret(source);
      const syntax = snapshot(document.text, iliVersion);
      const context = detectCompletionContext(
        syntax,
        document.text,
        document.position,
      );
      expect(context?.slot).toBe(slot);
      const line = document.text.split("\n")[context!.replaceRange.start.line]!;
      expect(
        line.slice(
          context!.replaceRange.start.character,
          context!.replaceRange.end.character,
        ),
      ).toBe(replaceText);

      const items = completionItemsAt(
        syntax,
        document.text,
        semantic,
        document.position,
      );
      for (const expected of expectedItems) {
        const item = items.find(
          (candidate) => candidate.label === expected.label,
        );
        expect(item, `missing ${expected.label}`).toBeDefined();
        if (expected.kind) expect(item?.kind).toBe(expected.kind);
        if (expected.newText)
          expect(item?.textEdit?.newText).toBe(expected.newText);
        if (expected.sortText) expect(item?.sortText).toBe(expected.sortText);
        expect(item?.textEdit?.range).toEqual(context?.replaceRange);
      }
      for (const label of absentLabels ?? [])
        expect(items.map((item) => item.label)).not.toContain(label);
    },
  );
});
