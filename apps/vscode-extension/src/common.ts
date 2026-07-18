import * as vscode from "vscode";
import {
  DEFAULT_TEMPLATE_URL,
  fetchTemplate,
  isBlankInterlisDocument,
} from "@ilic/language-service";
import { InterlisProtocol } from "@ilic/language-server/protocol";
import type {
  CompileParams,
  OnTypeEditParams,
} from "@ilic/language-server/protocol";
import type { CompilationResult, TemplateEdit } from "@ilic/language-service";

export interface LanguageClientFacade {
  sendRequest<R>(method: string, params: unknown): Promise<R>;
  onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): vscode.Disposable;
}

export interface PendingSelection {
  readonly uri: string;
  readonly version: number;
  readonly selection: vscode.Selection;
}

export function documentSelector(): Array<{
  language: string;
  scheme: string;
}> {
  return ["file", "untitled", "vscode-vfs"].map((scheme) => ({
    language: "interlis",
    scheme,
  }));
}

export function fallbackSetting<T>(
  key: string,
  legacyKey: string,
  defaultValue: T,
): T {
  const current = vscode.workspace
    .getConfiguration("interlisLanguageTools")
    .inspect<T>(key);
  const configured =
    current?.workspaceFolderValue ??
    current?.workspaceValue ??
    current?.globalValue;
  if (configured !== undefined) return configured;
  return (
    vscode.workspace.getConfiguration("interlisLsp").get<T>(legacyKey) ??
    defaultValue
  );
}

export function createOnTypeMiddleware(
  client: () => LanguageClientFacade,
  pending: Map<string, PendingSelection>,
) {
  return async (
    document: vscode.TextDocument,
    position: vscode.Position,
    character: string,
  ): Promise<vscode.TextEdit[]> => {
    const result = await client().sendRequest<TemplateEdit | null>(
      InterlisProtocol.onTypeEdit,
      {
        uri: document.uri.toString(),
        position: { line: position.line, character: position.character },
        character,
      } satisfies OnTypeEditParams,
    );
    if (!result) return [];
    const selection = new vscode.Selection(
      result.finalSelection.start.line,
      result.finalSelection.start.character,
      result.finalSelection.end.line,
      result.finalSelection.end.character,
    );
    pending.set(document.uri.toString(), {
      uri: document.uri.toString(),
      version: document.version + 1,
      selection,
    });
    return result.edits.map(
      (edit) =>
        new vscode.TextEdit(
          new vscode.Range(
            edit.range.start.line,
            edit.range.start.character,
            edit.range.end.line,
            edit.range.end.character,
          ),
          edit.newText,
        ),
    );
  };
}

export function registerClientWorkflows(
  context: vscode.ExtensionContext,
  client: LanguageClientFacade,
  output: vscode.OutputChannel,
  debug: vscode.OutputChannel,
  pending: Map<string, PendingSelection>,
): void {
  context.subscriptions.push(
    output,
    debug,
    client.onNotification(InterlisProtocol.log, (event) => {
      debug.appendLine(
        `[${new Date().toISOString()}] ${JSON.stringify(event)}`,
      );
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const key = event.document.uri.toString();
      const target = pending.get(key);
      if (!target || target.version !== event.document.version) return;
      const editor = vscode.window.visibleTextEditors.find(
        (candidate) => candidate.document.uri.toString() === key,
      );
      if (editor) editor.selection = target.selection;
      pending.delete(key);
    }),
    vscode.commands.registerCommand(
      "interlisLanguageTools.compile",
      async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.languageId !== "interlis") return;
        if (isBlankInterlisDocument(document.getText())) {
          void vscode.window.showInformationMessage(
            "The INTERLIS file is empty. Add a model before compiling.",
          );
          return;
        }
        const result = await client.sendRequest<CompilationResult>(
          InterlisProtocol.compile,
          { roots: [document.uri.toString()] } satisfies CompileParams,
        );
        output.appendLine(
          `[${new Date().toISOString()}] ${result.success ? "Compilation succeeded" : "Compilation failed"}: ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
        );
        for (const log of result.logs)
          output.appendLine(`[${log.level}] ${log.message}`);
        output.show(true);
      },
    ),
    vscode.commands.registerCommand(
      "interlisLanguageTools.template.new",
      async () => {
        try {
          const configured = fallbackSetting(
            "template.url",
            "template.url",
            DEFAULT_TEMPLATE_URL,
          );
          const content = await fetchTemplate(configured);
          const document = await vscode.workspace.openTextDocument({
            language: "interlis",
            content,
          });
          await vscode.window.showTextDocument(document);
        } catch (error) {
          void vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "interlisLanguageTools.snippet.nextPlaceholder",
      () => vscode.commands.executeCommand("jumpToNextSnippetPlaceholder"),
    ),
    vscode.commands.registerCommand(
      "interlisLanguageTools.snippet.cursorMove",
      async (command?: string) => {
        await vscode.commands.executeCommand("leaveSnippet");
        if (command) await vscode.commands.executeCommand(command);
      },
    ),
  );

  if (fallbackSetting("autoShowOutputOnStart", "autoShowOutputOnStart", true))
    output.show(true);
}

export function hasActiveLegacyExtension(): boolean {
  return (
    vscode.extensions.getExtension("edigonzales.interlis-editor")?.isActive ===
    true
  );
}
