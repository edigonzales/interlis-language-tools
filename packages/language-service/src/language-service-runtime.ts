import type {
  CompilationAnalysisResult,
  CompilationResult,
  Diagnostic,
  EditorSnapshot,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import {
  completionContextAt,
  documentSymbols,
  locationsForDefinition,
  locationsForReferences,
  renameSymbol,
  symbolAt,
  syntaxDocumentSymbols,
  templateForNewline,
  toEditorRange,
} from "./features.js";
import { completionAt } from "./completion.js";
import type {
  CompletionItem,
  CodeAction,
  DocumentSymbol,
  EditorFormattingOptions,
  EditorPosition,
  EditorRange,
  HoverResult,
  Location,
  RenameResult,
  TemplateEdit,
  TextEdit,
} from "./features.js";
import {
  analyzeLiveDocument,
  editorOccurrences,
  editorTargetAt,
} from "./live-analysis.js";
import type { LiveQuickFix } from "./live-analysis.js";
import type { CompletionContext } from "./completion.js";
import type {
  ModelCatalogEntry,
  ModelRepository,
  RepositorySchemaLanguage,
  ResolvedRepositoryModel,
} from "./repository.js";
import type {
  AnalysisEvent,
  CompilationEvent,
  CompilationTrigger,
  CompilerBackend,
  DiagnosticsChangedEvent,
  EditorAnalysisBackend,
  LanguageServiceOptions,
  LiveAnalysisStatus,
  OpenDocument,
  VersionedResult,
  WorkspaceSource,
} from "./types.js";
import { deduplicateDiagnostics } from "./diagnostics/diagnostic-fingerprint.js";
import { DiagnosticStore } from "./diagnostics/diagnostic-store.js";
import { DiagnosticVersionGate } from "./diagnostics/diagnostic-version-gate.js";
import { LanguageServiceEventHub } from "./events/language-service-event-hub.js";
import { SourceRegistry, type EffectiveSource } from "./source/source-registry.js";
import { DiagnosticCoordinator } from "./diagnostics/diagnostic-coordinator.js";
import { DependencyIndex } from "./semantic/dependency-index.js";
import { SemanticSnapshotStore } from "./semantic/semantic-snapshot-store.js";
import { CompilationRunCoordinator } from "./compilation/compilation-run-coordinator.js";
import { RepositoryModelController } from "./repository/repository-model-controller.js";
import { CompilationScheduler, type ScheduledCompilation } from "./compilation/compilation-scheduler.js";

interface StoredSource {
  readonly text: string | Uint8Array;
  readonly version: number;
}

interface SavedLintResult {
  readonly documentVersion: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly fixes: readonly LiveQuickFix[];
}

export class LanguageServiceRuntime {
  readonly #sources = new SourceRegistry();
  readonly #diagnosticCoordinator = new DiagnosticCoordinator();
  readonly #semanticSnapshotStore = new SemanticSnapshotStore();
  readonly #dependencyIndex = new DependencyIndex();
  readonly #runCoordinator = new CompilationRunCoordinator();
  readonly #repositoryController: RepositoryModelController;
  // Transitional aliases are replaced by the controllers below as each
  // behavior lock moves. They are intentionally private to the runtime.
  readonly #documents = new Map<string, OpenDocument>();
  readonly #workspaceSources = new Map<string, StoredSource>();
  readonly #repositorySources = new Map<string, ResolvedRepositoryModel>();
  readonly #repositorySourceVersions = new Map<string, number>();
  readonly #effectiveSources = new Map<string, EffectiveSource>();
  readonly #removedSourceUris = new Set<string>();
  readonly #readOnlyUris = new Set<string>();
  readonly #syntax = new Map<string, VersionedResult<SyntaxSnapshot>>();
  readonly #diagnostics = new Map<string, Diagnostic[]>();
  readonly #diagnosticsByRoot = new Map<string, Map<string, Diagnostic[]>>();
  readonly #diagnosticStore = new DiagnosticStore();
  readonly #diagnosticVersionGate = new DiagnosticVersionGate();
  readonly #liveDiagnostics = new Map<string, Diagnostic[]>();
  readonly #liveFixes = new Map<string, readonly LiveQuickFix[]>();
  readonly #savedLint = new Map<string, SavedLintResult>();
  readonly #editorSnapshots = new Map<
    string,
    VersionedResult<EditorSnapshot>
  >();
  readonly #liveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #onDemandEditorAnalysis = new Map<
    string,
    {
      readonly version: number;
      readonly promise: Promise<EditorSnapshot | null>;
    }
  >();
  readonly #liveRequests = new Map<string, number>();
  readonly #liveStatuses = new Map<string, LiveAnalysisStatus>();
  readonly #events = new LanguageServiceEventHub();
  readonly #reverseDependencies = new Map<string, Set<string>>();
  readonly #onError?: (error: unknown) => void;
  readonly #editorAnalysis?: EditorAnalysisBackend;
  #liveDiagnosticsMode: "off" | "conservative";
  readonly #liveDiagnosticsDelayMs: number;
  readonly #editorAnalysisTimeoutMs: number;
  #modelRepository?: ModelRepository;
  #catalog: readonly ModelCatalogEntry[] | null = null;
  #catalogPromise: Promise<readonly ModelCatalogEntry[]> | null = null;
  #lastSemantic: VersionedResult<SemanticSnapshot> | null = null;
  #lastGoodSemantic: VersionedResult<SemanticSnapshot> | null = null;
  #lastSavedSemantic: VersionedResult<SemanticSnapshot> | null = null;
  #lastSemanticRoot: string | null = null;
  readonly #semanticByRoot = new Map<
    string,
    VersionedResult<SemanticSnapshot>
  >();
  readonly #lastGoodSemanticByRoot = new Map<
    string,
    VersionedResult<SemanticSnapshot>
  >();
  readonly #savedSemanticByRoot = new Map<
    string,
    VersionedResult<SemanticSnapshot>
  >();
  readonly #scheduler = new CompilationScheduler(
    (request, runId) => {
      return this.#runCompilation(
        request.rootUri,
        request.trigger,
        runId,
        request.compilationEpoch,
        request.requestedDocumentVersion,
        request.requestedSourceVersion,
      );
    },
    (request, runId) => this.#cancelledCompilation({ ...request, runId }),
  );
  readonly #stickyOutlines = new Map<string, DocumentSymbol[]>();
  #compilationEpoch = 0;
  #generation = 0;
  #sourceRevision = 1;
  #disposed = false;

  constructor(
    readonly compiler: CompilerBackend,
    options: LanguageServiceOptions = {},
  ) {
    this.#diagnosticVersionGate.beginEpoch(this.#generation);
    this.#diagnosticCoordinator.beginEpoch(this.#generation);
    if (options.onAnalysis) this.#events.onAnalysis(options.onAnalysis);
    if (options.onCompilation) this.#events.onCompilation(options.onCompilation);
    this.#onError = options.onError;
    this.#modelRepository = options.modelRepository;
    this.#repositoryController = new RepositoryModelController(options.modelRepository);
    this.#editorAnalysis = options.editorAnalysis;
    this.#liveDiagnosticsMode = options.liveDiagnostics ?? "conservative";
    this.#liveDiagnosticsDelayMs = Math.max(
      0,
      options.liveDiagnosticsDelayMs ?? 250,
    );
    this.#editorAnalysisTimeoutMs = Math.max(
      0,
      options.editorAnalysisTimeoutMs ?? 1_500,
    );
  }

  get generation(): number {
    return this.#generation;
  }
  get documents(): readonly OpenDocument[] {
    return [...this.#documents.values()];
  }
  get lastSemanticSnapshot(): VersionedResult<SemanticSnapshot> | null {
    return this.#lastSemantic;
  }

  onAnalysis(listener: (event: AnalysisEvent) => void): { dispose(): void } {
    return this.#events.onAnalysis(listener);
  }

  onCompilation(listener: (event: CompilationEvent) => void): {
    dispose(): void;
  } {
    return this.#events.onCompilation(listener);
  }

  onDiagnosticsChanged(listener: (event: DiagnosticsChangedEvent) => void): {
    dispose(): void;
  } {
    return this.#events.onDiagnostics(listener);
  }

  liveAnalysisStatus(uri: string): LiveAnalysisStatus {
    if (!this.#editorAnalysis || this.#liveDiagnosticsMode === "off")
      return "off";
    return this.#liveStatuses.get(uri) ?? "scheduled";
  }

  configureLiveDiagnostics(mode: "off" | "conservative"): void {
    if (this.#liveDiagnosticsMode === mode) return;
    this.#liveDiagnosticsMode = mode;
    for (const document of this.#documents.values()) {
      if (mode === "off") {
        const timer = this.#liveTimers.get(document.uri);
        if (timer) clearTimeout(timer);
        this.#liveTimers.delete(document.uri);
        this.#liveRequests.set(
          document.uri,
          (this.#liveRequests.get(document.uri) ?? 0) + 1,
        );
        this.#liveStatuses.delete(document.uri);
        this.#liveDiagnostics.delete(document.uri);
        this.#diagnosticStore.remove(document.uri, "live");
        this.#liveFixes.delete(document.uri);
        this.#savedLint.delete(document.uri);
        this.#diagnosticStore.remove(document.uri, "saved");
        this.#emitDiagnosticsChanged(document.uri, document.version, "off");
      } else {
        this.#scheduleEditorAnalysis(document.uri, document.version);
      }
    }
  }

  openDocument(
    uri: string,
    text: string,
    version: number,
  ): VersionedResult<SyntaxSnapshot> {
    return this.#setDocument(uri, text, version, false);
  }

  changeDocument(
    uri: string,
    text: string,
    version: number,
  ): VersionedResult<SyntaxSnapshot> {
    if (this.isReadOnlyUri(uri))
      throw new Error(`Repository document is read-only: ${uri}`);
    return this.#setDocument(uri, text, version, true);
  }

  markSaved(uri: string): void {
    const document = this.#documents.get(uri);
    if (!document) return;
    this.#sources.markSaved(uri);
    this.#documents.set(uri, { ...document, dirty: false });
    if (this.#liveDiagnosticsMode !== "off") {
      const snapshot = this.getEditorSnapshot(uri)?.value;
      if (snapshot?.documentVersion === document.version)
        this.#updateSavedLint(uri, snapshot);
    }
    this.#liveDiagnostics.delete(uri);
    this.#diagnosticStore.remove(uri, "live");
    this.#liveFixes.delete(uri);
    this.#emitDiagnosticsChanged(uri, document.version, "ready");
    if (!this.isReadOnlyUri(uri))
      this.#workspaceSources.set(uri, {
        text: document.text,
        version: document.version,
      });
  }

  closeDocument(uri: string): void {
    this.#assertActive();
    this.#sources.closeDocument(uri);
    const previous = this.#documents.get(uri);
    this.#documents.delete(uri);
    const timer = this.#liveTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.#liveTimers.delete(uri);
    this.#liveRequests.delete(uri);
    this.#onDemandEditorAnalysis.delete(uri);
    this.#liveStatuses.delete(uri);
    this.#editorSnapshots.delete(uri);
    this.#liveDiagnostics.delete(uri);
    this.#liveFixes.delete(uri);
    this.#savedLint.delete(uri);
    this.#diagnosticStore.remove(uri, "saved");
    this.#refreshEffectiveSource(uri);
    if (!this.#repositorySources.has(uri)) this.#readOnlyUris.delete(uri);
    this.#emitDiagnosticsChanged(uri, previous?.version ?? null, "off");
  }

  replaceWorkspaceSources(sources: readonly WorkspaceSource[]): void {
    this.#assertActive();
    this.#sources.replaceWorkspaceSources(sources);
    const incoming = new Set(sources.map((source) => source.uri));
    const changed = new Set<string>();
    for (const uri of this.#workspaceSources.keys()) {
      if (incoming.has(uri)) continue;
      this.#workspaceSources.delete(uri);
      changed.add(uri);
    }
    for (const source of sources) {
      this.#workspaceSources.set(source.uri, {
        text: source.text,
        version: source.version ?? ++this.#sourceRevision,
      });
      changed.add(source.uri);
    }
    for (const uri of changed)
      if (!this.#documents.has(uri)) this.#refreshEffectiveSource(uri, true);
  }

  putWorkspaceSource(uri: string, text: string, version?: number): void {
    this.#assertActive();
    this.#sources.putWorkspaceSource(uri, text, version);
    this.#workspaceSources.set(uri, {
      text,
      version: version ?? ++this.#sourceRevision,
    });
    if (this.#documents.has(uri)) return;
    this.#refreshEffectiveSource(uri, true);
  }

  removeWorkspaceSource(uri: string): void {
    this.#assertActive();
    this.#sources.removeWorkspaceSource(uri);
    if (!this.#workspaceSources.delete(uri)) return;
    if (this.#documents.has(uri)) return;
    this.#refreshEffectiveSource(uri, true);
  }

  async setModelRepository(repository?: ModelRepository): Promise<void> {
    this.#assertActive();
    this.#modelRepository = repository;
    await this.#repositoryController.setRepository(repository);
    this.#sources.clearRepositorySources();
    this.#catalog = null;
    this.#catalogPromise = null;
    const uris = [...this.#repositorySources.keys()];
    this.#repositorySources.clear();
    this.#repositorySourceVersions.clear();
    for (const uri of uris) {
      this.#refreshEffectiveSource(uri);
      if (!this.#documents.has(uri)) this.#readOnlyUris.delete(uri);
    }
    this.#invalidateAll();
  }

  async refreshModelCatalog(): Promise<readonly ModelCatalogEntry[]> {
    if (!this.#modelRepository) return [];
    if (this.#catalogPromise) return this.#catalogPromise;
    this.#catalogPromise = this.#repositoryController
      .listModels()
      .then((catalog) => { this.#catalog = catalog; return catalog; })
      .finally(() => {
        this.#catalogPromise = null;
      });
    return this.#catalogPromise;
  }

  getRepositoryDocument(uri: string): ResolvedRepositoryModel | undefined {
    return this.#repositorySources.get(uri);
  }

  prepareRepositoryDocument(
    uri: string,
  ): VersionedResult<SyntaxSnapshot> | null {
    if (!this.#repositorySources.has(uri)) return null;
    return this.#syntax.get(uri) ?? this.#parseSource(uri);
  }

  isReadOnlyUri(uri: string): boolean {
    return this.#readOnlyUris.has(uri);
  }

  getDocument(uri: string): OpenDocument | undefined {
    return this.#documents.get(uri);
  }
  getSyntaxSnapshot(uri: string): VersionedResult<SyntaxSnapshot> | null {
    const effective = this.#effectiveSources.get(uri);
    if (!effective) return null;
    const result = this.#syntax.get(uri);
    if (
      result?.freshness === "fresh" &&
      result.value?.documentVersion === effective.version
    )
      return result;
    const parsed = this.#parseSource(uri);
    return parsed.value ? parsed : null;
  }

  diagnostics(uri: string): Diagnostic[] {
    const document = this.#documents.get(uri);
    const live = this.#editorSnapshots.get(uri);
    if (
      document?.dirty &&
      live?.value?.documentVersion === document.version &&
      this.#liveDiagnosticsMode !== "off"
    )
      return [...(this.#liveDiagnostics.get(uri) ?? [])];
    const compilerDiagnostics = this.#diagnostics.get(uri) ?? [];
    const savedLint = this.#savedLint.get(uri);
    if (
      document &&
      !document.dirty &&
      this.#liveDiagnosticsMode !== "off" &&
      savedLint?.documentVersion === document.version
    )
      return this.#mergeDiagnostics(compilerDiagnostics, savedLint.diagnostics);
    return [...compilerDiagnostics];
  }

  codeActions(
    uri: string,
    requestedRange: EditorRange,
    diagnosticCodes: readonly string[] = [],
  ): CodeAction[] {
    const accepted = new Set(diagnosticCodes);
    const document = this.#documents.get(uri);
    const fixes =
      document && !document.dirty
        ? this.#savedLint.get(uri)?.documentVersion === document.version
          ? (this.#savedLint.get(uri)?.fixes ?? [])
          : []
        : (this.#liveFixes.get(uri) ?? []);
    return fixes
      .filter(
        (fix) =>
          (accepted.size === 0 || accepted.has(fix.diagnosticCode)) &&
          this.#editorRangesOverlap(fix.diagnosticRange, requestedRange),
      )
      .map((fix) => ({
        title: fix.title,
        kind: "quickfix" as const,
        diagnostics: [fix.diagnosticCode],
        edit: { changes: fix.edits },
      }));
  }

  getEditorSnapshot(uri: string): VersionedResult<EditorSnapshot> | null {
    const result = this.#editorSnapshots.get(uri);
    const effective = this.#effectiveSources.get(uri);
    return result?.value?.documentVersion === effective?.version
      ? (result ?? null)
      : null;
  }

  async completion(
    uri: string,
    position: EditorPosition,
  ): Promise<CompletionItem[]> {
    const editor = await this.#ensureEditorSnapshot(uri);
    const text = this.#effectiveSources.get(uri)?.text ?? "";
    const syntax =
      (editor ? this.#syntaxFromEditor(editor) : null) ??
      (this.#editorAnalysis
        ? this.#syntaxForText(uri, text)
        : this.getSyntaxSnapshot(uri)?.value);
    if (!syntax) return [];
    const evaluation = completionAt(
      syntax,
      text,
      this.#completionSemanticForDocument(uri)?.value ??
        this.#workspaceCompletionSemantic(syntax),
      position,
    );
    const context = evaluation.context;
    const base = evaluation.items;
    if (syntax.iliVersion === "1.0" || context?.slot !== "import-model")
      return base;

    let catalog = this.#catalog ?? [];
    if (this.#modelRepository) {
      try {
        catalog = await this.refreshModelCatalog();
      } catch (error) {
        this.#onError?.(error);
      }
    }
    const schema = this.#schemaLanguage(syntax);
    const imported = new Set(syntax.imports);
    const entries = new Map<string, CompletionItem>();
    for (const name of this.#localModelNames(schema)) {
      if (!imported.has(name))
        entries.set(name, {
          label: name,
          kind: "module",
          detail: "Workspace model",
          insertText: name,
          insertTextFormat: "plain",
          insertTextMode: "adjust-indentation",
          filterText: name,
          sortText: `10-${name}`,
          textEdit: { range: context.replaceRange, newText: name },
        });
    }
    for (const model of catalog) {
      if (
        model.schemaLanguage !== schema ||
        model.browseOnly ||
        imported.has(model.name) ||
        entries.has(model.name)
      )
        continue;
      entries.set(model.name, {
        label: model.name,
        kind: "module",
        detail: `${model.version || "unversioned"} — ${model.repository}`,
        insertText: model.name,
        insertTextFormat: "plain",
        insertTextMode: "adjust-indentation",
        filterText: model.name,
        sortText: `20-${model.name}`,
        textEdit: { range: context.replaceRange, newText: model.name },
      });
    }
    return this.#deduplicate([...base, ...entries.values()]);
  }

  completionContext(
    uri: string,
    position: EditorPosition,
  ): CompletionContext | null {
    const editor = this.getEditorSnapshot(uri)?.value;
    const text = this.#effectiveSources.get(uri)?.text;
    const syntax =
      (editor ? this.#syntaxFromEditor(editor) : null) ??
      (text !== undefined ? this.#syntaxForText(uri, text) : null);
    return syntax && text !== undefined
      ? completionContextAt(syntax, text, position)
      : null;
  }

  definition(uri: string, position: EditorPosition): Location[] {
    const editor = this.getEditorSnapshot(uri)?.value;
    const semantic = this.#completionSemanticForDocument(uri)?.value ?? null;
    if (this.#documents.get(uri)?.dirty && editor) {
      const target = editorTargetAt(
        editor,
        position,
        semantic,
        this.#currentEditorDeclarations(),
      );
      if (target?.kind === "editor")
        return [
          {
            uri: target.declaration.selectionRange.uri,
            range: toEditorRange(target.declaration.selectionRange),
          },
        ];
      const range =
        target?.kind === "semantic"
          ? (target.symbol.selectionRange ?? target.symbol.range)
          : null;
      return range ? [{ uri: range.uri, range: toEditorRange(range) }] : [];
    }
    if (!this.#hasFreshSemanticFor(uri)) return [];
    const currentSemantic = this.#semanticForDocument(uri)?.value;
    return currentSemantic
      ? locationsForDefinition(currentSemantic, uri, position)
      : [];
  }

  references(
    uri: string,
    position: EditorPosition,
    includeDeclaration = true,
  ): Location[] {
    const editor = this.getEditorSnapshot(uri)?.value;
    const semantic = this.#completionSemanticForDocument(uri)?.value ?? null;
    if (this.#documents.get(uri)?.dirty && editor) {
      const snapshots = this.#currentEditorSnapshots();
      const declarations = snapshots.flatMap(
        (snapshot) => snapshot.declarations,
      );
      const target = editorTargetAt(editor, position, semantic, declarations);
      if (target?.kind === "semantic") {
        return semantic
          ? locationsForReferences(
              semantic,
              target.symbol.id,
              includeDeclaration,
            )
          : [];
      }
      if (target?.kind !== "editor") return [];
      const result: Location[] = [];
      for (const snapshot of snapshots) {
        for (const range of editorOccurrences(
          snapshot,
          target.declaration,
          semantic,
          declarations,
        ))
          if (
            includeDeclaration ||
            range.start.byteOffset !==
              target.declaration.selectionRange.start.byteOffset ||
            range.uri !== target.declaration.selectionRange.uri
          )
            result.push({ uri: range.uri, range: toEditorRange(range) });
      }
      return this.#deduplicateLocations(result);
    }
    if (!this.#hasFreshSemanticFor(uri)) return [];
    const currentSemantic = this.#semanticForDocument(uri)?.value;
    if (!currentSemantic) return [];
    const symbol = symbolAt(currentSemantic, uri, position);
    return symbol
      ? locationsForReferences(currentSemantic, symbol.id, includeDeclaration)
      : [];
  }

  renameRejectionReason(
    uri: string,
    position: EditorPosition,
    newName?: string,
  ): string | null {
    if (this.isReadOnlyUri(uri))
      return "Repository models are read-only and cannot be renamed.";
    if (newName !== undefined && !/^[_A-Za-z][_A-Za-z0-9]*$/.test(newName))
      return "The new INTERLIS name is not a valid identifier.";

    const document = this.#documents.get(uri);
    if (document?.dirty) {
      const editor = this.getEditorSnapshot(uri)?.value;
      if (!editor)
        return this.liveAnalysisStatus(uri) === "unavailable"
          ? "Live INTERLIS analysis is unavailable. Save the document and try Rename again."
          : "Live INTERLIS analysis is still running. Wait for it to finish and try Rename again.";
      const snapshots = this.#currentEditorSnapshots();
      const declarations = snapshots.flatMap(
        (snapshot) => snapshot.declarations,
      );
      const semantic = this.#completionSemanticForDocument(uri)?.value ?? null;
      const target = editorTargetAt(editor, position, semantic, declarations);
      if (target?.kind !== "editor")
        return target?.kind === "semantic"
          ? "The target comes from the last compiled external model and cannot be renamed from this dirty document."
          : "Rename requires one unambiguous INTERLIS declaration at the cursor.";
      if (this.isReadOnlyUri(target.declaration.selectionRange.uri))
        return "Repository models are read-only and cannot be renamed.";
      if (
        [...this.#documents.values()].some(
          (candidate) =>
            candidate.dirty &&
            this.getEditorSnapshot(candidate.uri)?.value?.documentVersion !==
              candidate.version,
        )
      )
        return "At least one affected editor snapshot is still pending. Wait for live analysis and try Rename again.";
      if (
        newName !== undefined &&
        declarations.some(
          (declaration) =>
            declaration.id !== target.declaration.id &&
            declaration.selectionRange.uri ===
              target.declaration.selectionRange.uri &&
            declaration.containerId === target.declaration.containerId &&
            declaration.name.toUpperCase() === newName.toUpperCase(),
        )
      )
        return `A declaration named '${newName}' already exists in this container.`;

      const semanticTarget = semantic?.symbols.find(
        (symbol) =>
          symbol.qualifiedName.toUpperCase() ===
          target.declaration.qualifiedName.toUpperCase(),
      );
      if (semantic && semanticTarget && newName !== undefined) {
        const currentUris = new Set(snapshots.map((snapshot) => snapshot.uri));
        const stable = renameSymbol(semantic, semanticTarget.id, newName);
        if (
          Object.keys(stable.changes).some(
            (resource) =>
              !this.isReadOnlyUri(resource) && !currentUris.has(resource),
          )
        )
          return "Rename would affect an editable file without a current editor snapshot. Open or save the affected files and try again.";
      }
      return null;
    }

    if (!this.#hasFreshSemanticFor(uri))
      return "No current compiled INTERLIS model is available. Save or compile the document and try Rename again.";
    const semantic = this.#semanticForDocument(uri)?.value;
    const symbol = semantic ? symbolAt(semantic, uri, position) : undefined;
    const declaration = symbol?.selectionRange ?? symbol?.range;
    if (!semantic || !symbol || !declaration)
      return "No unambiguous INTERLIS symbol is available at the cursor.";
    if (this.isReadOnlyUri(declaration.uri))
      return "Repository models are read-only and cannot be renamed.";
    if (
      newName !== undefined &&
      semantic.symbols.some(
        (candidate) =>
          candidate.id !== symbol.id &&
          candidate.containerId === symbol.containerId &&
          candidate.name.toUpperCase() === newName.toUpperCase(),
      )
    )
      return `A declaration named '${newName}' already exists in this container.`;
    return null;
  }

  prepareRename(
    uri: string,
    position: EditorPosition,
  ): { range: TextEdit["range"]; placeholder: string } | null {
    if (this.renameRejectionReason(uri, position)) return null;
    const editor = this.getEditorSnapshot(uri)?.value;
    const semantic = this.#completionSemanticForDocument(uri)?.value ?? null;
    if (this.#documents.get(uri)?.dirty && editor) {
      const declarations = this.#currentEditorDeclarations();
      const target = editorTargetAt(editor, position, semantic, declarations);
      if (target?.kind !== "editor") return null;
      const occurrence = editorOccurrences(
        editor,
        target.declaration,
        semantic,
        declarations,
      ).find((range) => this.#contains(range, position));
      return {
        range: toEditorRange(occurrence ?? target.declaration.selectionRange),
        placeholder: target.declaration.name,
      };
    }
    if (!this.#hasFreshSemanticFor(uri)) return null;
    const currentSemantic = this.#semanticForDocument(uri)?.value;
    const symbol = currentSemantic
      ? symbolAt(currentSemantic, uri, position)
      : undefined;
    const declaration = symbol?.selectionRange ?? symbol?.range;
    if (!symbol || !declaration || this.isReadOnlyUri(declaration.uri))
      return null;
    const occurrence = [
      symbol.selectionRange,
      symbol.endRange,
      ...(currentSemantic?.references
        .filter((reference) => reference.targetId === symbol.id)
        .map((reference) => reference.range) ?? []),
    ].find((range) => range?.uri === uri && this.#contains(range, position));
    return {
      range: toEditorRange(occurrence ?? declaration),
      placeholder: symbol.name,
    };
  }

  rename(
    uri: string,
    position: EditorPosition,
    newName: string,
  ): RenameResult | null {
    if (this.renameRejectionReason(uri, position, newName)) return null;
    const editor = this.getEditorSnapshot(uri)?.value;
    const fallbackSemantic =
      this.#completionSemanticForDocument(uri)?.value ?? null;
    if (this.#documents.get(uri)?.dirty && editor) {
      if (!/^[_A-Za-z][_A-Za-z0-9]*$/.test(newName)) return null;
      const snapshots = this.#currentEditorSnapshots();
      const declarations = snapshots.flatMap(
        (snapshot) => snapshot.declarations,
      );
      const target = editorTargetAt(
        editor,
        position,
        fallbackSemantic,
        declarations,
      );
      if (target?.kind !== "editor") return null;
      if (
        [...this.#documents.values()].some(
          (document) =>
            document.dirty &&
            this.getEditorSnapshot(document.uri)?.value?.documentVersion !==
              document.version,
        )
      )
        return null;
      if (
        declarations.some(
          (declaration) =>
            declaration.id !== target.declaration.id &&
            declaration.selectionRange.uri ===
              target.declaration.selectionRange.uri &&
            declaration.containerId === target.declaration.containerId &&
            declaration.name.toUpperCase() === newName.toUpperCase(),
        )
      )
        return null;

      const changes: Record<string, TextEdit[]> = {};
      const semanticTarget = fallbackSemantic?.symbols.find(
        (symbol) =>
          symbol.qualifiedName.toUpperCase() ===
          target.declaration.qualifiedName.toUpperCase(),
      );
      if (fallbackSemantic && semanticTarget) {
        const stable = renameSymbol(
          fallbackSemantic,
          semanticTarget.id,
          newName,
        );
        const currentUris = new Set(snapshots.map((snapshot) => snapshot.uri));
        if (
          Object.keys(stable.changes).some(
            (resource) =>
              !this.isReadOnlyUri(resource) && !currentUris.has(resource),
          )
        )
          return null;
        for (const [resource, edits] of Object.entries(stable.changes))
          if (!this.isReadOnlyUri(resource)) changes[resource] = [...edits];
      }
      for (const snapshot of snapshots) {
        const occurrences = editorOccurrences(
          snapshot,
          target.declaration,
          fallbackSemantic,
          declarations,
        );
        if (occurrences.length === 0 || this.isReadOnlyUri(snapshot.uri))
          continue;
        changes[snapshot.uri] = [
          ...(changes[snapshot.uri] ?? []).filter(
            (edit) =>
              !occurrences.some((range) =>
                this.#editorRangesIntersect(edit.range, toEditorRange(range)),
              ),
          ),
          ...occurrences.map((range) => ({
            range: toEditorRange(range),
            newText: newName,
          })),
        ];
      }
      return {
        changes: Object.fromEntries(
          Object.entries(changes).map(([resource, edits]) => [
            resource,
            this.#deduplicateEdits(edits),
          ]),
        ),
      };
    }
    if (!this.#hasFreshSemanticFor(uri)) return null;
    const semantic = this.#semanticForDocument(uri)?.value;
    const symbol = semantic ? symbolAt(semantic, uri, position) : undefined;
    const declaration = symbol?.selectionRange ?? symbol?.range;
    if (
      !semantic ||
      !symbol ||
      !declaration ||
      this.isReadOnlyUri(declaration.uri) ||
      !/^[_A-Za-z][_A-Za-z0-9]*$/.test(newName)
    )
      return null;
    const result = renameSymbol(semantic, symbol.id, newName);
    return {
      changes: Object.fromEntries(
        Object.entries(result.changes)
          .filter(([resource]) => !this.isReadOnlyUri(resource))
          .map(([resource, edits]) => [
            resource,
            this.#deduplicateEdits(edits),
          ]),
      ),
    };
  }

  symbols(uri: string): DocumentSymbol[] {
    const document = this.#documents.get(uri);
    const editor = this.getEditorSnapshot(uri)?.value;
    const syntax =
      (editor ? this.#syntaxFromEditor(editor) : null) ??
      (document && this.#editorAnalysis
        ? this.#syntaxForText(uri, document.text)
        : this.getSyntaxSnapshot(uri)?.value);
    if (document && syntax) {
      const baseline =
        this.#stickyOutlines.get(uri) ?? this.#semanticOutline(uri);
      const symbols = syntaxDocumentSymbols(syntax, document.text, baseline);
      this.#stickyOutlines.set(uri, symbols);
      return symbols;
    }
    return this.#stickyOutlines.get(uri) ?? this.#semanticOutline(uri);
  }

  waitForDocumentSymbols(
    uri: string,
    documentVersion: number,
    signal?: {
      readonly aborted?: boolean;
      readonly isCancellationRequested?: boolean;
    },
  ): Promise<DocumentSymbol[]> {
    if (signal?.aborted || signal?.isCancellationRequested)
      return Promise.resolve(this.symbols(uri));
    const document = this.#documents.get(uri);
    if (
      !this.#editorAnalysis ||
      !document ||
      document.version !== documentVersion ||
      this.getEditorSnapshot(uri)
    )
      return Promise.resolve(this.symbols(uri));
    return this.#ensureEditorSnapshot(uri).then(() => this.symbols(uri));
  }

  hover(uri: string, position: EditorPosition): HoverResult | null {
    const editor = this.getEditorSnapshot(uri)?.value;
    const semantic = this.#completionSemanticForDocument(uri)?.value ?? null;
    if (this.#documents.get(uri)?.dirty && editor) {
      const target = editorTargetAt(
        editor,
        position,
        semantic,
        this.#currentEditorDeclarations(),
      );
      if (target?.kind === "editor")
        return {
          markdown: `**${target.declaration.kind}** \`${target.declaration.qualifiedName}\``,
          range: toEditorRange(target.declaration.selectionRange),
        };
      const range =
        target?.kind === "semantic"
          ? (target.symbol.selectionRange ?? target.symbol.range)
          : null;
      return target?.kind === "semantic" && range
        ? {
            markdown: `**${target.symbol.kind}** \`${target.symbol.qualifiedName}\``,
            range: toEditorRange(range),
          }
        : null;
    }
    if (!this.#hasFreshSemanticFor(uri)) return null;
    const semanticResult = this.#semanticForDocument(uri);
    const symbol = semanticResult?.value
      ? symbolAt(semanticResult.value, uri, position)
      : undefined;
    const range = symbol?.selectionRange ?? symbol?.range;
    if (!symbol || !range) return null;
    const stale =
      semanticResult?.freshness === "stale" ? "\n\n_Analysis is stale._" : "";
    return {
      markdown: `**${symbol.kind}** \`${symbol.qualifiedName}\`${stale}`,
      range: toEditorRange(range),
    };
  }

  formatting(
    uri: string,
    options: { indentSize?: number; requireValidSyntax?: boolean } = {},
  ): TextEdit[] {
    const document = this.#documents.get(uri);
    if (!document || this.isReadOnlyUri(uri)) return [];
    const formatted = this.compiler.format(uri, options);
    if (!formatted.success || !formatted.applicable || !formatted.changed)
      return [];
    const lines = document.text.split("\n");
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: {
            line: Math.max(0, lines.length - 1),
            character: lines.at(-1)?.length ?? 0,
          },
        },
        newText: formatted.text,
      },
    ];
  }

  onTypeEdit(
    uri: string,
    position: EditorPosition,
    character: string,
    options: EditorFormattingOptions = {},
  ): TemplateEdit | null {
    if (character !== "\n" || this.isReadOnlyUri(uri)) return null;
    const text = this.#effectiveSources.get(uri)?.text;
    const editor = this.getEditorSnapshot(uri)?.value;
    const syntax =
      (editor ? this.#syntaxFromEditor(editor) : null) ??
      (text !== undefined ? this.#syntaxForText(uri, text) : null);
    return syntax && text !== undefined
      ? templateForNewline(syntax, text, position, options)
      : null;
  }

  async compile(roots: readonly string[]): Promise<CompilationResult> {
    if (roots.length !== 1)
      throw new Error("Exactly one root URI is required for compilation");
    return (await this.compileDocument(roots[0]!, "manual")).compilation;
  }

  compileDocument(
    rootUri: string,
    trigger: CompilationTrigger,
  ): Promise<CompilationEvent> {
    this.#assertActive();
    if (!rootUri) throw new Error("A root URI is required for compilation");
    return this.#scheduler.enqueue({
      rootUri,
      trigger,
      compilationEpoch: this.#compilationEpoch,
      requestedDocumentVersion: this.#documents.get(rootUri)?.version ?? 0,
      requestedSourceVersion: this.#effectiveSources.get(rootUri)?.version,
    });
  }

  #cancelledCompilation(
    pending: Pick<
      ScheduledCompilation & { readonly runId: number },
      "runId" | "trigger" | "rootUri" | "requestedDocumentVersion"
    >,
  ): CompilationEvent {
    const common = {
      schemaVersion: 1 as const,
      abiVersion: 1 as const,
      compilerVersion: "unknown",
    };
    return {
      runId: pending.runId,
      timestamp: new Date().toISOString(),
      trigger: pending.trigger,
      rootUri: pending.rootUri,
      documentVersion: pending.requestedDocumentVersion,
      compilation: {
        ...common,
        kind: "compilation",
        success: false,
        cancelled: true,
        errorCount: 0,
        warningCount: 0,
        missingModels: [],
        models: [],
        diagnostics: [],
        logs: [],
      },
      semantic: {
        value: null,
        freshness: "cancelled",
        generation: this.#generation,
        documentVersions: this.#versions(),
      },
    };
  }

  getSemanticSnapshot(
    rootUriOrAllowStale: string | boolean = true,
    allowStale = true,
  ): VersionedResult<SemanticSnapshot> | null {
    const rootUri =
      typeof rootUriOrAllowStale === "string" ? rootUriOrAllowStale : null;
    const mayUseStale =
      typeof rootUriOrAllowStale === "boolean"
        ? rootUriOrAllowStale
        : allowStale;
    const current = rootUri
      ? (this.#semanticByRoot.get(rootUri) ?? null)
      : this.#lastSemantic;
    const lastGood = rootUri
      ? (this.#lastGoodSemanticByRoot.get(rootUri) ?? null)
      : this.#lastGoodSemantic;
    if (current?.freshness === "fresh" && this.#snapshotIsCurrent(current))
      return current;
    if (!mayUseStale || !lastGood) return current;
    return {
      ...lastGood,
      freshness: "stale",
      generation: this.#generation,
    };
  }

  getSavedSemanticSnapshot(
    rootUri?: string,
  ): VersionedResult<SemanticSnapshot> | null {
    const saved = rootUri
      ? (this.#savedSemanticByRoot.get(rootUri) ?? null)
      : this.#lastSavedSemantic;
    if (!saved) return null;
    const freshness = this.#snapshotIsCurrent(saved)
      ? saved.freshness
      : "stale";
    return { ...saved, freshness };
  }

  /** @deprecated Use compileDocument(uri, "manual"). */
  async analyzeNow(
    changedUri?: string,
  ): Promise<VersionedResult<SemanticSnapshot>> {
    const rootUri =
      changedUri ?? this.#documents.keys().next().value ?? undefined;
    if (!rootUri) throw new Error("A root URI is required for analysis");
    return (await this.compileDocument(rootUri, "manual")).semantic;
  }

  async #runCompilation(
    rootUri: string,
    trigger: CompilationTrigger,
    runId: number,
    compilationEpoch: number,
    requestedDocumentVersion: number,
    requestedSourceVersion: number | undefined,
  ): Promise<CompilationEvent> {
    const generation = this.#generation;
    const requestIsCurrent = (): boolean => {
      const document = this.#documents.get(rootUri);
      return (
        !this.#disposed &&
        this.#compilationEpoch === compilationEpoch &&
        (trigger === "manual" || this.#scheduler.isLatest(rootUri, runId)) &&
        (!document || document.version === requestedDocumentVersion) &&
        this.#effectiveSources.get(rootUri)?.version === requestedSourceVersion
      );
    };
    await Promise.resolve();
    if (!requestIsCurrent())
      return this.#cancelledCompilation({
        runId,
        trigger,
        rootUri,
        requestedDocumentVersion,
      });
    let analysis: CompilationAnalysisResult;
    try {
      analysis = await this.#runCoordinator.run({
        compile: () => Promise.resolve(this.compiler.compileAndAnalyze({ roots: [rootUri] })),
        resolveMissingModels: (initial) => this.#resolveMissingModels(initial, rootUri, requestIsCurrent),
        isCurrent: requestIsCurrent,
      });
    } catch (error) {
      this.#onError?.(error);
      analysis = this.#failedAnalysis(rootUri, error);
    }

    let fresh =
      requestIsCurrent() && this.#semanticValueIsCurrent(analysis.semantic);
    if (fresh && !this.#documents.get(rootUri)?.dirty)
      await this.#refreshSavedLintDiagnostics(rootUri, analysis.semantic);
    fresh =
      fresh &&
      requestIsCurrent() &&
      this.#semanticValueIsCurrent(analysis.semantic);
    if (fresh) {
      const token = {
        uri: rootUri,
        rootUri,
        documentVersion: requestedDocumentVersion,
        runId,
        compilationEpoch,
        generation: this.#generation,
      };
      // requestIsCurrent() remains the authoritative compilation freshness
      // check. The gate records the accepted publication token so consumers
      // that retain asynchronous projections can apply the same policy.
      this.#diagnosticVersionGate.accept(token);
    }
    const current = this.#documents.get(rootUri);
    for (const syntax of analysis.syntax) {
      const existing = this.#syntax.get(syntax.uri);
      if (fresh || existing?.freshness !== "fresh")
        this.#syntax.set(syntax.uri, {
          value: syntax,
          freshness: fresh ? "fresh" : "stale",
          generation: fresh ? this.#generation : generation,
          documentVersions: analysis.semantic.documentVersions,
        });
    }
    const semantic = {
      value: analysis.semantic,
      freshness: fresh ? ("fresh" as const) : ("stale" as const),
      generation: fresh ? this.#generation : generation,
      documentVersions: analysis.semantic.documentVersions,
    };

    const event: CompilationEvent = {
      runId,
      timestamp: new Date().toISOString(),
      trigger,
      rootUri,
      documentVersion: requestedDocumentVersion,
      compilation: analysis.compilation,
      semantic,
    };
    if (fresh) {
      this.#semanticByRoot.set(rootUri, semantic);
      this.#semanticSnapshotStore.accept(rootUri, semantic, {
        saved: !current?.dirty,
        successful: analysis.semantic.success && !analysis.semantic.cancelled,
      });
      this.#lastSemantic = semantic;
      this.#lastSemanticRoot = rootUri;
      if (analysis.semantic.success && !analysis.semantic.cancelled) {
        this.#lastGoodSemanticByRoot.set(rootUri, semantic);
        this.#lastGoodSemantic = semantic;
        for (const uri of Object.keys(analysis.semantic.documentVersions))
          this.#stickyOutlines.set(
            uri,
            documentSymbols(analysis.semantic, uri),
          );
      }
      if (!current?.dirty) {
        this.#lastSavedSemantic = semantic;
        this.#savedSemanticByRoot.set(rootUri, semantic);
      }
      this.#rebuildDependencies(analysis.semantic);
      this.#dependencyIndex.rebuild(analysis.semantic);
      const affectedDiagnosticUris = this.#replaceDiagnostics(
        rootUri,
        analysis.compilation.diagnostics,
      );
      // Let compilation listeners publish the compiler result first. The
      // final diagnostics event then publishes the compiler/lint merge.
      this.#events.emitCompilation(event);
      const affectedUris = Object.keys(analysis.semantic.documentVersions);
      if (!affectedUris.includes(rootUri)) affectedUris.unshift(rootUri);
      const analysisEvent = { result: semantic, affectedUris };
      this.#events.emitAnalysis(analysisEvent);
      for (const uri of affectedDiagnosticUris)
        this.#emitDiagnosticsChanged(
          uri,
          this.#documents.get(uri)?.version ?? null,
          this.liveAnalysisStatus(uri),
        );
    }
    return event;
  }

  async cancelAnalysis(): Promise<void> {
    this.#compilationEpoch++;
    this.#generation++;
    this.#diagnosticVersionGate.beginEpoch(this.#generation);
    this.#diagnosticCoordinator.beginEpoch(this.#generation);
    this.#scheduler.invalidateAll();
    await this.compiler.restart?.();
    this.#lastSemantic = {
      value: null,
      freshness: "cancelled",
      generation: this.#generation,
      documentVersions: this.#versions(),
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#compilationEpoch++;
    this.#generation++;
    this.#scheduler.dispose();
    for (const timer of this.#liveTimers.values()) clearTimeout(timer);
    this.#liveTimers.clear();
    this.#onDemandEditorAnalysis.clear();
    this.#events.clear();
    this.#diagnosticStore.clear();
    this.#diagnosticCoordinator.clear();
    this.#readOnlyUris.clear();
    void this.#repositoryController.dispose();
    this.#editorAnalysis?.dispose();
    this.compiler.dispose();
  }

  #setDocument(
    uri: string,
    text: string,
    version: number,
    dirty: boolean,
  ): VersionedResult<SyntaxSnapshot> {
    this.#assertActive();
    const current = this.#documents.get(uri);
    if (current && version <= current.version)
      throw new Error(`Document version must increase for ${uri}`);
    this.#sources.recordDocument(uri, text, version, dirty);
    this.#documents.set(uri, { uri, text, version, dirty });
    this.#applyEffectiveSource(uri, text, version);
    this.#scheduleEditorAnalysis(uri, version);
    return {
      value: null,
      freshness: "stale",
      generation: this.#generation,
      documentVersions: this.#versions(),
    };
  }

  #parseSource(uri: string): VersionedResult<SyntaxSnapshot> {
    const snapshot = this.compiler.parse(uri);
    const result = {
      value: snapshot,
      freshness: "fresh",
      generation: this.#generation,
      documentVersions: this.#versions(),
    } as const;
    this.#syntax.set(uri, result);
    return result;
  }

  #refreshEffectiveSource(uri: string, conservativeIfUnknown = false): void {
    const document = this.#documents.get(uri);
    if (document) {
      this.#applyEffectiveSource(
        uri,
        document.text,
        document.version,
        conservativeIfUnknown,
      );
      return;
    }
    const workspace = this.#workspaceSources.get(uri);
    if (workspace) {
      this.#applyEffectiveSource(
        uri,
        workspace.text,
        workspace.version,
        conservativeIfUnknown,
      );
      return;
    }
    const repository = this.#repositorySources.get(uri);
    if (repository) {
      this.#applyEffectiveSource(
        uri,
        repository.source,
        this.#repositorySourceVersions.get(uri),
        conservativeIfUnknown,
      );
      return;
    }
    if (this.#effectiveSources.delete(uri)) {
      this.#removedSourceUris.add(uri);
      this.compiler.removeSource(uri);
      this.#editorAnalysis?.removeSource(uri);
      this.#syntax.delete(uri);
      this.#editorSnapshots.delete(uri);
      this.#savedLint.delete(uri);
      this.#diagnosticStore.remove(uri, "saved");
      this.#invalidateSource(uri, conservativeIfUnknown);
    }
  }

  #putRepositorySource(source: ResolvedRepositoryModel): void {
    this.#sources.putRepositorySource(source);
    this.#repositorySources.set(source.uri, source);
    this.#repositorySourceVersions.set(source.uri, ++this.#sourceRevision);
    this.#readOnlyUris.add(source.uri);
    this.#refreshEffectiveSource(source.uri, true);
  }

  async #resolveMissingModels(
    initial: CompilationAnalysisResult,
    rootUri: string,
    shouldContinue: () => boolean = () => true,
  ): Promise<CompilationAnalysisResult> {
    let analysis = initial;
    const attempted = new Set<string>();
    const failures = new Map<string, string>();
    while (this.#modelRepository) {
      if (!shouldContinue()) break;
      const requests = [
        ...new Set(
          analysis.compilation.missingModels.filter(
            (model) => model !== "INTERLIS",
          ),
        ),
      ]
        .flatMap((model) =>
          this.#schemaLanguagesForMissingModel(model, analysis.syntax).map(
            (schema) => ({ model, schema, key: `${schema}:${model}` }),
          ),
        )
        .filter((request) => !attempted.has(request.key));
      if (requests.length === 0) break;
      const compiledNames = new Set(
        analysis.compilation.models.map((model) => model.name),
      );
      let added = 0;
      for (const request of requests) {
        if (!shouldContinue()) break;
        attempted.add(request.key);
        try {
          const resolved = await this.#repositoryController.resolveMissing(
            [request.model], request.schema,
          );
          for (const source of resolved) {
            if (
              this.#repositorySources.has(source.uri) ||
              compiledNames.has(source.model)
            )
              continue;
            this.#putRepositorySource(source);
            added++;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failures.set(request.key, message);
          this.#onError?.(error);
        }
      }
      if (added === 0) break;
      if (!shouldContinue()) break;
      analysis = await this.compiler.compileAndAnalyze({ roots: [rootUri] });
    }

    const unresolved = [
      ...new Set(
        analysis.compilation.missingModels.filter(
          (model) => model !== "INTERLIS",
        ),
      ),
    ];
    if (unresolved.length === 0) return analysis;
    const extra = unresolved.flatMap((model) =>
      this.#repositoryDiagnostics(
        model,
        this.#schemaLanguagesForMissingModel(model, analysis.syntax)
          .map((schema) => failures.get(`${schema}:${model}`))
          .find((message) => message !== undefined) ??
          "model not found in configured repositories",
        analysis.syntax,
      ),
    );
    const diagnostics = [...analysis.compilation.diagnostics, ...extra];
    return {
      ...analysis,
      compilation: {
        ...analysis.compilation,
        success: false,
        errorCount: analysis.compilation.errorCount + extra.length,
        diagnostics,
      },
      semantic: {
        ...analysis.semantic,
        success: false,
        diagnostics,
      },
    };
  }

  #failedAnalysis(rootUri: string, error: unknown): CompilationAnalysisResult {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic: Diagnostic = {
      severity: "error",
      code: "language-service-compilation-failed",
      message,
      range: null,
      relatedInformation: [],
      notes: [],
      treatedAsError: true,
    };
    const common = {
      schemaVersion: 1 as const,
      abiVersion: 1 as const,
      compilerVersion: "unknown",
    };
    return {
      ...common,
      kind: "compilation-analysis",
      compilation: {
        ...common,
        kind: "compilation",
        success: false,
        cancelled: false,
        errorCount: 1,
        warningCount: 0,
        missingModels: [],
        models: [],
        diagnostics: [diagnostic],
        logs: [],
      },
      semantic: {
        ...common,
        kind: "semantic",
        success: false,
        cancelled: false,
        roots: [rootUri],
        documentVersions: this.#versions(),
        missingModels: [],
        symbols: [],
        references: [],
        dependencies: [],
        diagram: { nodes: [], edges: [] },
        documentation: { title: "", sections: [] },
        diagnostics: [diagnostic],
        logs: [],
      },
      syntax: [],
    };
  }

  #replaceDiagnostics(
    rootUri: string,
    diagnostics: readonly Diagnostic[],
  ): Set<string> {
    this.#diagnosticStore.removeByRoot(rootUri);
    const affected = new Set<string>([
      rootUri,
      ...(this.#diagnosticsByRoot.get(rootUri)?.keys() ?? []),
    ]);
    const grouped = new Map<string, Diagnostic[]>();
    for (const diagnostic of diagnostics) {
      const uri = diagnostic.range?.uri ?? rootUri;
      affected.add(uri);
      const values = grouped.get(uri) ?? [];
      values.push(diagnostic);
      grouped.set(uri, values);
    }
    for (const [uri, values] of grouped) {
      const documentVersion =
        this.#documents.get(uri)?.version ??
        this.#effectiveSources.get(uri)?.version ??
        0;
      const normalized = deduplicateDiagnostics(values);
      grouped.set(uri, normalized);
      this.#diagnosticStore.put({
        uri,
        rootUri,
        documentVersion,
        origin: "semantic",
        diagnostics: normalized,
      });
      this.#diagnosticCoordinator.acceptCompiler(uri, rootUri, documentVersion, values);
    }
    this.#diagnosticsByRoot.set(rootUri, grouped);
    this.#diagnostics.clear();
    for (const rootDiagnostics of this.#diagnosticsByRoot.values())
      for (const [uri, values] of rootDiagnostics)
        this.#diagnostics.set(
          uri,
          deduplicateDiagnostics([
            ...(this.#diagnostics.get(uri) ?? []),
            ...values,
          ]),
        );
    return affected;
  }

  #mergeDiagnostics(
    ...groups: readonly (readonly Diagnostic[])[]
  ): Diagnostic[] {
    return deduplicateDiagnostics(groups.flat());
  }

  #updateSavedLint(
    uri: string,
    snapshot: EditorSnapshot,
    semantic: SemanticSnapshot | null = this.#completionSemanticForDocument(uri)
      ?.value ?? null,
  ): void {
    if (this.#liveDiagnosticsMode === "off") {
      this.#savedLint.delete(uri);
      return;
    }
    const effective = this.#effectiveSources.get(uri);
    if (!effective || effective.version !== snapshot.documentVersion) return;
    const analysis = analyzeLiveDocument(
      snapshot,
      effective.text,
      semantic,
      this.#currentEditorDeclarations(),
    );
    const diagnostics = analysis.diagnostics.filter(
      (diagnostic) => diagnostic.source === "lint",
    );
    const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
    this.#savedLint.set(uri, {
      documentVersion: snapshot.documentVersion,
      diagnostics,
      fixes: analysis.fixes.filter((fix) => codes.has(fix.diagnosticCode)),
    });
    this.#diagnosticCoordinator.putSaved(uri, snapshot.documentVersion, diagnostics);
    this.#diagnosticStore.put({
      uri,
      documentVersion: snapshot.documentVersion,
      origin: "saved",
      diagnostics,
    });
  }

  async #refreshSavedLintDiagnostics(
    uri: string,
    semantic: SemanticSnapshot,
  ): Promise<void> {
    if (this.#liveDiagnosticsMode === "off") return;
    const document = this.#documents.get(uri);
    if (!document || document.dirty) return;
    const snapshot = await this.#ensureEditorSnapshot(uri);
    if (
      snapshot &&
      this.#documents.get(uri)?.dirty === false &&
      this.#documents.get(uri)?.version === snapshot.documentVersion
    )
      this.#updateSavedLint(uri, snapshot, semantic);
  }

  #invalidateSource(uri: string, conservativeIfUnknown = false): void {
    this.#generation++;
    this.#diagnosticVersionGate.beginEpoch(this.#generation);
    const syntax = this.#syntax.get(uri);
    if (syntax) this.#syntax.set(uri, { ...syntax, freshness: "stale" });
    let matched = this.#invalidateSemanticMap(this.#semanticByRoot, uri);
    matched =
      this.#invalidateSemanticMap(this.#savedSemanticByRoot, uri) || matched;
    if (
      this.#lastSemantic &&
      (this.#lastSemanticRoot === uri ||
        uri in this.#lastSemantic.documentVersions)
    )
      this.#lastSemantic = { ...this.#lastSemantic, freshness: "stale" };
    if (
      this.#lastSavedSemantic &&
      uri in this.#lastSavedSemantic.documentVersions
    )
      this.#lastSavedSemantic = {
        ...this.#lastSavedSemantic,
        freshness: "stale",
      };
    if (conservativeIfUnknown && !matched) {
      for (const map of [this.#semanticByRoot, this.#savedSemanticByRoot])
        for (const [rootUri, snapshot] of map)
          map.set(rootUri, { ...snapshot, freshness: "stale" });
      if (this.#lastSemantic)
        this.#lastSemantic = { ...this.#lastSemantic, freshness: "stale" };
      if (this.#lastSavedSemantic)
        this.#lastSavedSemantic = {
          ...this.#lastSavedSemantic,
          freshness: "stale",
        };
    }
  }

  #invalidateAll(): void {
    this.#generation++;
    this.#diagnosticVersionGate.beginEpoch(this.#generation);
    for (const [uri, snapshot] of this.#syntax)
      this.#syntax.set(uri, { ...snapshot, freshness: "stale" });
    for (const map of [this.#semanticByRoot, this.#savedSemanticByRoot])
      for (const [rootUri, snapshot] of map)
        map.set(rootUri, { ...snapshot, freshness: "stale" });
    if (this.#lastSemantic)
      this.#lastSemantic = { ...this.#lastSemantic, freshness: "stale" };
    if (this.#lastSavedSemantic)
      this.#lastSavedSemantic = {
        ...this.#lastSavedSemantic,
        freshness: "stale",
      };
  }

  #invalidateSemanticMap(
    map: Map<string, VersionedResult<SemanticSnapshot>>,
    uri: string,
  ): boolean {
    let matched = false;
    for (const [rootUri, snapshot] of map) {
      if (rootUri !== uri && !(uri in snapshot.documentVersions)) continue;
      matched = true;
      map.set(rootUri, { ...snapshot, freshness: "stale" });
    }
    return matched;
  }

  #applyEffectiveSource(
    uri: string,
    source: string | Uint8Array,
    preferredVersion?: number,
    conservativeIfUnknown = false,
  ): boolean {
    const text =
      typeof source === "string" ? source : new TextDecoder().decode(source);
    const current = this.#effectiveSources.get(uri);
    if (current?.text === text) {
      // Workspace/repository refreshes may legitimately carry a new storage
      // version for the same bytes; they need no semantic invalidation. A
      // live document update, however, must reach the native session so its
      // materialized documentVersions stay aligned with the editor.
      if (
        conservativeIfUnknown ||
        preferredVersion === undefined ||
        preferredVersion <= current.version
      )
        return false;
      this.#sourceRevision = Math.max(this.#sourceRevision, preferredVersion);
      this.#effectiveSources.set(uri, { text, version: preferredVersion });
      this.compiler.putSource(uri, text, preferredVersion);
      this.#editorAnalysis?.putSource(uri, text, preferredVersion);
      return false;
    }
    let version = preferredVersion;
    if (version === undefined || (current && version <= current.version))
      version = ++this.#sourceRevision;
    this.#sourceRevision = Math.max(this.#sourceRevision, version);
    this.#effectiveSources.set(uri, { text, version });
    this.#removedSourceUris.delete(uri);
    this.compiler.putSource(uri, text, version);
    this.#editorAnalysis?.putSource(uri, text, version);
    this.#invalidateSource(uri, conservativeIfUnknown);
    return true;
  }

  #snapshotIsCurrent(snapshot: VersionedResult<SemanticSnapshot>): boolean {
    return this.#semanticValueIsCurrent({
      documentVersions: snapshot.documentVersions,
    });
  }

  #semanticValueIsCurrent(value: {
    readonly documentVersions: Readonly<Record<string, number>>;
  }): boolean {
    return Object.entries(value.documentVersions).every(([uri, version]) => {
      const effective = this.#effectiveSources.get(uri);
      return effective
        ? effective.version === version
        : !this.#removedSourceUris.has(uri);
    });
  }

  #rebuildDependencies(snapshot: SemanticSnapshot): void {
    this.#reverseDependencies.clear();
    for (const dependency of snapshot.dependencies) {
      const dependants =
        this.#reverseDependencies.get(dependency.targetUri) ??
        new Set<string>();
      dependants.add(dependency.sourceUri);
      this.#reverseDependencies.set(dependency.targetUri, dependants);
    }
  }

  #versions(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      [...this.#effectiveSources].map(([uri, source]) => [uri, source.version]),
    );
  }

  #schemaLanguagesForMissingModel(
    model: string,
    snapshots: readonly SyntaxSnapshot[],
  ): RepositorySchemaLanguage[] {
    const schemas = new Set<RepositorySchemaLanguage>();
    for (const syntax of snapshots) {
      if (!syntax.imports.includes(model) || syntax.iliVersion === "1.0")
        continue;
      schemas.add(this.#schemaLanguage(syntax));
    }
    return schemas.size > 0 ? [...schemas] : ["ili2_3"];
  }

  #schemaLanguage(snapshot: SyntaxSnapshot): RepositorySchemaLanguage {
    return snapshot.iliVersion === "2.4" ? "ili2_4" : "ili2_3";
  }

  #localModelNames(schema: RepositorySchemaLanguage): Set<string> {
    const result = new Set<string>();
    for (const [uri, syntaxResult] of this.#syntax) {
      if (this.#repositorySources.has(uri)) continue;
      const syntax = syntaxResult.value;
      if (
        !syntax ||
        syntax.iliVersion === "1.0" ||
        this.#schemaLanguage(syntax) !== schema
      )
        continue;
      for (let index = 0; index + 1 < syntax.tokens.length; ++index) {
        if (syntax.tokens[index]?.kind !== "MODEL") continue;
        const name = syntax.tokens
          .slice(index + 1)
          .find((token) => token.kind === "NAME");
        if (name) result.add(name.text);
      }
    }
    return result;
  }

  #deduplicate(items: readonly CompletionItem[]): CompletionItem[] {
    return items.filter(
      (item, index) =>
        items.findIndex((candidate) => candidate.label === item.label) ===
        index,
    );
  }

  #repositoryDiagnostics(
    model: string,
    message: string,
    snapshots: readonly SyntaxSnapshot[],
  ): Diagnostic[] {
    const ranges: Diagnostic["range"][] = [];
    for (const syntax of snapshots) {
      for (const reference of syntax.importReferences ?? [])
        if (reference.model === model) ranges.push(reference.range);
    }
    if (ranges.length === 0) ranges.push(null);
    return ranges.map((range) => ({
      severity: "error",
      code: "repository-model-unavailable",
      message: `Cannot resolve imported model ${model}: ${message}`,
      range,
      relatedInformation: [],
      notes: [],
      treatedAsError: true,
    }));
  }

  #semanticForDocument(uri: string): VersionedResult<SemanticSnapshot> | null {
    const candidates = [...this.#semanticByRoot.entries()]
      .filter(
        ([rootUri, snapshot]) =>
          rootUri === uri ||
          uri in snapshot.documentVersions ||
          snapshot.value?.symbols.some((symbol) => symbol.range?.uri === uri),
      )
      .sort(([leftRoot, left], [rightRoot, right]) => {
        if (leftRoot === uri && rightRoot !== uri) return -1;
        if (rightRoot === uri && leftRoot !== uri) return 1;
        return right.generation - left.generation;
      });
    return (
      candidates
        .map(([, snapshot]) => snapshot)
        .find(
          (snapshot) =>
            snapshot.freshness === "fresh" && this.#snapshotIsCurrent(snapshot),
        ) ?? null
    );
  }

  #completionSemanticForDocument(
    uri: string,
  ): VersionedResult<SemanticSnapshot> | null {
    const current = this.#semanticForDocument(uri);
    if (current) return current;
    const candidates = [...this.#lastGoodSemanticByRoot.entries()]
      .filter(
        ([rootUri, snapshot]) =>
          rootUri === uri ||
          uri in snapshot.documentVersions ||
          snapshot.value?.symbols.some((symbol) => symbol.range?.uri === uri),
      )
      .sort(([leftRoot, left], [rightRoot, right]) => {
        if (leftRoot === uri && rightRoot !== uri) return -1;
        if (rightRoot === uri && leftRoot !== uri) return 1;
        return right.generation - left.generation;
      });
    return candidates[0]?.[1] ?? null;
  }

  #workspaceCompletionSemantic(
    syntax: SyntaxSnapshot,
  ): SemanticSnapshot | null {
    const symbols: SemanticSnapshot["symbols"] = [];
    const schema = this.#schemaLanguage(syntax);
    for (const [uri, syntaxResult] of this.#syntax) {
      if (this.#repositorySources.has(uri)) continue;
      const candidate = syntaxResult.value;
      if (
        !candidate ||
        candidate.iliVersion === "1.0" ||
        this.#schemaLanguage(candidate) !== schema
      )
        continue;
      for (let index = 0; index + 1 < candidate.tokens.length; ++index) {
        if (candidate.tokens[index]?.kind !== "MODEL") continue;
        const name = candidate.tokens
          .slice(index + 1)
          .find((token) => token.kind === "NAME");
        if (!name) continue;
        symbols.push({
          id: `workspace-completion-model:${uri}:${name.text}`,
          name: name.text,
          qualifiedName: name.text,
          kind: "model",
          containerId: "",
          range: name.range,
          selectionRange: name.range,
          endRange: null,
          abstract: false,
        });
      }
    }
    if (symbols.length === 0) return null;
    return {
      schemaVersion: syntax.schemaVersion,
      abiVersion: syntax.abiVersion,
      compilerVersion: syntax.compilerVersion,
      kind: "semantic",
      success: true,
      cancelled: false,
      roots: [],
      documentVersions: {},
      missingModels: [],
      symbols,
      references: [],
      dependencies: [],
      diagram: { nodes: [], edges: [] },
      documentation: { title: "", sections: [] },
      diagnostics: [],
      logs: [],
    };
  }

  #semanticOutline(uri: string): DocumentSymbol[] {
    const candidates = [...this.#lastGoodSemanticByRoot.entries()]
      .filter(
        ([rootUri, snapshot]) =>
          rootUri === uri ||
          uri in snapshot.documentVersions ||
          snapshot.value?.symbols.some((symbol) => symbol.range?.uri === uri),
      )
      .sort(([, left], [, right]) => right.generation - left.generation);
    const semantic = candidates[0]?.[1].value;
    return semantic ? documentSymbols(semantic, uri) : [];
  }

  #deduplicateEdits(edits: readonly TextEdit[]): TextEdit[] {
    const seen = new Set<string>();
    return edits.filter((edit) => {
      const key = `${edit.range.start.line}:${edit.range.start.character}:${edit.range.end.line}:${edit.range.end.character}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  #deduplicateLocations(locations: readonly Location[]): Location[] {
    const seen = new Set<string>();
    return locations.filter((location) => {
      const range = location.range;
      const key = `${location.uri}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  #currentEditorSnapshots(): EditorSnapshot[] {
    return [...this.#editorSnapshots.values()].flatMap((result) => {
      const value = result.value;
      const effective = value
        ? this.#effectiveSources.get(value.uri)
        : undefined;
      return value && effective?.version === value.documentVersion
        ? [value]
        : [];
    });
  }

  #currentEditorDeclarations(): EditorSnapshot["declarations"] {
    return this.#currentEditorSnapshots().flatMap(
      (snapshot) => snapshot.declarations,
    );
  }

  async #ensureEditorSnapshot(uri: string): Promise<EditorSnapshot | null> {
    const current = this.getEditorSnapshot(uri)?.value;
    if (current) return current;
    if (this.#liveStatuses.get(uri) === "unavailable") return null;
    const effective = this.#effectiveSources.get(uri);
    if (!effective || !this.#editorAnalysis) return null;
    const pending = this.#onDemandEditorAnalysis.get(uri);
    if (pending?.version === effective.version) return pending.promise;
    const timer = this.#liveTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.#liveTimers.delete(uri);
    const promise = this.#runEditorAnalysis(uri, effective.version).finally(
      () => {
        if (this.#onDemandEditorAnalysis.get(uri)?.promise === promise)
          this.#onDemandEditorAnalysis.delete(uri);
      },
    );
    this.#onDemandEditorAnalysis.set(uri, {
      version: effective.version,
      promise,
    });
    return promise;
  }

  #scheduleEditorAnalysis(uri: string, version: number): void {
    if (!this.#editorAnalysis || this.#liveDiagnosticsMode === "off") return;
    const existing = this.#liveTimers.get(uri);
    if (existing) clearTimeout(existing);
    this.#liveRequests.set(uri, (this.#liveRequests.get(uri) ?? 0) + 1);
    this.#liveStatuses.set(uri, "scheduled");
    this.#editorSnapshots.delete(uri);
    this.#liveDiagnostics.delete(uri);
    this.#diagnosticStore.remove(uri, "live");
    this.#liveFixes.delete(uri);
    this.#savedLint.delete(uri);
    this.#diagnosticStore.remove(uri, "saved");
    this.#emitDiagnosticsChanged(uri, version, "scheduled");
    const timer = setTimeout(() => {
      this.#liveTimers.delete(uri);
      void this.#runEditorAnalysis(uri, version);
    }, this.#liveDiagnosticsDelayMs);
    this.#liveTimers.set(uri, timer);
  }

  async #runEditorAnalysis(
    uri: string,
    version: number,
  ): Promise<EditorSnapshot | null> {
    if (!this.#editorAnalysis || this.#disposed) return null;
    const request = (this.#liveRequests.get(uri) ?? 0) + 1;
    this.#liveRequests.set(uri, request);
    this.#liveStatuses.set(uri, "running");
    this.#emitDiagnosticsChanged(uri, version, "running");
    try {
      const snapshot = await this.#editorSnapshotWithTimeout(uri);
      const effective = this.#effectiveSources.get(uri);
      if (
        this.#disposed ||
        this.#liveRequests.get(uri) !== request ||
        effective?.version !== version ||
        snapshot.documentVersion !== version
      )
        return null;
      const result: VersionedResult<EditorSnapshot> = {
        value: snapshot,
        freshness: "fresh",
        generation: this.#generation,
        documentVersions: { [uri]: version },
      };
      this.#editorSnapshots.set(uri, result);
      const document = this.#documents.get(uri);
      if (document?.dirty && this.#liveDiagnosticsMode === "conservative") {
        const analysis = analyzeLiveDocument(
          snapshot,
          effective.text,
          this.#completionSemanticForDocument(uri)?.value ?? null,
          this.#currentEditorDeclarations(),
        );
        this.#liveDiagnostics.set(uri, [...analysis.diagnostics]);
        this.#diagnosticStore.put({
          uri,
          documentVersion: version,
          origin: "live",
          diagnostics: analysis.diagnostics,
        });
        this.#diagnosticCoordinator.putLive(uri, version, analysis.diagnostics);
        this.#liveFixes.set(uri, analysis.fixes);
      } else if (document && !document.dirty)
        this.#updateSavedLint(uri, snapshot);
      this.#liveStatuses.set(uri, "ready");
      this.#emitDiagnosticsChanged(uri, version, "ready");
      return snapshot;
    } catch (error) {
      if (
        this.#liveRequests.get(uri) === request &&
        this.#effectiveSources.get(uri)?.version === version
      ) {
        this.#liveStatuses.set(uri, "unavailable");
        this.#emitDiagnosticsChanged(uri, version, "unavailable");
        this.#onError?.(error);
      }
      return null;
    }
  }

  async #editorSnapshotWithTimeout(uri: string): Promise<EditorSnapshot> {
    const analysis = this.#editorAnalysis!.analyze(uri);
    if (this.#editorAnalysisTimeoutMs === 0) return analysis;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        analysis,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Live INTERLIS analysis exceeded ${this.#editorAnalysisTimeoutMs} ms`,
                ),
              ),
            this.#editorAnalysisTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Live INTERLIS analysis exceeded")
      )
        await this.#editorAnalysis?.restart?.();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #emitDiagnosticsChanged(
    uri: string,
    documentVersion: number | null,
    status: LiveAnalysisStatus,
  ): void {
    const event = {
      uri,
      documentVersion,
      status: this.#liveDiagnosticsMode === "off" ? ("off" as const) : status,
    };
    this.#events.emitDiagnostics(event);
  }

  #syntaxFromEditor(snapshot: EditorSnapshot): SyntaxSnapshot {
    const nodeKind: Readonly<Record<string, string>> = {
      model: "modelDef",
      topic: "topicDef",
      class: "classDef",
      structure: "structureDef",
      association: "associationDef",
      view: "viewDef",
      graphic: "graphicDef",
      domain: "domainDef",
      unit: "unitDef",
      attribute: "attributeDef",
    };
    const keywordKind: Readonly<Record<string, string>> = {
      model: "MODEL",
      topic: "TOPIC",
      class: "CLASS",
      structure: "STRUCTURE",
      association: "ASSOCIATION",
      view: "VIEW",
      graphic: "GRAPHIC",
      domain: "ILIDOMAIN",
      unit: "UNIT",
    };
    const ids = new Map(
      snapshot.declarations.map((declaration, index) => [
        declaration.id,
        index + 1,
      ]),
    );
    const nodes = snapshot.declarations.map((declaration) => ({
      id: ids.get(declaration.id)!,
      parent: declaration.containerId
        ? (ids.get(declaration.containerId) ?? null)
        : null,
      kind: nodeKind[declaration.kind] ?? `${declaration.kind}Def`,
      range: declaration.range,
    }));
    const tokens = snapshot.declarations
      .flatMap((declaration) => {
        const keyword = keywordKind[declaration.kind];
        return [
          ...(keyword
            ? [
                {
                  kind: keyword,
                  text: keyword === "ILIDOMAIN" ? "DOMAIN" : keyword,
                  channel: 0,
                  range: {
                    uri: declaration.range.uri,
                    start: declaration.range.start,
                    end: declaration.selectionRange.start,
                  },
                },
              ]
            : []),
          {
            kind: "NAME",
            text: declaration.name,
            channel: 0,
            range: declaration.selectionRange,
          },
        ];
      })
      .sort(
        (left, right) =>
          left.range.start.byteOffset - right.range.start.byteOffset,
      );
    return {
      schemaVersion: 1,
      abiVersion: snapshot.abiVersion,
      compilerVersion: snapshot.compilerVersion,
      kind: "syntax",
      success: snapshot.success,
      uri: snapshot.uri,
      documentVersion: snapshot.documentVersion,
      iliVersion: snapshot.iliVersion,
      tokens,
      nodes,
      contexts: snapshot.contexts,
      imports: snapshot.imports.map((entry) => entry.model),
      importReferences: snapshot.imports,
      diagnostics: snapshot.diagnostics,
    };
  }

  #syntaxForText(uri: string, text: string): SyntaxSnapshot {
    const version = this.#effectiveSources.get(uri)?.version ?? 0;
    return {
      schemaVersion: 1,
      abiVersion: 1,
      compilerVersion: "editor-fast-path",
      kind: "syntax",
      success: true,
      uri,
      documentVersion: version,
      iliVersion: /^\s*TRANSFER\b/iu.test(text)
        ? "1.0"
        : /\bINTERLIS\s+2\.4\s*;/iu.test(text)
          ? "2.4"
          : "2.3",
      tokens: [],
      nodes: [],
      contexts: [],
      imports: [],
      importReferences: [],
      diagnostics: [],
    };
  }

  #editorRangesOverlap(left: EditorRange, right: EditorRange): boolean {
    return (
      this.#compareEditorPositions(left.start, right.end) <= 0 &&
      this.#compareEditorPositions(right.start, left.end) <= 0
    );
  }

  #editorRangesIntersect(left: EditorRange, right: EditorRange): boolean {
    return (
      this.#compareEditorPositions(left.start, right.end) < 0 &&
      this.#compareEditorPositions(right.start, left.end) < 0
    );
  }

  #compareEditorPositions(left: EditorPosition, right: EditorPosition): number {
    return left.line - right.line || left.character - right.character;
  }

  #hasFreshSemanticFor(uri: string): boolean {
    const document = this.#documents.get(uri);
    if (document?.dirty) return false;
    const semantic = this.#semanticForDocument(uri);
    if (!semantic) return false;
    const effective = this.#effectiveSources.get(uri);
    return !effective || semantic.documentVersions[uri] === effective.version;
  }

  #contains(
    range: { start: EditorPosition; end: EditorPosition },
    position: EditorPosition,
  ): boolean {
    return (
      (position.line > range.start.line ||
        (position.line === range.start.line &&
          position.character >= range.start.character)) &&
      (position.line < range.end.line ||
        (position.line === range.end.line &&
          position.character <= range.end.character))
    );
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("LanguageService has been disposed");
  }
}
