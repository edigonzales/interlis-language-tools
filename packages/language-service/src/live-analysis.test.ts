import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompilerBackend, EditorSnapshot } from "./index.js";
import { createWasmCompilerBackend } from "./index.js";
import {
  analyzeLiveDocument,
  editorOccurrences,
  editorTargetAt,
  resolveEditorReference,
} from "./live-analysis.js";

const uri = "memory:///LiveDiagnostics.ili";

describe("conservative live analysis", () => {
  let compiler: CompilerBackend;

  beforeEach(async () => {
    compiler = await createWasmCompilerBackend();
  });

  afterEach(() => compiler.dispose());

  const analyze = (text: string) => {
    compiler.putSource(uri, text, 1);
    const snapshot = compiler.editorSnapshot?.(uri) as EditorSnapshot;
    return analyzeLiveDocument(snapshot, text, null);
  };

  it("maps completed recovery cases without publishing parser cascades", () => {
    const text = `INTERLIS 2.4;
MODEL LiveDiagnostics (de) AT "https://example.invalid" VERSION "1" =
  TOPIC Data =
    CLASS Item =
      MissingHead;
      MissingType:;
      MissingSemicolon: TEXT
    END Wrong;
  END Data;
END LiveDiagnostics.
`;
    const result = analyze(text);

    expect(result.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "ILIC-LIVE-ATTRIBUTE-HEAD",
        "ILIC-LIVE-ATTRIBUTE-TYPE",
        "ILIC-LIVE-MISSING-SEMICOLON",
        "ILIC-LIVE-END-NAME",
      ]),
    );
    expect(result.diagnostics.every((entry) => entry.source === "live")).toBe(
      true,
    );
    expect(result.fixes.map((fix) => fix.title)).toEqual(
      expect.arrayContaining(["Insert missing ';'", "Replace with 'Item'"]),
    );
  });

  it("does not diagnose an attribute while the user is still typing its type", () => {
    const result = analyze(`INTERLIS 2.4;
MODEL LiveDiagnostics (de) AT "https://example.invalid" VERSION "1" =
  TOPIC Data =
    CLASS Item =
      value: TE
`);
    expect(
      result.diagnostics.some((entry) =>
        entry.code.startsWith("ILIC-LIVE-ATTRIBUTE"),
      ),
    ).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an unknown reference only after its declaration is complete", () => {
    const incomplete = analyze(`INTERLIS 2.4;
MODEL LiveDiagnostics =
  CLASS Item =
    value: Missing
`);
    const complete = analyze(`INTERLIS 2.4;
MODEL LiveDiagnostics =
  CLASS Item =
    value: Missing;
  END Item;
END LiveDiagnostics.
`);
    expect(incomplete.diagnostics).toEqual([]);
    expect(complete.diagnostics).toEqual([
      expect.objectContaining({
        code: "ILIC-LIVE-UNKNOWN-REFERENCE",
      }),
    ]);
  });

  it("suppresses unknown EXTENDS targets while a snippet header is active", () => {
    const snippet = analyze(`INTERLIS 2.4;
MODEL LiveDiagnostics =
  CLASS Child EXTENDS Miss =

  END Child;
END LiveDiagnostics.
`);
    const completed = analyze(`INTERLIS 2.4;
MODEL LiveDiagnostics =
  CLASS Child EXTENDS Missing =
    value: TEXT;
  END Child;
END LiveDiagnostics.
`);
    expect(snippet.diagnostics).toEqual([]);
    expect(
      completed.diagnostics.some(
        (value) => value.code === "ILIC-LIVE-UNKNOWN-REFERENCE",
      ),
    ).toBe(true);
  });

  it("marks only a terminated unused import and offers a removal edit", () => {
    const result = analyze(`INTERLIS 2.4;
MODEL LiveDiagnostics (de) AT "https://example.invalid" VERSION "1" =
  IMPORTS Unused;
END LiveDiagnostics.
`);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "ILIC-LINT-UNUSED-IMPORT",
        severity: "warning",
        tags: ["unnecessary"],
      }),
    ]);
    expect(result.fixes[0]).toEqual(
      expect.objectContaining({
        title: "Remove unused import 'Unused'",
      }),
    );
  });

  it("suppresses unused-import warnings for half-finished qualified use", () => {
    const result = analyze(`INTERLIS 2.4;
MODEL LiveDiagnostics (de) AT "https://example.invalid" VERSION "1" =
  IMPORTS Used;
  DOMAIN D = Used.;
END LiveDiagnostics.
`);
    expect(
      result.diagnostics.some(
        (entry) => entry.code === "ILIC-LINT-UNUSED-IMPORT",
      ),
    ).toBe(false);
  });

  it("resolves current imported workspace scopes without stale semantics", () => {
    const baseUri = "memory:///Base.ili";
    const useUri = "memory:///Use.ili";
    const baseText = `INTERLIS 2.4;
MODEL Base (de) AT "https://example.invalid" VERSION "1" =
  TOPIC Data =
    CLASS Root =
    END Root;
  END Data;
END Base.
`;
    const useText = `INTERLIS 2.4;
MODEL Use (de) AT "https://example.invalid" VERSION "1" =
  IMPORTS Base;
  TOPIC Data =
    CLASS Child EXTENDS Base.Data.Root =
    END Child;
  END Data;
END Use.
`;
    compiler.putSource(baseUri, baseText, 2);
    compiler.putSource(useUri, useText, 3);
    const base = compiler.editorSnapshot?.(baseUri) as EditorSnapshot;
    const use = compiler.editorSnapshot?.(useUri) as EditorSnapshot;
    const declarations = [...base.declarations, ...use.declarations];
    const reference = use.references.find((value) => value.kind === "extends")!;

    const resolved = resolveEditorReference(use, reference, null, declarations);
    expect(resolved?.kind).toBe("editor");
    expect(
      resolved?.kind === "editor"
        ? resolved.declaration.qualifiedName
        : undefined,
    ).toBe("Base.Data.Root");
    expect(
      analyzeLiveDocument(use, useText, null, declarations).diagnostics.some(
        (value) => value.code === "ILIC-LIVE-UNKNOWN-REFERENCE",
      ),
    ).toBe(false);
  });

  it("navigates and renames individual qualified path segments", () => {
    const baseUri = "memory:///Base.ili";
    const useUri = "memory:///Use.ili";
    const baseText = `INTERLIS 2.4;
MODEL Base =
  TOPIC Data =
    CLASS Root =
    END Root;
  END Data;
END Base.
`;
    const useText = `INTERLIS 2.4;
MODEL Use =
  IMPORTS Base;
  CLASS Child EXTENDS Base.Data.Root =
  END Child;
END Use.
`;
    compiler.putSource(baseUri, baseText, 4);
    compiler.putSource(useUri, useText, 5);
    const base = compiler.editorSnapshot?.(baseUri) as EditorSnapshot;
    const use = compiler.editorSnapshot?.(useUri) as EditorSnapshot;
    const declarations = [...base.declarations, ...use.declarations];
    const model = base.declarations.find((value) => value.kind === "model")!;
    const root = base.declarations.find((value) => value.name === "Root")!;
    const reference = use.references.find((value) => value.kind === "extends")!;

    expect(
      editorTargetAt(
        use,
        {
          line: reference.range.start.line,
          character: reference.range.start.character + 1,
        },
        null,
        declarations,
      ),
    ).toEqual(expect.objectContaining({ declaration: model }));

    const modelRanges = editorOccurrences(use, model, null, declarations);
    const useLines = useText.split(/\r?\n/u);
    expect(
      modelRanges.map((range) =>
        useLines[range.start.line]?.slice(
          range.start.character,
          range.end.character,
        ),
      ),
    ).toEqual(["Base", "Base"]);

    const rootRanges = editorOccurrences(use, root, null, declarations);
    expect(
      rootRanges.map((range) =>
        useLines[range.start.line]?.slice(
          range.start.character,
          range.end.character,
        ),
      ),
    ).toEqual(["Root"]);
  });

  it("keeps import edits correct after non-ASCII text", () => {
    const text = `INTERLIS 2.4;
!! Zürich 😀
MODEL LiveDiagnostics =
  IMPORTS Unused;
END LiveDiagnostics.
`;
    const result = analyze(text);
    const edit = result.fixes[0]?.edits[uri]?.[0];
    expect(edit).toEqual({
      range: {
        start: { line: 3, character: 0 },
        end: { line: 4, character: 0 },
      },
      newText: "",
    });
  });
});
