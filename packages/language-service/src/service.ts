import type {
  CompilationAnalysisResult,
  CompilationResult,
  Diagnostic,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import {
  completionsAt,
  contextAt,
  documentSymbols,
  locationsForDefinition,
  locationsForReferences,
  renameSymbol,
  symbolAt,
  syntaxDocumentSymbols,
  templateForNewline,
  toEditorRange,
} from "./features.js";
import type {
  CompletionItem,
  DocumentSymbol,
  EditorPosition,
  HoverResult,
  Location,
  RenameResult,
  TemplateEdit,
  TextEdit,
} from "./features.js";
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
  LanguageServiceOptions,
  OpenDocument,
  VersionedResult,
  WorkspaceSource,
} from "./types.js";

interface StoredSource {
  readonly text: string | Uint8Array;
  readonly version: number;
}

interface EffectiveSource {
  readonly text: string;
  readonly version: number;
}

interface PendingCompilation {
  readonly rootUri: string;
  readonly trigger: CompilationTrigger;
  readonly runId: number;
  readonly compilationEpoch: number;
  requestedDocumentVersion: number;
  requestedSourceVersion: number | undefined;
  readonly resolve: (event: CompilationEvent) => void;
  readonly reject: (error: unknown) => void;
}

export class LanguageService {
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
  readonly #reverseDependencies = new Map<string, Set<string>>();
  readonly #analysisListeners = new Set<(event: AnalysisEvent) => void>();
  readonly #compilationListeners = new Set<(event: CompilationEvent) => void>();
  readonly #onError?: (error: unknown) => void;
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
  readonly #latestRequestedRunIdByRoot = new Map<string, number>();
  readonly #stickyOutlines = new Map<string, DocumentSymbol[]>();
  readonly #pendingCompilations: PendingCompilation[] = [];
  #compileActive = false;
  #nextRunId = 0;
  #compilationEpoch = 0;
  #generation = 0;
  #sourceRevision = 1;
  #disposed = false;

  constructor(
    readonly compiler: CompilerBackend,
    options: LanguageServiceOptions = {},
  ) {
    if (options.onAnalysis) this.#analysisListeners.add(options.onAnalysis);
    if (options.onCompilation)
      this.#compilationListeners.add(options.onCompilation);
    this.#onError = options.onError;
    this.#modelRepository = options.modelRepository;
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
    this.#analysisListeners.add(listener);
    return { dispose: () => this.#analysisListeners.delete(listener) };
  }

  onCompilation(listener: (event: CompilationEvent) => void): {
    dispose(): void;
  } {
    this.#compilationListeners.add(listener);
    return { dispose: () => this.#compilationListeners.delete(listener) };
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
    this.#documents.set(uri, { ...document, dirty: false });
    if (!this.isReadOnlyUri(uri))
      this.#workspaceSources.set(uri, {
        text: document.text,
        version: document.version,
      });
  }

  closeDocument(uri: string): void {
    this.#assertActive();
    this.#documents.delete(uri);
    this.#refreshEffectiveSource(uri);
    if (!this.#repositorySources.has(uri)) this.#readOnlyUris.delete(uri);
  }

  replaceWorkspaceSources(sources: readonly WorkspaceSource[]): void {
    this.#assertActive();
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
    this.#workspaceSources.set(uri, {
      text,
      version: version ?? ++this.#sourceRevision,
    });
    if (this.#documents.has(uri)) return;
    this.#refreshEffectiveSource(uri, true);
  }

