import { describe, expect, it, vi } from "vitest";
import type { CompilerBackend, SyntaxSnapshot } from "@ilic/language-service";
import { LanguageService } from "@ilic/language-service";
import { MonacoLanguageAdapter } from "./index.js";
import type { MonacoApi, MonacoModel } from "./index.js";

function compiler(): CompilerBackend {
  let version = 0;
  return {
    putSource: (_uri, _source, next) => {
      version = next;
    },
    removeSource: () => true,
    parse: vi.fn((uri: string): SyntaxSnapshot => ({
      schemaVersion: 1,
      abiVersion: 1,
      compilerVersion: "test",
      kind: "syntax",
      success: true,
      uri,
      documentVersion: version,
      iliVersion: "2.4",
      tokens: [],
      nodes: [],
      contexts: [],
      imports: [],
      diagnostics: [],
    })),
    analyze: (request) => ({
      schemaVersion: 1,
      abiVersion: 1,
      compilerVersion: "test",
      kind: "semantic",
      success: true,
      cancelled: false,
      roots: request.roots,
      documentVersions: {},
      symbols: [],
      references: [],
      dependencies: [],
      diagram: { nodes: [], edges: [] },
      documentation: { title: "", sections: [] },
      diagnostics: [],
      logs: [],
    }),
    compileAndAnalyze: (request) => ({
      schemaVersion: 1,
      abiVersion: 1,
      compilerVersion: "test",
      kind: "compilation-analysis",
      compilation: {
        schemaVersion: 1,
        abiVersion: 1,
        compilerVersion: "test",
        kind: "compilation",
        success: true,
        cancelled: false,
        errorCount: 0,
        warningCount: 0,
        missingModels: [],
        models: [],
        diagnostics: [],
        logs: [],
      },
      semantic: {
        schemaVersion: 1,
        abiVersion: 1,
        compilerVersion: "test",
        kind: "semantic",
        success: true,
        cancelled: false,
        roots: request.roots,
        documentVersions: {},
        symbols: [],
        references: [],
        dependencies: [],
        diagram: { nodes: [], edges: [] },
        documentation: { title: "", sections: [] },
        diagnostics: [],
        logs: [],
      },
      syntax: [],
    }),
    compile: () => {
      throw new Error("unused");
    },
    format: () => {
      throw new Error("unused");
    },
    dispose: vi.fn(),
  };
}

