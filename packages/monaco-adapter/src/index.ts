import type {
  EditorPosition,
  LanguageService,
  TemplateEdit,
} from "@ilic/language-service";
import { suggestionActivation } from "@ilic/language-service";

export interface Disposable {
  dispose(): void;
}

export interface MonacoModel {
  readonly uri: { toString(): string };
  getValue(): string;
  getVersionId(): number;
  onDidChangeContent(listener: () => void): Disposable;
}

export interface MonacoEditor {
  executeEdits(source: string, edits: readonly unknown[]): boolean;
  setSelection(selection: unknown): void;
}

export interface MonacoApi {
  readonly languages: {
    register(language: {
      id: string;
      extensions: string[];
      aliases: string[];
    }): void;
    registerCompletionItemProvider(
      language: string,
      provider: unknown,
    ): Disposable;
    registerDefinitionProvider(language: string, provider: unknown): Disposable;
    registerReferenceProvider(language: string, provider: unknown): Disposable;
    registerRenameProvider(language: string, provider: unknown): Disposable;
    registerDocumentSymbolProvider(
      language: string,
      provider: unknown,
    ): Disposable;
    registerHoverProvider(language: string, provider: unknown): Disposable;
    registerDocumentFormattingEditProvider(
      language: string,
      provider: unknown,
    ): Disposable;
    registerOnTypeFormattingEditProvider(
      language: string,
      provider: unknown,
    ): Disposable;
  };
  readonly editor: {
    setModelMarkers(
      model: MonacoModel,
      owner: string,
      markers: readonly unknown[],
    ): void;
  };
  readonly Uri: { parse(value: string): unknown };
  readonly Range: new (
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
  ) => unknown;
  readonly Selection: new (
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
  ) => unknown;
}

const position = (value: {
  lineNumber: number;
  column: number;
}): EditorPosition => ({
  line: value.lineNumber - 1,
  character: value.column - 1,
});

export class MonacoLanguageAdapter implements Disposable {
  readonly #registrations: Disposable[] = [];
  readonly #models = new Map<string, Disposable>();

  constructor(
    private readonly monaco: MonacoApi,
    private readonly service: LanguageService,
  ) {
    monaco.languages.register({
      id: "interlis",
      extensions: [".ili"],
      aliases: ["INTERLIS", "interlis"],
    });
    this.#registerProviders();
  }

  attachModel(model: MonacoModel): Disposable {
    const uri = model.uri.toString();
    const update = () => {
      const version = model.getVersionId();
      if (this.service.getDocument(uri))
        this.service.changeDocument(uri, model.getValue(), version);
      else this.service.openDocument(uri, model.getValue(), version);
      this.#publishMarkers(model);
    };
    update();
    const listener = model.onDidChangeContent(update);
    const disposable = {
      dispose: () => {
        listener.dispose();
        this.#models.delete(uri);
        if (this.service.getDocument(uri)) this.service.closeDocument(uri);
      },
    };
    this.#models.get(uri)?.dispose();
    this.#models.set(uri, disposable);
    return disposable;
  }

  suggestionActivation(
    model: MonacoModel,
    value: { lineNumber: number; column: number },
  ) {
    const syntax = this.service.getSyntaxSnapshot(model.uri.toString())?.value;
    return syntax
      ? suggestionActivation(syntax, position(value))
      : { open: false, reason: "none" as const, suppress: false };
  }

  applyTemplateEdit(editor: MonacoEditor, edit: TemplateEdit): void {
    const edits = edit.edits.map((value) => ({
      range: this.#range(value.range),
      text: value.newText,
      forceMoveMarkers: true,
    }));
    editor.executeEdits("interlis.onTypeEdit", edits);
    const selection = edit.finalSelection;
    editor.setSelection(
      new this.monaco.Selection(
        selection.start.line + 1,
        selection.start.character + 1,
        selection.end.line + 1,
        selection.end.character + 1,
      ),
    );
  }

