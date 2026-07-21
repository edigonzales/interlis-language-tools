import type { LanguageService } from "@ilic/language-service";
import type {
  Connection,
  InitializeParams,
  InitializeResult,
} from "vscode-languageserver";
import { TextDocumentSyncKind } from "vscode-languageserver";
import {
  toCompletion,
  toDiagnostic,
  toDocumentSymbol,
  toLocation,
  toRange,
  toTextEdit,
  toWorkspaceEdit,
} from "./converters.js";
import { InterlisProtocol } from "./protocol.js";
import type {
  CompileParams,
  CompilationCompletedParams,
  DiagramSnapshotParams,
  ExportDocxParams,
  InterlisInitializationOptions,
  OnTypeEditParams,
  RepositoryConfigurationParams,
  RepositorySourceResult,
  WorkspaceSourceChangedParams,
  WorkspaceSourcesParams,
} from "./protocol.js";

export interface LanguageServerHooks {
  readonly exportDocx?: (params: ExportDocxParams) => Promise<Uint8Array>;
  readonly configureRepositories?: (
    repositories: readonly string[],
    options: InterlisInitializationOptions,
  ) => Promise<void>;
}

export function bindLanguageServer(
  connection: Connection,
  service: LanguageService,
  hooks: LanguageServerHooks = {},
): void {
  let initializationOptions: InterlisInitializationOptions = {};
  let publishedDiagnosticUris = new Set<string>();
  const compilationSubscription = service.onCompilation((event) => {
    for (const uri of publishedDiagnosticUris)
      void connection.sendDiagnostics({ uri, diagnostics: [] });
    const grouped = new Map<string, typeof event.compilation.diagnostics>();
    for (const diagnostic of event.compilation.diagnostics) {
      const uri = diagnostic.range?.uri ?? event.rootUri;
      grouped.set(uri, [...(grouped.get(uri) ?? []), diagnostic]);
    }
    publishedDiagnosticUris = new Set(grouped.keys());
    for (const [uri, diagnostics] of grouped)
      void connection.sendDiagnostics({
        uri,
        diagnostics: diagnostics.map(toDiagnostic),
      });
    void connection.sendNotification(InterlisProtocol.compilationCompleted, {
      runId: event.runId,
      timestamp: event.timestamp,
      trigger: event.trigger,
      rootUri: event.rootUri,
      documentVersion: event.documentVersion,
      compilation: event.compilation,
    } satisfies CompilationCompletedParams);
  });

  connection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      const options = (params.initializationOptions ??
        {}) as InterlisInitializationOptions;
      initializationOptions = options;
      service.replaceWorkspaceSources(options.workspaceSources ?? []);
      await hooks.configureRepositories?.(
        options.modelRepositories ?? ["https://models.interlis.ch"],
        options,
      );
      return {
        capabilities: {
          textDocumentSync: {
            openClose: true,
            change: TextDocumentSyncKind.Full,
            save: { includeText: true },
          },
          completionProvider: {
            triggerCharacters: [" ", ".", "=", "(", "*", "@"],
          },
          definitionProvider: true,
          referencesProvider: true,
          renameProvider: { prepareProvider: true },
          documentSymbolProvider: true,
          hoverProvider: true,
          documentFormattingProvider: true,
          documentOnTypeFormattingProvider: {
            firstTriggerCharacter: "\n",
            moreTriggerCharacter: ["="],
          },
        },
        serverInfo: { name: "@ilic/language-server", version: "0.1.0" },
      };
    },
  );

  connection.onDidOpenTextDocument((params) => {
    const document = params.textDocument;
    service.openDocument(document.uri, document.text, document.version);
  });
  connection.onDidChangeTextDocument((params) => {
    if (service.isReadOnlyUri(params.textDocument.uri)) return;
    const text = params.contentChanges.at(-1)?.text;
    if (text === undefined) return;
    service.changeDocument(
      params.textDocument.uri,
      text,
      params.textDocument.version,
    );
  });
  connection.onDidSaveTextDocument((params) => {
    service.markSaved(params.textDocument.uri);
    void service
      .compileDocument(params.textDocument.uri, "save")
      .catch((error: unknown) =>
        connection.console.error(
          `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  });
  connection.onDidCloseTextDocument((params) => {
    service.closeDocument(params.textDocument.uri);
  });

  connection.onCompletion(async (params) =>
    (await service.completion(params.textDocument.uri, params.position)).map(
      toCompletion,
    ),
  );
  connection.onDefinition((params) =>
    service
      .definition(params.textDocument.uri, params.position)
      .map(toLocation),
  );
  connection.onReferences((params) =>
    service
      .references(
        params.textDocument.uri,
        params.position,
        params.context.includeDeclaration,
      )
      .map(toLocation),
  );
  connection.onPrepareRename((params) => {
    const result = service.prepareRename(
      params.textDocument.uri,
      params.position,
    );
    return result
      ? { range: toRange(result.range), placeholder: result.placeholder }
      : null;
  });
  connection.onRenameRequest((params) => {
    const result = service.rename(
      params.textDocument.uri,
      params.position,
      params.newName,
    );
    return result ? toWorkspaceEdit(result) : null;
  });
  connection.onDocumentSymbol((params) =>
    service.symbols(params.textDocument.uri).map(toDocumentSymbol),
  );
  connection.onHover((params) => {
    const result = service.hover(params.textDocument.uri, params.position);
    return result
      ? {
          contents: { kind: "markdown" as const, value: result.markdown },
          range: toRange(result.range),
        }
      : null;
  });
  connection.onDocumentFormatting((params) =>
    service
      .formatting(params.textDocument.uri, {
        indentSize: params.options.tabSize,
      })
      .map(toTextEdit),
  );
  connection.onDocumentOnTypeFormatting(
    (params) =>
      service
        .onTypeEdit(params.textDocument.uri, params.position, params.ch)
        ?.edits.map(toTextEdit) ?? [],
  );

  connection.onRequest(
    InterlisProtocol.onTypeEdit,
    (params: OnTypeEditParams) =>
      service.onTypeEdit(params.uri, params.position, params.character),
  );
  connection.onRequest(
    InterlisProtocol.diagramSnapshot,
    (params: DiagramSnapshotParams) => {
      const result = service.getSavedSemanticSnapshot(params.uri);
      return result?.value
        ? {
            freshness: result.freshness,
            generation: result.generation,
            snapshot: result.value,
          }
        : null;
    },
  );
  connection.onRequest(InterlisProtocol.compile, (params: CompileParams) =>
    service
      .compileDocument(params.uri, params.trigger ?? "manual")
      .then((event) => event.compilation),
  );
  connection.onNotification(
    InterlisProtocol.workspaceSources,
    (params: WorkspaceSourcesParams) =>
      service.replaceWorkspaceSources(params.sources),
  );
  connection.onNotification(
    InterlisProtocol.workspaceSourceChanged,
    (params: WorkspaceSourceChangedParams) => {
      if (params.deleted) service.removeWorkspaceSource(params.uri);
      else if (params.text !== undefined)
        service.putWorkspaceSource(params.uri, params.text, params.version);
    },
  );
  connection.onNotification(
    InterlisProtocol.repositoryConfiguration,
    (params: RepositoryConfigurationParams) => {
      const pending = hooks.configureRepositories?.(
        params.modelRepositories,
        initializationOptions,
      );
      void pending?.catch((error: unknown) =>
        connection.console.error(
          `Repository configuration failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    },
  );
  connection.onRequest(
    InterlisProtocol.repositorySource,
    (params: { uri: string }): RepositorySourceResult | null => {
      const document = service.getRepositoryDocument(params.uri);
      if (!document) return null;
      const text =
        typeof document.source === "string"
          ? document.source
          : new TextDecoder().decode(document.source);
      return {
        uri: document.uri,
        originUri: document.originUri,
        text,
        readOnly: true,
      };
    },
  );
  connection.onRequest(
    InterlisProtocol.exportDocx,
    async (params: ExportDocxParams) => {
      if (!hooks.exportDocx)
        throw new Error("DOCX generation is not installed");
      return [...(await hooks.exportDocx(params))];
    },
  );
  connection.onShutdown(() => {
    compilationSubscription.dispose();
    service.dispose();
  });
}
