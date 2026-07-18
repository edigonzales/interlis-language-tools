import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node.js";
import type {
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node.js";
import {
  createOnTypeMiddleware,
  documentSelector,
  hasActiveLegacyExtension,
  registerClientWorkflows,
} from "./common.js";
import type { PendingSelection } from "./common.js";

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
  const clientOptions: LanguageClientOptions = {
    documentSelector: documentSelector(),
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
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