  dispose(): void {
    for (const registration of this.#registrations) registration.dispose();
    for (const model of [...this.#models.values()]) model.dispose();
    this.#registrations.length = 0;
  }

  #registerProviders(): void {
    const languages = this.monaco.languages;
    this.#registrations.push(
      languages.registerCompletionItemProvider("interlis", {
        triggerCharacters: [" ", ".", "=", "(", "*", "@"],
        provideCompletionItems: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
        ) => ({
          suggestions: this.service
            .completion(model.uri.toString(), position(value))
            .map((item) => ({
              ...item,
              insertText: item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === "snippet" ? 4 : 0,
            })),
        }),
      }),
      languages.registerDefinitionProvider("interlis", {
        provideDefinition: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
        ) =>
          this.service
            .definition(model.uri.toString(), position(value))
            .map((location) => ({
              uri: this.monaco.Uri.parse(location.uri),
              range: this.#range(location.range),
            })),
      }),
      languages.registerReferenceProvider("interlis", {
        provideReferences: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
          context: { includeDeclaration: boolean },
        ) =>
          this.service
            .references(
              model.uri.toString(),
              position(value),
              context.includeDeclaration,
            )
            .map((location) => ({
              uri: this.monaco.Uri.parse(location.uri),
              range: this.#range(location.range),
            })),
      }),
      languages.registerRenameProvider("interlis", {
        resolveRenameLocation: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
        ) => {
          const result = this.service.prepareRename(
            model.uri.toString(),
            position(value),
          );
          return result
            ? { range: this.#range(result.range), text: result.placeholder }
            : { rejectReason: "No INTERLIS symbol at cursor." };
        },
        provideRenameEdits: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
          name: string,
        ) => {
          const result = this.service.rename(
            model.uri.toString(),
            position(value),
            name,
          );
          return result
            ? {
                edits: Object.entries(result.changes).flatMap(
                  ([resource, edits]) =>
                    edits.map((edit) => ({
                      resource: this.monaco.Uri.parse(resource),
                      textEdit: {
                        range: this.#range(edit.range),
                        text: edit.newText,
                      },
                      versionId: undefined,
                    })),
                ),
              }
            : { edits: [] };
        },
      }),
      languages.registerDocumentSymbolProvider("interlis", {
        provideDocumentSymbols: (model: MonacoModel) =>
          this.service.symbols(model.uri.toString()).map((symbol) => ({
            ...symbol,
            range: this.#range(symbol.range),
            selectionRange: this.#range(symbol.selectionRange),
          })),
      }),
      languages.registerHoverProvider("interlis", {
        provideHover: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
        ) => {
          const result = this.service.hover(
            model.uri.toString(),
            position(value),
          );
          return result
            ? {
                range: this.#range(result.range),
                contents: [{ value: result.markdown }],
              }
            : null;
        },
      }),
      languages.registerDocumentFormattingEditProvider("interlis", {
        provideDocumentFormattingEdits: (
          model: MonacoModel,
          options: { tabSize: number },
        ) =>
          this.service
            .formatting(model.uri.toString(), { indentSize: options.tabSize })
            .map((edit) => ({
              range: this.#range(edit.range),
              text: edit.newText,
            })),
      }),
      languages.registerOnTypeFormattingEditProvider("interlis", {
        autoFormatTriggerCharacters: ["\n", "="],
        provideOnTypeFormattingEdits: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
          character: string,
        ) =>
          this.service
            .onTypeEdit(model.uri.toString(), position(value), character)
            ?.edits.map((edit) => ({
              range: this.#range(edit.range),
              text: edit.newText,
            })) ?? [],
      }),
    );
  }

  #publishMarkers(model: MonacoModel): void {
    this.monaco.editor.setModelMarkers(
      model,
      "ilic",
      this.service.diagnostics(model.uri.toString()).flatMap((diagnostic) =>
        diagnostic.range
          ? [
              {
                ...this.#markerRange(diagnostic.range),
                severity: { error: 8, warning: 4, information: 2, hint: 1 }[
                  diagnostic.severity
                ],
                code: diagnostic.code,
                message: diagnostic.message,
                source: "ilic",
              },
            ]
          : [],
      ),
    );
  }

  #range(value: { start: EditorPosition; end: EditorPosition }): unknown {
    return new this.monaco.Range(
      value.start.line + 1,
      value.start.character + 1,
      value.end.line + 1,
      value.end.character + 1,
    );
  }

  #markerRange(value: { start: EditorPosition; end: EditorPosition }) {
    return {
      startLineNumber: value.start.line + 1,
      startColumn: value.start.character + 1,
      endLineNumber: value.end.line + 1,
      endColumn: value.end.character + 1,
    };
  }
}

export function registerInterlisMonaco(
  monaco: MonacoApi,
  service: LanguageService,
): MonacoLanguageAdapter {
  return new MonacoLanguageAdapter(monaco, service);
}
