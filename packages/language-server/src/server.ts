import type { LanguageService } from "@ilic/language-service";
import type { Connection, InitializeResult } from "vscode-languageserver";
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
  ExportDocxParams,
  OnTypeEditParams,
} from "./protocol.js";

export interface LanguageServerHooks {
  readonly exportDocx?: (params: ExportDocxParams) => Promise<Uint8Array>;
}

export function bindLanguageServer(
  connection: Connection,
  service: LanguageService,
  hooks: LanguageServerHooks = {},
): void {
  const publishDiagnostics = (uri: string): void => {
    void connection.sendDiagnostics({
      uri,
      diagnostics: service.diagnostics(uri).map(toDiagnostic),
    });
  };

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full,
        save: { includeText: true },
      },
      completionProvider: { triggerCharacters: [" ", ".", "=", "(", "*", "@"] },
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
    serverInfo: { name: "@ilic/language-server", version: "0.1.0-next.0" },
  }));

  connection.onDidOpenTextDocument((params) => {
    const document = params.textDocument;
    service.openDocument(document.uri, document.text, document.version);
    publishDiagnostics(document.uri);
  });
  connection.onDidChangeTextDocument((params) => {
    const text = params.contentChanges.at(-1)?.text;
    if (text === undefined) return;
    service.changeDocument(
      params.textDocument.uri,
      text,
      params.textDocument.version,
    );
    publishDiagnostics(params.textDocument.uri);
  });
  connection.onDidSaveTextDocument((params) => {
    service.markSaved(params.textDocument.uri);
    publishDiagnostics(params.textDocument.uri);
  });
  connection.onDidCloseTextDocument((params) => {
    service.closeDocument(params.textDocument.uri);
    void connection.sendDiagnostics({
      uri: params.textDocument.uri,
      diagnostics: [],
    });
  });

  connection.onCompletion((params) =>
    service
      .completion(params.textDocument.uri, params.position)
      .map(toCompletion),
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
    () => service.getSemanticSnapshot()?.value?.diagram ?? null,
  );
  connection.onRequest(InterlisProtocol.compile, (params: CompileParams) =>
    service.compile(params.roots ? [...params.roots] : undefined),
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
    service.dispose();
  });
}
