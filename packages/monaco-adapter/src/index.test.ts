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
    parse: (uri): SyntaxSnapshot => ({
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
    }),
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
  it("registers direct providers and owns model lifecycle", () => {
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
    const service = new LanguageService(compiler(), {
      semanticDebounceMs: 10_000,
    });
    const adapter = new MonacoLanguageAdapter(monaco, service);
    let listener: () => void = () => undefined;
    let version = 1;
    const model: MonacoModel = {
      uri: { toString: () => "memory:///M.ili" },
      getValue: () => "INTERLIS 2.4;",
      getVersionId: () => version,
      onDidChangeContent: (next) => {
        listener = next;
        return disposable();
      },
    };
    const attached = adapter.attachModel(model);
    expect(providers).toHaveLength(8);
    expect(markers).toHaveBeenCalled();
    version = 2;
    listener();
    expect(service.getDocument("memory:///M.ili")?.version).toBe(2);
    expect(
      adapter.suggestionActivation(model, { lineNumber: 1, column: 1 }).open,
    ).toBe(false);

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
