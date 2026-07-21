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

export class LanguageService {
  readonly #documents = new Map<string, OpenDocument>();
  readonly #workspaceSources = new Map<string, StoredSource>();
  readonly #repositorySources = new Map<string, ResolvedRepositoryModel>();
  readonly #readOnlyUris = new Set<string>();
  readonly #syntax = new Map<string, VersionedResult<SyntaxSnapshot>>();
  readonly #diagnostics = new Map<string, Diagnostic[]>();
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
  readonly #savedSemanticByRoot = new Map<
    string,
    VersionedResult<SemanticSnapshot>
  >();
  #compileQueue: Promise<void> = Promise.resolve();
  #nextRunId = 0;
  #latestRequestedRunId = 0;
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
        version: ++this.#sourceRevision,
      });
  }

  closeDocument(uri: string): void {
    this.#assertActive();
    this.#documents.delete(uri);
    this.#refreshEffectiveSource(uri);
    if (!this.#repositorySources.has(uri)) this.#readOnlyUris.delete(uri);
    this.#invalidate();
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
    for (const uri of changed) this.#refreshEffectiveSource(uri);
    if (changed.size > 0) this.#invalidate();
  }

  putWorkspaceSource(uri: string, text: string, version?: number): void {
    this.#assertActive();
    this.#workspaceSources.set(uri, {
      text,
      version: version ?? ++this.#sourceRevision,
    });
    this.#refreshEffectiveSource(uri);
    this.#invalidate();
  }

  removeWorkspaceSource(uri: string): void {
    this.#assertActive();
    if (!this.#workspaceSources.delete(uri)) return;
    this.#refreshEffectiveSource(uri);
    this.#invalidate();
  }

  async setModelRepository(repository?: ModelRepository): Promise<void> {
    this.#assertActive();
    const previous = this.#modelRepository;
    this.#modelRepository = repository;
    this.#catalog = null;
    this.#catalogPromise = null;
    const uris = [...this.#repositorySources.keys()];
    this.#repositorySources.clear();
    for (const uri of uris) {
      this.#refreshEffectiveSource(uri);
      if (!this.#documents.has(uri)) this.#readOnlyUris.delete(uri);
    }
    this.#invalidate();
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
    const result = this.#syntax.get(uri) ?? null;
    const document = this.#documents.get(uri);
    if (
      result?.freshness !== "fresh" ||
      document?.dirty ||
      (document && result?.value?.documentVersion !== document.version)
    )
      return null;
    return result;
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
      this.getSemanticSnapshot()?.value ?? null,
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
    const semantic = this.getSemanticSnapshot()?.value;
    return semantic ? locationsForDefinition(semantic, uri, position) : [];
  }

  references(
    uri: string,
    position: EditorPosition,
    includeDeclaration = true,
  ): Location[] {
    if (!this.#hasFreshSemanticFor(uri)) return [];
    const semantic = this.getSemanticSnapshot()?.value;
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
    const semantic = this.getSemanticSnapshot()?.value;
    const symbol = semantic ? symbolAt(semantic, uri, position) : undefined;
    const declaration = symbol?.selectionRange ?? symbol?.range;
    if (!symbol || !declaration || this.isReadOnlyUri(declaration.uri))
      return null;
    const occurrence = semantic?.references.find(
      (reference) =>
        reference.targetId === symbol.id &&
        reference.range?.uri === uri &&
        reference.range &&
        this.#contains(reference.range, position),
    )?.range;
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
    const semantic = this.getSemanticSnapshot()?.value;
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
        Object.entries(result.changes).filter(
          ([resource]) => !this.isReadOnlyUri(resource),
        ),
      ),
    };
  }

  symbols(uri: string): DocumentSymbol[] {
    if (!this.#hasFreshSemanticFor(uri)) return [];
    const semantic = this.getSemanticSnapshot()?.value;
    return semantic ? documentSymbols(semantic, uri) : [];
  }

  hover(uri: string, position: EditorPosition): HoverResult | null {
    if (!this.#hasFreshSemanticFor(uri)) return null;
    const semanticResult = this.getSemanticSnapshot();
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
    this.#latestRequestedRunId = runId;
    const operation = this.#compileQueue.then(() =>
      this.#runCompilation(rootUri, trigger, runId),
    );
    this.#compileQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  getSemanticSnapshot(
    allowStale = true,
  ): VersionedResult<SemanticSnapshot> | null {
    if (this.#lastSemantic?.freshness === "fresh") return this.#lastSemantic;
    if (!allowStale || !this.#lastGoodSemantic) return this.#lastSemantic;
    return {
      ...this.#lastGoodSemantic,
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
    const freshness = Object.entries(saved.documentVersions).every(
      ([uri, version]) => {
        const document = this.#documents.get(uri);
        return !document || document.version === version;
      },
    )
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
  ): Promise<CompilationEvent> {
    const generation = this.#generation;
    const versions = this.#versions();
    let analysis: CompilationAnalysisResult;
    try {
      analysis = await Promise.resolve().then(() =>
        this.compiler.compileAndAnalyze({ roots: [rootUri] }),
      );
      analysis = await this.#resolveMissingModels(analysis, rootUri);
    } catch (error) {
      this.#onError?.(error);
      analysis = this.#failedAnalysis(rootUri, error);
    }

    const current = this.#documents.get(rootUri);
    const fresh =
      generation === this.#generation &&
      (!current || current.version === versions[rootUri]);
    for (const syntax of analysis.syntax) {
      this.#syntax.set(syntax.uri, {
        value: syntax,
        freshness: fresh ? "fresh" : "stale",
        generation,
        documentVersions: analysis.semantic.documentVersions,
      });
    }
    const semantic = {
      value: analysis.semantic,
      freshness: fresh ? ("fresh" as const) : ("stale" as const),
      generation,
      documentVersions: analysis.semantic.documentVersions,
    };
    this.#lastSemantic = semantic;
    if (analysis.semantic.success && !analysis.semantic.cancelled)
      this.#lastGoodSemantic = semantic;
    if (!current?.dirty) {
      this.#lastSavedSemantic = semantic;
      this.#savedSemanticByRoot.set(rootUri, semantic);
    }
    this.#rebuildDependencies(analysis.semantic);

    const event: CompilationEvent = {
      runId,
      timestamp: new Date().toISOString(),
      trigger,
      rootUri,
      documentVersion: versions[rootUri] ?? 0,
      compilation: analysis.compilation,
      semantic,
    };
    if (runId === this.#latestRequestedRunId) {
      this.#replaceDiagnostics(rootUri, analysis.compilation.diagnostics);
      for (const listener of this.#compilationListeners) listener(event);
      const affectedUris = [
        ...new Set(
          analysis.compilation.diagnostics.map(
            (diagnostic) => diagnostic.range?.uri ?? rootUri,
          ),
        ),
      ];
      const analysisEvent = { result: semantic, affectedUris };
      for (const listener of this.#analysisListeners) listener(analysisEvent);
    }
    return event;
  }

  async cancelAnalysis(): Promise<void> {
    this.#generation++;
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
    this.#generation++;
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
    this.compiler.putSource(uri, text, version);
    this.#invalidate();
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

  #refreshEffectiveSource(uri: string): void {
    const document = this.#documents.get(uri);
    if (document) {
      this.compiler.putSource(uri, document.text, document.version);
      return;
    }
    const workspace = this.#workspaceSources.get(uri);
    if (workspace) {
      this.compiler.putSource(uri, workspace.text, workspace.version);
      return;
    }
    const repository = this.#repositorySources.get(uri);
    if (repository) {
      this.compiler.putSource(uri, repository.source, ++this.#sourceRevision);
      return;
    }
    this.compiler.removeSource(uri);
    this.#syntax.delete(uri);
  }

  #putRepositorySource(source: ResolvedRepositoryModel): void {
    this.#repositorySources.set(source.uri, source);
    this.#readOnlyUris.add(source.uri);
    this.compiler.putSource(source.uri, source.source, ++this.#sourceRevision);
  }

  async #resolveMissingModels(
    initial: CompilationAnalysisResult,
    rootUri: string,
  ): Promise<CompilationAnalysisResult> {
    let analysis = initial;
    const attempted = new Set<string>();
    const failures = new Map<string, string>();
    while (this.#modelRepository) {
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
      await this.compiler.restart?.();
      analysis = this.compiler.compileAndAnalyze({ roots: [rootUri] });
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
    this.#diagnostics.clear();
    for (const diagnostic of diagnostics) {
      const uri = diagnostic.range?.uri ?? rootUri;
      const values = this.#diagnostics.get(uri) ?? [];
      values.push(diagnostic);
      this.#diagnostics.set(uri, values);
    }
  }

  #invalidate(): void {
    this.#generation++;
    for (const [uri, snapshot] of this.#syntax)
      this.#syntax.set(uri, { ...snapshot, freshness: "stale" });
    if (this.#lastSemantic)
      this.#lastSemantic = { ...this.#lastSemantic, freshness: "stale" };
    if (this.#lastSavedSemantic)
      this.#lastSavedSemantic = {
        ...this.#lastSavedSemantic,
        freshness: "stale",
      };
    for (const [rootUri, snapshot] of this.#savedSemanticByRoot)
      this.#savedSemanticByRoot.set(rootUri, {
        ...snapshot,
        freshness: "stale",
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
      [...this.#documents].map(([uri, document]) => [uri, document.version]),
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

  #hasFreshSemanticFor(uri: string): boolean {
    const document = this.#documents.get(uri);
    if (document?.dirty || this.#lastSemantic?.freshness !== "fresh")
      return false;
    if (!document) return true;
    return this.#lastSemantic.documentVersions[uri] === document.version;
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
