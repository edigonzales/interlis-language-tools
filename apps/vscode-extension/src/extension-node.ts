import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node.js";
import type {
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node.js";
import {
  createOnTypeMiddleware,
  compileActiveDocumentOnStartup,
  createInitializationOptions,
  documentSelector,
  hasActiveLegacyExtension,
  registerClientWorkflows,
  registerRepositoryWorkflows,
} from "./common.js";
import type { PendingSelection } from "./common.js";
import { registerDiagramWorkflows } from "./diagram-view.js";

let client: LanguageClient | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (hasActiveLegacyExtension()) {
    void vscode.window.showWarningMessage(
      "INTERLIS Language Tools did not start because edigonzales.interlis-editor is active. Disable one extension to avoid duplicate language servers.",
    );
    return;
  }
  const serverModule = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "server-node.js",
  ).fsPath;
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };
  const pending = new Map<string, PendingSelection>();
  const initializationOptions = await createInitializationOptions(
    context,
    true,
  );
  const clientOptions: LanguageClientOptions = {
    documentSelector: documentSelector(),
    initializationOptions,
    middleware: {
      provideOnTypeFormattingEdits: (document, position, character) =>
        createOnTypeMiddleware(() => client!, pending)(
          document,
          position,
          character,
        ),
    },
  };
  client = new LanguageClient(
    "interlisLanguageTools",
    "INTERLIS Language Tools",
    serverOptions,
    clientOptions,
  );
  const output = vscode.window.createOutputChannel("INTERLIS Compiler");
  const debug = vscode.window.createOutputChannel("INTERLIS Debug", {
    log: true,
  });
  registerClientWorkflows(context, client, output, debug, pending);
  await client.start();
  registerRepositoryWorkflows(context, client, false);
  registerDiagramWorkflows(context, client);
  void compileActiveDocumentOnStartup(client).catch((error: unknown) =>
    debug.appendLine(
      `[${new Date().toISOString()}] startup compilation request failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
