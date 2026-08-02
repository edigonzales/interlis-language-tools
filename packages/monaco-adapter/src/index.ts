import type {
  EditorPosition,
  LanguageService,
  TemplateEdit,
} from "@ilic/language-service";
import { suggestionActivationFromContext } from "@ilic/language-service";

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

export interface MonacoLanguageAdapterOptions {
  readonly ensureModel?: (uri: string) => Promise<void>;
}

export interface AttachModelOptions {
  readonly readOnly?: boolean;
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
    registerCodeActionProvider(language: string, provider: unknown): Disposable;
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
  readonly #models = new Map<
    string,
    { readonly model: MonacoModel; readonly disposable: Disposable }
  >();

  constructor(
    private readonly monaco: MonacoApi,
    private readonly service: LanguageService,
    private readonly options: MonacoLanguageAdapterOptions = {},
  ) {
    monaco.languages.register({
      id: "interlis",
      extensions: [".ili"],
      aliases: ["INTERLIS", "interlis"],
    });
    this.#registerProviders();
    this.#registrations.push(
      service.onCompilation(() => {
        for (const { model } of this.#models.values())
          this.#publishMarkers(model);
      }),
      service.onDiagnosticsChanged((event) => {
        const entry = this.#models.get(event.uri);
        if (entry && event.status !== "scheduled" && event.status !== "running")
          this.#publishMarkers(entry.model);
      }),
    );
  }

  attachModel(
    model: MonacoModel,
    options: AttachModelOptions = {},
  ): Disposable {
    const uri = model.uri.toString();
    this.#models.get(uri)?.disposable.dispose();
    const update = () => {
      if (options.readOnly) {
        this.#publishMarkers(model);
        return;
      }
      const version = model.getVersionId();
      if (this.service.getDocument(uri))
        this.service.changeDocument(uri, model.getValue(), version);
      else this.service.openDocument(uri, model.getValue(), version);
    };
    let listener: Disposable | null = null;
    const disposable = {
      dispose: () => {
        listener?.dispose();
        this.#models.delete(uri);
        if (!options.readOnly && this.service.getDocument(uri))
          this.service.closeDocument(uri);
      },
    };
    this.#models.set(uri, { model, disposable });
    // Register the model before opening/changing the document. Live analysis
    // may publish a ready diagnostic result asynchronously during this call;
    // the event must already have a model target so warning markers cannot be
    // lost during attachment.
    listener = model.onDidChangeContent(update);
    update();
    this.#publishMarkers(model);
    return disposable;
  }

