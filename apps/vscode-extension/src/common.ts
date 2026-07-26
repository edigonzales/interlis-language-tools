import * as vscode from "vscode";
import {
  DEFAULT_TEMPLATE_URL,
  fetchTemplate,
  isBlankInterlisDocument,
} from "@ilic/language-service";
import { InterlisProtocol } from "@ilic/language-server/protocol";
import type {
  CompileParams,
  CompilationCompletedParams,
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
import { replaceCompilationOutput } from "./compilation-output.js";

export interface LanguageClientFacade {
  sendRequest<R>(method: string, params: unknown): Promise<R>;
  sendNotification(method: string, params: unknown): Promise<void>;
  onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): vscode.Disposable;
}

interface OpenCompilationDocument {
  readonly languageId: string;
  readonly uri: {
    readonly scheme: string;
    toString(): string;
  };
}

function supportsOpenCompilation(
  document: OpenCompilationDocument | undefined,
): document is OpenCompilationDocument {
  return (
    document?.languageId === "interlis" &&
    document.uri.scheme !== "untitled" &&
    document.uri.scheme !== "interlis-repository"
  );
}

export async function compileOpenedDocument(
  client: LanguageClientFacade,
  document: OpenCompilationDocument,
  trigger: "open" | "startup" = "open",
): Promise<void> {
  if (!supportsOpenCompilation(document)) return;
  await client.sendRequest<CompilationResult>(InterlisProtocol.compile, {
    uri: document.uri.toString(),
    trigger,
  } satisfies CompileParams);
}

/** Compile the active INTERLIS editor once after the language client starts. */
export async function compileActiveDocumentOnStartup(
  client: LanguageClientFacade,
  document: OpenCompilationDocument | undefined = vscode.window.activeTextEditor
    ?.document,
): Promise<void> {
  if (!document) return;
  await compileOpenedDocument(client, document, "startup");
}

