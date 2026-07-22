import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser.js";
import type { LanguageClientOptions } from "vscode-languageclient/browser.js";
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
import {
  openDiagramOnStartup,
  registerDiagramWorkflows,
} from "./diagram-view.js";

let client: LanguageClient | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (hasActiveLegacyExtension()) {
    void vscode.window.showWarningMessage(
      "INTERLIS Language Tools did not start because edigonzales.interlis-editor is active.",
    );
    return;
  }
  const workerUri = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "server-browser.js",
  );
  const worker = new Worker(workerUri.toString(true), { type: "module" });
  const pending = new Map<string, PendingSelection>();
  const initializationOptions = await createInitializationOptions(
    context,
    false,
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
    clientOptions,
    worker,
  );
  const output = vscode.window.createOutputChannel("INTERLIS Compiler");
  const debug = vscode.window.createOutputChannel("INTERLIS Debug", {
    log: true,
  });
  registerClientWorkflows(context, client, output, debug, pending);
  await client.start();
  registerRepositoryWorkflows(context, client, true);
  const startupDocument = vscode.window.activeTextEditor?.document;
  const startupReady = compileActiveDocumentOnStartup(
    client,
    startupDocument,
  ).catch((error: unknown) => {
    debug.appendLine(
      `[${new Date().toISOString()}] startup compilation request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const diagramWorkflows = registerDiagramWorkflows(context, client, {
    startupReady,
  });
  void openDiagramOnStartup(
    diagramWorkflows,
    startupDocument,
    startupReady,
  ).catch((error: unknown) =>
    debug.appendLine(
      `[${new Date().toISOString()}] startup diagram request failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