describe("MonacoLanguageAdapter", () => {
  it("registers direct providers and owns model lifecycle", async () => {
    const providers: unknown[] = [];
    const disposable = () => ({ dispose: vi.fn() });
    class ValueRange {
      constructor(
        readonly startLine: number,
        readonly startColumn: number,
        readonly endLine: number,
        readonly endColumn: number,
      ) {}
    }
    const markers = vi.fn();
    const monaco = {
      languages: {
        register: vi.fn(),
        registerCompletionItemProvider: (
          _language: string,
          provider: unknown,
        ) => (providers.push(provider), disposable()),
        registerDefinitionProvider: (_language: string, provider: unknown) => (
          providers.push(provider),
          disposable()
        ),
        registerReferenceProvider: (_language: string, provider: unknown) => (
          providers.push(provider),
          disposable()
        ),
        registerRenameProvider: (_language: string, provider: unknown) => (
          providers.push(provider),
          disposable()
        ),
        registerCodeActionProvider: (_language: string, provider: unknown) => (
          providers.push(provider),
          disposable()
        ),
        registerDocumentSymbolProvider: (
          _language: string,
          provider: unknown,
        ) => (providers.push(provider), disposable()),
        registerHoverProvider: (_language: string, provider: unknown) => (
          providers.push(provider),
          disposable()
        ),
        registerDocumentFormattingEditProvider: (
          _language: string,
          provider: unknown,
        ) => (providers.push(provider), disposable()),
        registerOnTypeFormattingEditProvider: (
          _language: string,
          provider: unknown,
        ) => (providers.push(provider), disposable()),
      },
      editor: { setModelMarkers: markers },
      Uri: { parse: (value: string) => value },
      Range: ValueRange,
      Selection: ValueRange,
    } as unknown as MonacoApi;
    const compilerBackend = compiler();
    const parseSpy = vi.spyOn(compilerBackend, "parse");
    const service = new LanguageService(compilerBackend);
    vi.spyOn(service, "diagnostics").mockReturnValue([
      {
        severity: "warning",
        code: "ILIC-LINT-UNUSED-IMPORT",
        message: "Unused import",
        range: {
          uri: "memory:///M.ili",
          start: { line: 1, character: 0, byteOffset: 15 },
          end: { line: 1, character: 3, byteOffset: 18 },
        },
        relatedInformation: [],
        notes: [],
        treatedAsError: false,
        source: "lint",
        tags: ["unnecessary"],
      },
    ]);
    vi.spyOn(service, "codeActions").mockReturnValue([
      {
        title: "Remove unused import",
        kind: "quickfix",
        diagnostics: ["ILIC-LINT-UNUSED-IMPORT"],
        edit: {
          changes: {
            "memory:///M.ili": [
              {
                range: {
                  start: { line: 1, character: 0 },
                  end: { line: 1, character: 3 },
                },
                newText: "",
              },
            ],
          },
        },
      },
    ]);
    const adapter = new MonacoLanguageAdapter(monaco, service);
    let listener: () => void = () => undefined;
    let version = 1;
    let modelText = "INTERLIS 2.4;\nMOD";
    const model: MonacoModel = {
      uri: { toString: () => "memory:///M.ili" },
      getValue: () => modelText,
      getVersionId: () => version,
      onDidChangeContent: (next) => {
        listener = next;
        return disposable();
      },
    };
    const attached = adapter.attachModel(model);
    expect(providers).toHaveLength(9);
    expect(markers).toHaveBeenCalled();
    expect(markers.mock.calls.at(-1)?.[2]).toEqual([
      expect.objectContaining({
        source: "ilic-lint",
        tags: [1],
      }),
    ]);
    const completionProvider = providers[0] as {
      triggerCharacters: string[];
      provideCompletionItems(
        model: MonacoModel,
        position: { lineNumber: number; column: number },
      ): Promise<{
        suggestions: Array<{
          label: string;
          insertText: string;
          insertTextRules: number;
          filterText?: string;
          sortText?: string;
          range?: ValueRange;
        }>;
      }>;
    };
    expect(completionProvider.triggerCharacters).toEqual(
      expect.arrayContaining([":", "[", "/", ")"]),
    );
    const codeActionProvider = providers[4] as {
      provideCodeActions(
        model: MonacoModel,
        range: {
          startLineNumber: number;
          startColumn: number;
          endLineNumber: number;
          endColumn: number;
        },
        context: { markers: Array<{ code: string }> },
      ): {
        actions: Array<{
          title: string;
          edit: {
            edits: Array<{ textEdit: { text: string } }>;
          };
        }>;
      };
    };
    const codeActions = codeActionProvider.provideCodeActions(
      model,
      {
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 4,
      },
      { markers: [{ code: "ILIC-LINT-UNUSED-IMPORT" }] },
    );
    expect(codeActions.actions[0]?.title).toBe("Remove unused import");
    expect(codeActions.actions[0]?.edit.edits[0]?.textEdit.text).toBe("");
    const completions = await completionProvider.provideCompletionItems(model, {
      lineNumber: 2,
      column: 4,
    });
    expect(
      completions.suggestions.find(
        (item) =>
          item.label === "MODEL Name (lang) AT ... VERSION ... = ... END Name.",
      ),
    ).toMatchObject({
      insertTextRules: 5,
      filterText: "MODEL",
      sortText: "30-MODEL Name (lang) AT ... VERSION ... = ... END Name.",
      range: {
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 4,
      },
    });
    version = 2;
    modelText = [
      "INTERLIS 2.4;",
      "MODEL M =",
      "  TOPIC T =",
      "    CLA",
      "  END T;",
      "END M.",
    ].join("\n");
    listener();
    const classCompletions = await completionProvider.provideCompletionItems(
      model,
      {
        lineNumber: 4,
        column: 8,
      },
    );
    expect(
      classCompletions.suggestions.find(
        (item) => item.label === "CLASS Name = ... END Name;",
      ),
    ).toMatchObject({
      insertTextRules: 5,
      filterText: "CLASS",
      sortText: "30-CLASS Name = ... END Name;",
      range: {
        startLine: 4,
        startColumn: 5,
        endLine: 4,
        endColumn: 8,
      },
    });
    const onTypeProvider = providers[8] as {
      autoFormatTriggerCharacters: string[];
    };
    expect(onTypeProvider.autoFormatTriggerCharacters).toEqual(["\n"]);
    version = 3;
    modelText = "INTERLIS 2.4;\nMODE";
    listener();
    expect(service.getDocument("memory:///M.ili")?.version).toBe(3);
    expect(
      adapter.suggestionActivation(model, { lineNumber: 1, column: 1 }).open,
    ).toBe(false);
    parseSpy.mockClear();
    for (let nextVersion = 4; nextVersion <= 103; nextVersion += 1) {
      version = nextVersion;
      modelText = `INTERLIS 2.4;\nMODEL M =\n  CLASS C ${" ".repeat(
        nextVersion % 2,
      )}`;
      listener();
      adapter.suggestionActivation(model, {
        lineNumber: 3,
        column: modelText.split("\n")[2]!.length + 1,
      });
    }
    expect(parseSpy).not.toHaveBeenCalled();
    expect(service.getDocument("memory:///M.ili")?.version).toBe(103);

    const editor = { executeEdits: vi.fn(() => true), setSelection: vi.fn() };
    adapter.applyTemplateEdit(editor, {
      edits: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: "MODEL",
        },
      ],
      finalSelection: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 2 },
      },
    });
    expect(editor.executeEdits).toHaveBeenCalled();
    expect(editor.setSelection).toHaveBeenCalled();
    attached.dispose();
    adapter.dispose();
    service.dispose();
  });
});
