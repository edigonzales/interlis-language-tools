import * as vscode from "vscode";
import {
  DEFAULT_TEMPLATE_URL,
  fetchTemplate,
  isBlankInterlisDocument,
} from "@ilic/language-service";
import { InterlisProtocol } from "@ilic/language-server/protocol";
import type {
  CompileParams,
  ExportDocxParams,
  InterlisInitializationOptions,
  OnTypeEditParams,
  RepositoryConfigurationParams,
  RepositorySourceResult,
  WorkspaceSourceChangedParams,
  WorkspaceSourcePayload,
  WorkspaceSourcesParams,
} from "@ilic/language-server/protocol";
import type { CompilationResult, TemplateEdit } from "@ilic/language-service";

export interface LanguageClientFacade {
  sendRequest<R>(method: string, params: unknown): Promise<R>;
  sendNotification(method: string, params: unknown): Promise<void>;
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
  return ["file", "untitled", "vscode-vfs", "interlis-repository"].map(
    (scheme) => ({
      language: "interlis",
      scheme,
    }),
  );
}

const DEFAULT_MODEL_REPOSITORIES = "%ILI_DIR;https://models.interlis.ch";
const jarDirectoryWarningKey = "interlisLanguageTools.warnedJarDirectory";
const ignoredWorkspaceSegments = new Set([
  ".git",
  "node_modules",
  "build",
  "dist",
  "artifacts",
]);

interface ParsedRepositoryConfiguration {
  readonly repositories: string[];
  readonly includeWorkspace: boolean;
  readonly containsJarDirectory: boolean;
}