  suggestionActivation(
    model: MonacoModel,
    value: { lineNumber: number; column: number },
  ) {
    return suggestionActivationFromContext(
      this.service.completionContext(model.uri.toString(), position(value)),
    );
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
    for (const { disposable } of [...this.#models.values()])
      disposable.dispose();
    this.#registrations.length = 0;
  }

  #registerProviders(): void {
    const languages = this.monaco.languages;
    this.#registrations.push(
      languages.registerCompletionItemProvider("interlis", {
        triggerCharacters: [" ", ".", "=", "(", "*", "@", ":", "[", "/", ")"],
        provideCompletionItems: async (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
        ) => ({
          suggestions: (
            await this.service.completion(model.uri.toString(), position(value))
          ).map((item) => ({
            ...item,
            insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
            range: item.textEdit ? this.#range(item.textEdit.range) : undefined,
            filterText: item.filterText,
            sortText: item.sortText,
            insertTextRules:
              (item.insertTextFormat === "snippet" ? 4 : 0) |
              (item.insertTextMode === "as-is" ? 1 : 0),
          })),
        }),
      }),
      languages.registerDefinitionProvider("interlis", {
        provideDefinition: async (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
        ) => {
          const locations = this.service.definition(
            model.uri.toString(),
            position(value),
          );
          const ensureModel = this.options.ensureModel;
          if (ensureModel)
            await Promise.all(
              locations.map((location) => ensureModel(location.uri)),
            );
          return locations.map((location) => ({
            uri: this.monaco.Uri.parse(location.uri),
            range: this.#range(location.range),
          }));
        },
      }),
      languages.registerReferenceProvider("interlis", {
        provideReferences: async (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
          context: { includeDeclaration: boolean },
        ) => {
          const locations = this.service.references(
            model.uri.toString(),
            position(value),
            context.includeDeclaration,
          );
          const ensureModel = this.options.ensureModel;
          if (ensureModel)
            await Promise.all(
              locations.map((location) => ensureModel(location.uri)),
            );
          return locations.map((location) => ({
            uri: this.monaco.Uri.parse(location.uri),
            range: this.#range(location.range),
          }));
        },
      }),
      languages.registerRenameProvider("interlis", {
        resolveRenameLocation: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
        ) => {
          const editorPosition = position(value);
          const result = this.service.prepareRename(
            model.uri.toString(),
            editorPosition,
          );
          if (result)
            return {
              range: this.#range(result.range),
              text: result.placeholder,
            };
          return {
            rejectReason:
              this.service.renameRejectionReason(
                model.uri.toString(),
                editorPosition,
              ) ?? "No INTERLIS symbol at cursor.",
          };
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
      languages.registerCodeActionProvider("interlis", {
        provideCodeActions: (
          model: MonacoModel,
          value: {
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
          },
          context: {
            markers?: Array<{ code?: string | { value: string } }>;
          } = {},
        ) => ({
          actions: this.service
            .codeActions(
              model.uri.toString(),
              {
                start: {
                  line: value.startLineNumber - 1,
                  character: value.startColumn - 1,
                },
                end: {
                  line: value.endLineNumber - 1,
                  character: value.endColumn - 1,
                },
              },
              (context.markers ?? []).flatMap((marker) => {
                const code =
                  typeof marker.code === "string"
                    ? marker.code
                    : marker.code?.value;
                return code ? [code] : [];
              }),
            )
            .map((action) => ({
              title: action.title,
              kind: action.kind,
              edit: {
                edits: Object.entries(action.edit.changes).flatMap(
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
              },
            })),
          dispose() {},
        }),
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
        autoFormatTriggerCharacters: ["\n"],
        provideOnTypeFormattingEdits: (
          model: MonacoModel,
          value: { lineNumber: number; column: number },
          character: string,
          options: { tabSize?: number; insertSpaces?: boolean } = {},
        ) =>
          this.service
            .onTypeEdit(
              model.uri.toString(),
              position(value),
              character,
              options,
            )
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
      this.service.diagnostics(model.uri.toString()).map((diagnostic) => ({
        ...this.#markerRange(diagnostic.range),
        severity: diagnostic.treatedAsError
          ? 8
          : { error: 8, warning: 4, information: 2, hint: 1 }[
              diagnostic.severity
            ],
        code: diagnostic.code,
        message: diagnostic.message,
        source:
          diagnostic.source === "live"
            ? "ilic-live"
            : diagnostic.source === "lint"
              ? "ilic-lint"
              : "ilic",
        tags: diagnostic.tags?.flatMap((tag) =>
          tag === "unnecessary" ? [1] : tag === "deprecated" ? [2] : [],
        ),
        relatedInformation: diagnostic.relatedInformation.flatMap((value) =>
          value.range
            ? [
                {
                  resource: this.monaco.Uri.parse(value.range.uri),
                  ...this.#markerRange(value.range),
                  message: value.message,
                },
              ]
            : [],
        ),
      })),
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

  #markerRange(value: { start: EditorPosition; end: EditorPosition } | null) {
    if (!value)
      return {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
      };
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
  options: MonacoLanguageAdapterOptions = {},
): MonacoLanguageAdapter {
  return new MonacoLanguageAdapter(monaco, service, options);
}