  removeWorkspaceSource(uri: string): void {
    this.#assertActive();
    if (!this.#workspaceSources.delete(uri)) return;
    if (this.#documents.has(uri)) return;
    this.#refreshEffectiveSource(uri, true);
  }

  async setModelRepository(repository?: ModelRepository): Promise<void> {
    this.#assertActive();
    const previous = this.#modelRepository;
    this.#modelRepository = repository;
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
    if (previous && previous !== repository) await previous.dispose?.();
  }

  async refreshModelCatalog(): Promise<readonly ModelCatalogEntry[]> {
    if (!this.#modelRepository) return [];
    if (this.#catalogPromise) return this.#catalogPromise;
    this.#catalogPromise = this.#modelRepository
      .listModels()
      .then((catalog) => {
        this.#catalog = catalog;
        return catalog;
      })
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
    return [...(this.#diagnostics.get(uri) ?? [])];
  }

  async completion(
    uri: string,
    position: EditorPosition,
  ): Promise<CompletionItem[]> {
    const syntax = this.getSyntaxSnapshot(uri)?.value;
    if (!syntax) return [];
    const base = completionsAt(
      syntax,
      this.#semanticForDocument(uri)?.value ?? null,
      position,
    );
    if (
      syntax.iliVersion === "1.0" ||
      !this.#isImportPosition(syntax, position)
    )
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
      });
    }
    return this.#deduplicate([...base, ...entries.values()]);
  }

  definition(uri: string, position: EditorPosition): Location[] {
    if (!this.#hasFreshSemanticFor(uri)) return [];
    const semantic = this.#semanticForDocument(uri)?.value;
    return semantic ? locationsForDefinition(semantic, uri, position) : [];
  }

  references(
    uri: string,
    position: EditorPosition,
    includeDeclaration = true,
  ): Location[] {
    if (!this.#hasFreshSemanticFor(uri)) return [];
    const semantic = this.#semanticForDocument(uri)?.value;
    if (!semantic) return [];
    const symbol = symbolAt(semantic, uri, position);
    return symbol
      ? locationsForReferences(semantic, symbol.id, includeDeclaration)
      : [];
  }

  prepareRename(
    uri: string,
    position: EditorPosition,
  ): { range: TextEdit["range"]; placeholder: string } | null {
    if (!this.#hasFreshSemanticFor(uri)) return null;
    const semantic = this.#semanticForDocument(uri)?.value;
    const symbol = semantic ? symbolAt(semantic, uri, position) : undefined;
    const declaration = symbol?.selectionRange ?? symbol?.range;
    if (!symbol || !declaration || this.isReadOnlyUri(declaration.uri))
      return null;
    const occurrence = [
      symbol.selectionRange,
      symbol.endRange,
      ...(semantic?.references
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
    const syntax = this.getSyntaxSnapshot(uri)?.value;
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
    _documentVersion: number,
    signal?: AbortSignal,
  ): Promise<DocumentSymbol[]> {
    if (signal?.aborted) return Promise.resolve([]);
    return Promise.resolve(this.symbols(uri));
  }

  hover(uri: string, position: EditorPosition): HoverResult | null {
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
  ): TemplateEdit | null {
    if (character !== "\n" || this.isReadOnlyUri(uri)) return null;
    const syntax = this.getSyntaxSnapshot(uri)?.value;
    return syntax ? templateForNewline(syntax, position) : null;
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
    const runId = ++this.#nextRunId;
    const compilationEpoch = this.#compilationEpoch;
    const requestedDocumentVersion = this.#documents.get(rootUri)?.version ?? 0;
    const requestedSourceVersion = this.#effectiveSources.get(rootUri)?.version;
    this.#latestRequestedRunIdByRoot.set(rootUri, runId);
    if (trigger !== "manual") {
      for (
        let index = this.#pendingCompilations.length - 1;
        index >= 0;
        index--
      ) {
        const pending = this.#pendingCompilations[index]!;
        if (pending.rootUri !== rootUri || pending.trigger === "manual")
          continue;
        this.#pendingCompilations.splice(index, 1);
        pending.resolve(this.#cancelledCompilation(pending));
      }
    }
    const operation = new Promise<CompilationEvent>((resolve, reject) => {
      this.#pendingCompilations.push({
        rootUri,
        trigger,
        runId,
        compilationEpoch,
        requestedDocumentVersion,
        requestedSourceVersion,
        resolve,
        reject,
      });
      this.#startCompileDrain();
    });
    return operation;
  }

  #startCompileDrain(): void {
    if (this.#compileActive) return;
    this.#compileActive = true;
    void this.#drainCompilations();
  }

  async #drainCompilations(): Promise<void> {
    const priority: Readonly<Record<CompilationTrigger, number>> = {
      manual: 0,
      save: 1,
      diagram: 2,
      dependency: 3,
      startup: 4,
    };
    try {
      while (this.#pendingCompilations.length > 0) {
        this.#pendingCompilations.sort(
          (left, right) =>
            priority[left.trigger] - priority[right.trigger] ||
            left.runId - right.runId,
        );
        const pending = this.#pendingCompilations.shift()!;
        if (pending.trigger === "manual") {
          pending.requestedDocumentVersion =
            this.#documents.get(pending.rootUri)?.version ?? 0;
          pending.requestedSourceVersion = this.#effectiveSources.get(
            pending.rootUri,
          )?.version;
        } else if (
          this.#disposed ||
          pending.compilationEpoch !== this.#compilationEpoch ||
          this.#latestRequestedRunIdByRoot.get(pending.rootUri) !==
            pending.runId ||
          (this.#documents.get(pending.rootUri)?.version ?? 0) !==
            pending.requestedDocumentVersion ||
          this.#effectiveSources.get(pending.rootUri)?.version !==
            pending.requestedSourceVersion
        ) {
          pending.resolve(this.#cancelledCompilation(pending));
          continue;
        }
        try {
          pending.resolve(
            await this.#runCompilation(
              pending.rootUri,
              pending.trigger,
              pending.runId,
              pending.compilationEpoch,
              pending.requestedDocumentVersion,
              pending.requestedSourceVersion,
            ),
          );
        } catch (error) {
          pending.reject(error);
        }
      }
    } finally {
      this.#compileActive = false;
      if (this.#pendingCompilations.length > 0) this.#startCompileDrain();
    }
  }

  #cancelledCompilation(
    pending: Pick<
      PendingCompilation,
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
        (trigger === "manual" ||
          this.#latestRequestedRunIdByRoot.get(rootUri) === runId) &&
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
      analysis = await this.compiler.compileAndAnalyze({ roots: [rootUri] });
      analysis = await this.#resolveMissingModels(
        analysis,
        rootUri,
        requestIsCurrent,
      );
    } catch (error) {
      this.#onError?.(error);
      analysis = this.#failedAnalysis(rootUri, error);
    }

    const fresh =
      requestIsCurrent() && this.#semanticValueIsCurrent(analysis.semantic);
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
      this.#replaceDiagnostics(rootUri, analysis.compilation.diagnostics);
      for (const listener of this.#compilationListeners) listener(event);
      const affectedUris = Object.keys(analysis.semantic.documentVersions);
      if (!affectedUris.includes(rootUri)) affectedUris.unshift(rootUri);
      const analysisEvent = { result: semantic, affectedUris };
      for (const listener of this.#analysisListeners) listener(analysisEvent);
    }
    return event;
  }

  async cancelAnalysis(): Promise<void> {
    this.#compilationEpoch++;
    this.#generation++;
    for (const pending of this.#pendingCompilations.splice(0))
      pending.resolve(this.#cancelledCompilation(pending));
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
    for (const pending of this.#pendingCompilations.splice(0))
      pending.resolve(this.#cancelledCompilation(pending));
    this.#analysisListeners.clear();
    this.#compilationListeners.clear();
    this.#readOnlyUris.clear();
    void this.#modelRepository?.dispose?.();
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
    this.#documents.set(uri, { uri, text, version, dirty });
    this.#applyEffectiveSource(uri, text, version);
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
      this.#syntax.delete(uri);
      this.#invalidateSource(uri, conservativeIfUnknown);
    }
  }

  #putRepositorySource(source: ResolvedRepositoryModel): void {
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
          const resolved = await this.#modelRepository.resolveModels(
            [request.model],
            request.schema,
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
      await this.compiler.restart?.();
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
  ): void {
    const grouped = new Map<string, Diagnostic[]>();
    for (const diagnostic of diagnostics) {
      const uri = diagnostic.range?.uri ?? rootUri;
      const values = grouped.get(uri) ?? [];
      values.push(diagnostic);
      grouped.set(uri, values);
    }
    this.#diagnosticsByRoot.set(rootUri, grouped);
    this.#diagnostics.clear();
    for (const rootDiagnostics of this.#diagnosticsByRoot.values())
      for (const [uri, values] of rootDiagnostics)
        this.#diagnostics.set(uri, [
          ...(this.#diagnostics.get(uri) ?? []),
          ...values,
        ]);
  }

  #invalidateSource(uri: string, conservativeIfUnknown = false): void {
    this.#generation++;
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
    if (current?.text === text) return false;
    let version = preferredVersion;
    if (version === undefined || (current && version <= current.version))
      version = ++this.#sourceRevision;
    this.#sourceRevision = Math.max(this.#sourceRevision, version);
    this.#effectiveSources.set(uri, { text, version });
    this.#removedSourceUris.delete(uri);
    this.compiler.putSource(uri, text, version);
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

  #isImportPosition(syntax: SyntaxSnapshot, position: EditorPosition): boolean {
    const context = contextAt(syntax, position)?.kind;
    if (context === "importDef" || context === "importing") return true;
    const lineTokens = syntax.tokens.filter(
      (token) =>
        token.channel === 0 &&
        token.range.start.line === position.line &&
        token.range.start.character <= position.character,
    );
    let imports = -1;
    let semicolon = -1;
    lineTokens.forEach((token, index) => {
      if (token.kind === "IMPORTS") imports = index;
      if (token.kind === "SEMI") semicolon = index;
    });
    return imports >= 0 && imports > semicolon;
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