export function registerDocumentOpenCompilation(
  context: vscode.ExtensionContext,
  client: LanguageClientFacade,
  debug: Pick<vscode.OutputChannel, "appendLine">,
): void {
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void compileOpenedDocument(client, document).catch((error: unknown) => {
        debug.appendLine(
          `[${new Date().toISOString()}] open compilation request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }),
  );
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

export interface DocxExportProposal {
  readonly fileBased: boolean;
  readonly title: string;
  readonly defaultPath: string;
}

export function docxExportProposal(
  uri: Pick<vscode.Uri, "scheme" | "path">,
): DocxExportProposal {
  const fileBased = uri.scheme === "file";
  const filename = fileBased
    ? (uri.path.split("/").at(-1) ?? "Model.ili")
    : "Model.ili";
  return {
    fileBased,
    title: filename.toLowerCase().endsWith(".ili")
      ? filename
      : `${filename}.ili`,
    defaultPath: fileBased
      ? uri.path.toLowerCase().endsWith(".ili")
        ? `${uri.path.slice(0, -4)}.docx`
        : `${uri.path}.docx`
      : "Model.docx",
  };
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
        options: {
          tabSize: vscode.workspace
            .getConfiguration("editor", document.uri)
            .get<number>("tabSize", 2),
          insertSpaces: vscode.workspace
            .getConfiguration("editor", document.uri)
            .get<boolean>("insertSpaces", true),
        },
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

export async function exportDocxFromActiveDocument(
  client: LanguageClientFacade,
): Promise<void> {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== "interlis") return;
  if (isBlankInterlisDocument(document.getText())) {
    void vscode.window.showInformationMessage(
      "The INTERLIS file is empty. Add a model before exporting documentation.",
    );
    return;
  }
  try {
    const proposal = docxExportProposal(document.uri);
    const target = await vscode.window.showSaveDialog({
      defaultUri: proposal.fileBased
        ? document.uri.with({ path: proposal.defaultPath })
        : vscode.Uri.file(proposal.defaultPath),
      filters: { "Word document": ["docx"] },
      saveLabel: "Export INTERLIS documentation",
    });
    if (!target) return;
    const data = await client.sendRequest<number[]>(
      InterlisProtocol.exportDocx,
      {
        uri: document.uri.toString(),
        title: proposal.title,
      } satisfies ExportDocxParams,
    );
    await vscode.workspace.fs.writeFile(target, Uint8Array.from(data));
    void vscode.window.showInformationMessage(
      `Saved INTERLIS documentation to ${target.toString(true)}`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to export INTERLIS documentation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function registerClientWorkflows(
  context: vscode.ExtensionContext,
  client: LanguageClientFacade,
  output: vscode.OutputChannel,
  debug: vscode.OutputChannel,
  pending: Map<string, PendingSelection>,
): void {
  const compilationStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  compilationStatus.name = "INTERLIS compilation";
  compilationStatus.text = "$(circle-outline) INTERLIS: not compiled";
  compilationStatus.tooltip = "Save or compile the active INTERLIS document.";
  compilationStatus.show();
  context.subscriptions.push(
    output,
    debug,
    compilationStatus,
    client.onNotification(InterlisProtocol.log, (event) => {
      debug.appendLine(
        `[${new Date().toISOString()}] ${JSON.stringify(event)}`,
      );
    }),
    client.onNotification(InterlisProtocol.compilationCompleted, (params) => {
      const event = params as CompilationCompletedParams;
      replaceCompilationOutput(output, event);
      compilationStatus.text = event.compilation.success
        ? "$(check) INTERLIS: compiled"
        : `$(error) INTERLIS: ${event.compilation.errorCount} error(s)`;
      compilationStatus.tooltip = `Last compilation: ${event.timestamp}\n${event.rootUri}`;
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "interlis") {
        compilationStatus.text = "$(warning) INTERLIS: outdated";
        compilationStatus.tooltip = "Outdated – save or compile.";
      }
      scheduleJavaLikeSuggest(event);
      scheduleModelHeaderSuggestionSuppression(event.document);
      const key = event.document.uri.toString();
      const target = pending.get(key);
      if (!target || target.version !== event.document.version) return;
      const editor = vscode.window.visibleTextEditors.find(
        (candidate) => candidate.document.uri.toString() === key,
      );
      if (editor) editor.selection = target.selection;
      pending.delete(key);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (
        event.textEditor.document.languageId === "interlis" &&
        isModelSnippetHeaderPlaceholderPosition(
          event.textEditor.document,
          event.textEditor.selection.active,
        )
      )
        void hideSuggestWidgetTwice();
      scheduleSelectionJavaLikeSuggest(event);
    }),
    vscode.commands.registerCommand(
      "interlisLanguageTools.compile",
      async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.languageId !== "interlis") return;
        await client.sendRequest<CompilationResult>(InterlisProtocol.compile, {
          uri: document.uri.toString(),
        } satisfies CompileParams);
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
    vscode.commands.registerCommand("interlisLanguageTools.docx.export", () =>
      exportDocxFromActiveDocument(client),
    ),
    vscode.commands.registerCommand(
      "interlisLanguageTools.snippet.nextPlaceholder",
      async () => {
        const editor = vscode.window.activeTextEditor;
        const uri = editor?.document.uri.toString();
        await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
        if (!editor || editor.document.languageId !== "interlis" || !uri)
          return;
        setTimeout(() => {
          const active = vscode.window.activeTextEditor;
          if (
            !active ||
            active.document.uri.toString() !== uri ||
            isModelSnippetHeaderPlaceholderPosition(
              active.document,
              active.selection.active,
            )
          )
            return;
          if (
            isDeclarationRhsPlaceholder(
              active.document,
              active.selection.active,
            )
          )
            void probeAndRefreshSuggestions(active, "snippet-rhs");
        }, 25);
      },
    ),
    vscode.commands.registerCommand(
      "interlisLanguageTools.snippet.cursorMove",
      async (argument?: string | { command?: string }) => {
        const command =
          typeof argument === "string" ? argument : argument?.command;
        if (!command) return;
        const editor = vscode.window.activeTextEditor;
        if (
          editor?.document.languageId === "interlis" &&
          (isBlockSnippetHeaderPlaceholderPosition(
            editor.document,
            editor.selection.active,
          ) ||
            isModelSnippetHeaderPlaceholderPosition(
              editor.document,
              editor.selection.active,
            ))
        )
          await vscode.commands.executeCommand("leaveSnippet");
        await vscode.commands.executeCommand(command);
      },
    ),
  );

  if (fallbackSetting("autoShowOutputOnStart", "autoShowOutputOnStart", true))
    output.show(true);
}

const recentSuggestFingerprints = new Map<string, string>();
const recentSuggestEdits = new Map<
  string,
  {
    readonly version: number;
    readonly change: vscode.TextDocumentContentChangeEvent;
    readonly expiresAt: number;
  }
>();
const pendingSuggestTimers = new Map<string, ReturnType<typeof setTimeout>>();

function completionLabel(value: string | vscode.CompletionItemLabel): string {
  return typeof value === "string" ? value : value.label;
}

function isModelSnippetHeaderPlaceholderPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  if (position.line < 0 || position.line >= document.lineCount) return false;
  const line = document.lineAt(position.line).text;
  const model = line.match(/^(\s*MODEL\s+)/u);
  if (model) {
    const nameStart = model[1]?.length ?? 0;
    const languageStart = line.indexOf(" (", nameStart);
    const languageEnd =
      languageStart >= 0 ? line.indexOf(")", languageStart + 2) : -1;
    if (
      languageStart > nameStart &&
      position.character >= nameStart &&
      position.character <= languageStart
    )
      return true;
    if (
      languageEnd > languageStart &&
      position.character >= languageStart + 2 &&
      position.character <= languageEnd
    )
      return true;
  }
  for (const pattern of [/^\s*AT\s+"/u, /^\s*VERSION\s+"/u]) {
    const prefix = line.match(pattern);
    const start = prefix?.[0].length;
    const end = line.lastIndexOf('"');
    if (
      start !== undefined &&
      end > start &&
      position.character >= start &&
      position.character <= end
    )
      return true;
  }
  return false;
}

function isBlockSnippetHeaderPlaceholderPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  if (position.line < 0 || position.line >= document.lineCount) return false;
  const line = document.lineAt(position.line).text;
  const prefix = line.match(
    /^\s*(?:TOPIC|CLASS|STRUCTURE|ASSOCIATION|VIEW(?:\s+TOPIC)?|GRAPHIC)\s+/iu,
  );
  const equals = line.lastIndexOf("=");
  if (!prefix || equals < 0 || line.slice(equals + 1).trim()) return false;
  const nameStart = prefix[0].length;
  const afterName = line.indexOf(" ", nameStart);
  if (afterName < 0 || afterName > equals) return false;
  return (
    (position.character >= nameStart && position.character <= afterName) ||
    (position.character >= afterName + 1 && position.character <= equals)
  );
}

function isDeclarationRhsPlaceholder(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  if (position.line < 0 || position.line >= document.lineCount) return false;
  const line = document.lineAt(position.line).text;
  const prefix = line.slice(0, position.character);
  const suffix = line.slice(position.character);
  return (
    /^\s*(?:DOMAIN|UNIT)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+\([^)]*\))?\s*=\s*$/iu.test(
      prefix,
    ) && /^\s*;?\s*$/u.test(suffix)
  );
}

export function expectedSuggestionLabels(
  prefix: string,
  suffix = "",
): readonly string[] {
  if (/^\s*!!@/u.test(prefix)) return [];
  if (/^\s*IMPORTS\b/iu.test(prefix)) return [];
  if (/\bEXTENDS\s+[A-Za-z0-9_.]*$/iu.test(prefix)) return [];
  const fixedEquals = /^\s*=\s*;?\s*$/u.test(suffix);
  const afterName = prefix.match(
    /^\s*(CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]+\])?\s+([A-Za-z_]*)$/iu,
  );
  if (afterName?.[1]) {
    const kind = afterName[1].toUpperCase();
    const base =
      kind === "TOPIC"
        ? ["(ABSTRACT)", "(FINAL)", "EXTENDS"]
        : kind === "DOMAIN"
          ? ["(ABSTRACT)", "(FINAL)", "(GENERIC)", "EXTENDS"]
          : kind === "UNIT"
            ? [
                ...(prefix.includes("[") ? [] : ["[Name]"]),
                "(ABSTRACT)",
                "EXTENDS",
              ]
            : ["(ABSTRACT)", "(EXTENDED)", "(FINAL)", "EXTENDS"];
    return fixedEquals ? base : [...base, "="];
  }
  const modifier = prefix.match(
    /^\s*(CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]+\])?\s*\(\s*([A-Za-z_]*)$/iu,
  );
  if (modifier?.[1]) {
    const kind = modifier[1].toUpperCase();
    const typed = modifier[2]?.toUpperCase() ?? "";
    if (["ABSTRACT", "EXTENDED", "FINAL", "GENERIC"].includes(typed))
      return [")"];
    if (kind === "TOPIC") return ["ABSTRACT", "FINAL"];
    if (kind === "DOMAIN") return ["ABSTRACT", "FINAL", "GENERIC"];
    if (kind === "UNIT") return ["ABSTRACT"];
    return ["ABSTRACT", "EXTENDED", "FINAL"];
  }
  if (
    /^\s*(CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]+\])?\s*\(\s*(?:ABSTRACT|EXTENDED|FINAL|GENERIC)\s*\)\s+[A-Za-z_]*$/iu.test(
      prefix,
    )
  )
    return fixedEquals ? ["EXTENDS"] : ["EXTENDS", "="];
  if (/^\s*UNIT\b.*=\s*$/iu.test(prefix)) return ["[BaseUnit]"];
  if (/^\s*DOMAIN\b.*=\s*$/iu.test(prefix)) return ["TEXT", "NUMERIC"];
  if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*$/u.test(prefix))
    return ["TEXT", "MANDATORY"];
  if (/(?:TEXT|MTEXT)\s*$/iu.test(prefix)) return ["*"];
  return [];
}

export function isSuggestBoundary(
  change: vscode.TextDocumentContentChangeEvent,
  prefix: string,
  suffix: string,
): boolean {
  if (
    !change.text ||
    /[\r\n]/u.test(change.text) ||
    change.range.start.line !== change.range.end.line ||
    prefix.trim().length === 0
  )
    return false;
  if (suffix.trim() && !/^\s*[=;)]/u.test(suffix)) return false;
  const boundary = /[\s.:=[/*@)]$/u.test(change.text);
  const numericTail =
    /[0-9]$/u.test(change.text) &&
    /(?:^|:\s*|=\s*)[-+]?[0-9]+(?:\.[0-9]+)?$/u.test(prefix);
  const stagedHeader =
    /^\s*(?:CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]+\])?\s+\(?[A-Za-z_]*$/iu.test(
      prefix,
    ) ||
    /^\s*(?:CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]+\])?\s*\([^)]*\)\s+[A-Za-z_]*$/iu.test(
      prefix,
    );
  const metaOrDirected =
    /^\s*!!@/u.test(prefix) ||
    /^\s*IMPORTS\b/iu.test(prefix) ||
    /\bEXTENDS\s+[A-Za-z0-9_.]*$/iu.test(prefix);
  const providerExpected = expectedSuggestionLabels(prefix, suffix).length > 0;
  if (
    !boundary &&
    !numericTail &&
    !stagedHeader &&
    !metaOrDirected &&
    !providerExpected
  )
    return false;
  return (
    metaOrDirected ||
    /^\s*(?:CLASS|STRUCTURE|TOPIC|DOMAIN|UNIT)\b/iu.test(prefix) ||
    /^\s*[A-Za-z_][A-Za-z0-9_]*\s*:/u.test(prefix)
  );
}

export function suggestionRetriggerPlan(
  change: vscode.TextDocumentContentChangeEvent,
  prefix: string,
  suffix: string,
): {
  readonly eligible: boolean;
  readonly retry: boolean;
  readonly expectedLabels: readonly string[];
} {
  return {
    eligible: isSuggestBoundary(change, prefix, suffix),
    retry: change.text.length > 1 || (change.rangeLength ?? 0) > 0,
    expectedLabels: expectedSuggestionLabels(prefix, suffix),
  };
}

async function probeAndRefreshSuggestions(
  editor: vscode.TextEditor,
  reason: string,
): Promise<void> {
  if (
    editor.selections.length !== 1 ||
    !editor.selection.isEmpty ||
    isModelSnippetHeaderPlaceholderPosition(
      editor.document,
      editor.selection.active,
    )
  )
    return;
  const position = editor.selection.active;
  const fingerprint = `${editor.document.version}:${position.line}:${position.character}:${reason}`;
  const key = editor.document.uri.toString();
  if (recentSuggestFingerprints.get(key) === fingerprint) return;
  const completions = await vscode.commands.executeCommand<
    vscode.CompletionList | vscode.CompletionItem[]
  >("vscode.executeCompletionItemProvider", editor.document.uri, position);
  const items = Array.isArray(completions)
    ? completions
    : (completions?.items ?? []);
  const line = editor.document.lineAt(position.line).text;
  const expected = expectedSuggestionLabels(
    line.slice(0, position.character),
    line.slice(position.character),
  );
  const labels = new Set(
    items.map((item) => completionLabel(item.label).toUpperCase()),
  );
  if (
    items.length === 0 ||
    (expected.length > 0 &&
      !expected.every((label) => labels.has(label.toUpperCase())))
  )
    return;
  recentSuggestFingerprints.set(key, fingerprint);
  await vscode.commands.executeCommand("hideSuggestWidget");
  await Promise.resolve();
  await vscode.commands.executeCommand("editor.action.triggerSuggest");
}

function scheduleJavaLikeSuggest(event: vscode.TextDocumentChangeEvent): void {
  if (
    event.document.languageId !== "interlis" ||
    event.contentChanges.length !== 1
  )
    return;
  const change = event.contentChanges[0]!;
  const key = event.document.uri.toString();
  recentSuggestEdits.set(key, {
    version: event.document.version,
    change,
    expiresAt: Date.now() + 250,
  });
  setTimeout(() => {
    if (recentSuggestEdits.get(key)?.version === event.document.version)
      recentSuggestEdits.delete(key);
  }, 250);
  const existing = pendingSuggestTimers.get(key);
  if (existing) clearTimeout(existing);
  const probe = (reason: string): void => {
    const active = vscode.window.activeTextEditor;
    if (
      !active ||
      active.document.uri.toString() !== key ||
      active.document.version !== event.document.version ||
      !active.selection.isEmpty
    )
      return;
    const line = active.document.lineAt(active.selection.active.line).text;
    const prefix = line.slice(0, active.selection.active.character);
    const suffix = line.slice(active.selection.active.character);
    if (isSuggestBoundary(change, prefix, suffix))
      void probeAndRefreshSuggestions(active, reason);
  };
  const timer = setTimeout(() => {
    probe("java-like");
    if (change.text.length <= 1 && (change.rangeLength ?? 0) === 0) {
      pendingSuggestTimers.delete(key);
      return;
    }
    const retry = setTimeout(() => {
      pendingSuggestTimers.delete(key);
      probe("java-like");
    }, 100);
    pendingSuggestTimers.set(key, retry);
  }, 25);
  pendingSuggestTimers.set(key, timer);
}

function scheduleSelectionJavaLikeSuggest(
  event: vscode.TextEditorSelectionChangeEvent,
): void {
  if (
    event.textEditor.document.languageId !== "interlis" ||
    event.selections.length !== 1 ||
    !event.selections[0]?.isEmpty
  )
    return;
  const key = event.textEditor.document.uri.toString();
  const recent = recentSuggestEdits.get(key);
  if (
    !recent ||
    recent.version !== event.textEditor.document.version ||
    recent.expiresAt < Date.now()
  ) {
    recentSuggestEdits.delete(key);
    return;
  }
  setTimeout(() => {
    const active = vscode.window.activeTextEditor;
    if (
      !active ||
      active.document.uri.toString() !== key ||
      active.document.version !== recent.version ||
      !active.selection.isEmpty
    )
      return;
    const line = active.document.lineAt(active.selection.active.line).text;
    const prefix = line.slice(0, active.selection.active.character);
    const suffix = line.slice(active.selection.active.character);
    if (isSuggestBoundary(recent.change, prefix, suffix))
      void probeAndRefreshSuggestions(active, "java-like");
  }, 25);
}

async function hideSuggestWidgetTwice(): Promise<void> {
  await vscode.commands.executeCommand("hideSuggestWidget");
  setTimeout(() => void vscode.commands.executeCommand("hideSuggestWidget"), 0);
}

function scheduleModelHeaderSuggestionSuppression(
  document: vscode.TextDocument,
): void {
  setTimeout(() => {
    const editor = vscode.window.activeTextEditor;
    if (
      editor?.document.uri.toString() === document.uri.toString() &&
      editor.document.version === document.version &&
      isModelSnippetHeaderPlaceholderPosition(
        editor.document,
        editor.selection.active,
      )
    )
      void hideSuggestWidgetTwice();
  }, 0);
}

export function hasActiveLegacyExtension(): boolean {
  return (
    vscode.extensions.getExtension("edigonzales.interlis-editor")?.isActive ===
    true
  );
}