function repositoryConfiguration(): ParsedRepositoryConfiguration {
  const configured = fallbackSetting(
    "modelRepositories",
    "modelRepositories",
    DEFAULT_MODEL_REPOSITORIES,
  );
  const entries = configured
    .split(/[;,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    repositories: entries.filter((entry) => /^https?:\/\//iu.test(entry)),
    includeWorkspace: entries.includes("%ILI_DIR"),
    containsJarDirectory: entries.includes("%JAR_DIR"),
  };
}

const isIgnoredWorkspaceUri = (uri: vscode.Uri): boolean =>
  uri.path.split("/").some((segment) => ignoredWorkspaceSegments.has(segment));

async function readWorkspaceSource(
  uri: vscode.Uri,
): Promise<WorkspaceSourcePayload | null> {
  if (isIgnoredWorkspaceUri(uri)) return null;
  try {
    const [bytes, stat] = await Promise.all([
      vscode.workspace.fs.readFile(uri),
      vscode.workspace.fs.stat(uri),
    ]);
    return {
      uri: uri.toString(),
      text: new TextDecoder().decode(bytes),
      version: Math.max(1, Math.trunc(stat.mtime)),
    };
  } catch {
    return null;
  }
}

export async function collectWorkspaceSources(): Promise<
  WorkspaceSourcePayload[]
> {
  const configuration = repositoryConfiguration();
  if (!configuration.includeWorkspace) return [];
  const uris = await vscode.workspace.findFiles(
    "**/*.ili",
    "**/{.git,node_modules,build,dist,artifacts}/**",
  );
  const sources = await Promise.all(uris.map(readWorkspaceSource));
  return sources.filter(
    (source): source is WorkspaceSourcePayload => source !== null,
  );
}

export async function createInitializationOptions(
  context: vscode.ExtensionContext,
  nodeRuntime: boolean,
): Promise<InterlisInitializationOptions> {
  const configuration = repositoryConfiguration();
  if (
    configuration.containsJarDirectory &&
    !context.globalState.get<boolean>(jarDirectoryWarningKey)
  ) {
    await vscode.window.showWarningMessage(
      "%JAR_DIR is not available in INTERLIS Language Tools and is ignored. Use %ILI_DIR or an HTTP(S) model repository.",
    );
    await context.globalState.update(jarDirectoryWarningKey, true);
  }
  return {
    modelRepositories: configuration.repositories,
    workspaceSources: await collectWorkspaceSources(),
    repositoryCachePath: nodeRuntime
      ? context.globalStorageUri.fsPath
      : undefined,
  };
}

export function registerRepositoryWorkflows(
  context: vscode.ExtensionContext,
  client: LanguageClientFacade,
  virtualDocuments: boolean,
): void {
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.ili");
  const update = async (uri: vscode.Uri): Promise<void> => {
    if (!repositoryConfiguration().includeWorkspace) return;
    const source = await readWorkspaceSource(uri);
    if (!source) return;
    await client.sendNotification(
      InterlisProtocol.workspaceSourceChanged,
      source satisfies WorkspaceSourceChangedParams,
    );
  };
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate((uri) => void update(uri)),
    watcher.onDidChange((uri) => void update(uri)),
    watcher.onDidDelete((uri) => {
      if (
        !repositoryConfiguration().includeWorkspace ||
        isIgnoredWorkspaceUri(uri)
      )
        return;
      void client.sendNotification(InterlisProtocol.workspaceSourceChanged, {
        uri: uri.toString(),
        deleted: true,
      } satisfies WorkspaceSourceChangedParams);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        !event.affectsConfiguration("interlisLanguageTools.modelRepositories")
      )
        return;
      const configuration = repositoryConfiguration();
      if (
        configuration.containsJarDirectory &&
        !context.globalState.get<boolean>(jarDirectoryWarningKey)
      ) {
        await vscode.window.showWarningMessage(
          "%JAR_DIR is ignored; no Java/JAR model bundle is shipped.",
        );
        await context.globalState.update(jarDirectoryWarningKey, true);
      }
      await client.sendNotification(InterlisProtocol.repositoryConfiguration, {
        modelRepositories: configuration.repositories,
      } satisfies RepositoryConfigurationParams);
      await client.sendNotification(InterlisProtocol.workspaceSources, {
        sources: await collectWorkspaceSources(),
      } satisfies WorkspaceSourcesParams);
    }),
  );
  if (virtualDocuments)
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        "interlis-repository",
        {
          async provideTextDocumentContent(uri): Promise<string> {
            const result =
              await client.sendRequest<RepositorySourceResult | null>(
                InterlisProtocol.repositorySource,
                { uri: uri.toString() },
              );
            if (!result)
              throw new Error(`Unknown repository model: ${uri.toString()}`);
            return result.text;
          },
        },
      ),
    );
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
      "interlisLanguageTools.docx.export",
      async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.languageId !== "interlis") return;
        if (isBlankInterlisDocument(document.getText())) {
          void vscode.window.showInformationMessage(
            "The INTERLIS file is empty. Add a model before exporting documentation.",
          );
          return;
        }
        try {
          const data = await client.sendRequest<number[]>(
            InterlisProtocol.exportDocx,
            { uri: document.uri.toString() } satisfies ExportDocxParams,
          );
          const bytes = Uint8Array.from(data);
          const siblingPath = document.uri.path.toLowerCase().endsWith(".ili")
            ? `${document.uri.path.slice(0, -4)}.docx`
            : `${document.uri.path}.docx`;
          let target =
            document.uri.scheme === "untitled"
              ? undefined
              : document.uri.with({ path: siblingPath });
          if (!target)
            target = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file("Model.docx"),
              filters: { "Word document": ["docx"] },
            });
          if (!target) return;
          try {
            await vscode.workspace.fs.writeFile(target, bytes);
          } catch {
            const fallback = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file("Model.docx"),
              filters: { "Word document": ["docx"] },
            });
            if (!fallback) return;
            target = fallback;
            await vscode.workspace.fs.writeFile(target, bytes);
          }
          void vscode.window.showInformationMessage(
            `Saved INTERLIS documentation to ${target.toString(true)}`,
          );
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Failed to export INTERLIS documentation: ${error instanceof Error ? error.message : String(error)}`,
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
