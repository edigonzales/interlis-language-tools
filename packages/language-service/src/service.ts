import type {
  CompilationResult,
  Diagnostic,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import { AnalysisCache } from "./cache.js";
import {
  completionsAt,
  contextAt,
  diagnosticsFor,
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
  readonly #cache = new AnalysisCache();
  readonly #compileCache = new Map<string, CompilationResult>();
  readonly #reverseDependencies = new Map<string, Set<string>>();
  readonly #debounceMs: number;
  readonly #analysisListeners = new Set<(event: AnalysisEvent) => void>();
  readonly #onError?: (error: unknown) => void;
  #modelRepository?: ModelRepository;
  #catalog: readonly ModelCatalogEntry[] | null = null;
  #catalogPromise: Promise<readonly ModelCatalogEntry[]> | null = null;
  #lastSemantic: VersionedResult<SemanticSnapshot> | null = null;
  #lastGoodSemantic: VersionedResult<SemanticSnapshot> | null = null;
  #analysisPromise: Promise<VersionedResult<SemanticSnapshot>> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #sourceRevision = 1;
  #disposed = false;

  constructor(
    readonly compiler: CompilerBackend,
    options: LanguageServiceOptions = {},
  ) {
    this.#debounceMs = options.semanticDebounceMs ?? 150;
    if (options.onAnalysis) this.#analysisListeners.add(options.onAnalysis);
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
    this.#invalidate(uri);
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
    this.#invalidate(uri);
  }

  removeWorkspaceSource(uri: string): void {
    this.#assertActive();
    if (!this.#workspaceSources.delete(uri)) return;
    this.#refreshEffectiveSource(uri);
    this.#invalidate(uri);
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
    return this.#syntax.get(uri) ?? null;
  }

  diagnostics(uri: string): Diagnostic[] {
    const syntax = this.#syntax.get(uri)?.value;
    if (!syntax) return [];
    const semantic =
      this.#lastSemantic?.freshness === "fresh"
        ? this.#lastSemantic.value
        : null;
    return diagnosticsFor(uri, syntax, semantic);
  }

  async completion(
    uri: string,
    position: EditorPosition,
  ): Promise<CompletionItem[]> {
    const syntax = this.#syntax.get(uri)?.value;
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
    const semantic = this.getSemanticSnapshot()?.value;
    return semantic ? locationsForDefinition(semantic, uri, position) : [];
  }

  references(
    uri: string,
    position: EditorPosition,
    includeDeclaration = true,
  ): Location[] {
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
    const semantic = this.getSemanticSnapshot()?.value;
    return semantic ? documentSymbols(semantic, uri) : [];
  }

  hover(uri: string, position: EditorPosition): HoverResult | null {
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
    const syntax = this.#syntax.get(uri)?.value;
    return syntax ? templateForNewline(syntax, position) : null;
  }

  async compile(
    roots = [...this.#documents.keys()],
  ): Promise<CompilationResult> {
    await this.analyzeNow(roots.at(0));
    const versions = this.#versions();
    const key = JSON.stringify({
      roots: [...roots].sort(),
      versions: Object.entries(versions).sort(),
      repositorySources: [...this.#repositorySources.keys()].sort(),
    });
    const cached = this.#compileCache.get(key);
    if (cached) return cached;
    const result = this.compiler.compile({ roots });
    this.#compileCache.set(key, result);
    return result;
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

  async analyzeNow(
    changedUri?: string,
  ): Promise<VersionedResult<SemanticSnapshot>> {
    this.#assertActive();
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    while (this.#analysisPromise)
      await this.#analysisPromise.catch(() => undefined);
    const analysis = this.#runAnalysis(changedUri);
    this.#analysisPromise = analysis;
    try {
      return await analysis;
    } finally {
      if (this.#analysisPromise === analysis) this.#analysisPromise = null;
    }
  }

  async #runAnalysis(
    changedUri?: string,
  ): Promise<VersionedResult<SemanticSnapshot>> {
    const generation = this.#generation;
    const versions = this.#versions();
    const roots = this.#affectedRoots(changedUri);
    const cached = this.#cache.get(roots, versions);
    let snapshot: SemanticSnapshot;
    if (cached) snapshot = cached;
    else {
      const failures = new Map<string, string>();
      const attempted = new Set<string>();
      let restartNeeded = false;
      if (this.#modelRepository) {
        for (const request of this.#directRepositoryRequests(roots)) {
          attempted.add(request.key);
          try {
            const resolved = await this.#modelRepository.resolveModels(
              [request.model],
              request.schema,
            );
            if (!this.#isCurrent(generation, versions))
              return this.#cancelled(generation, versions);
            for (const source of resolved) {
              if (
                this.#repositorySources.has(source.uri) ||
                this.#localModelNames(source.schemaLanguage).has(source.model)
              )
                continue;
              this.#putRepositorySource(source);
              restartNeeded = true;
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            failures.set(request.key, message);
            this.#onError?.(error);
          }
        }
      }
      if (restartNeeded) {
        await this.compiler.restart?.();
        if (!this.#isCurrent(generation, versions))
          return this.#cancelled(generation, versions);
      }
      snapshot = await Promise.resolve().then(() =>
        this.compiler.analyze({ roots }),
      );
      while (true) {
        if (!this.#isCurrent(generation, versions))
          return this.#cancelled(generation, versions);
        const missing = this.#missingModels(snapshot, roots).filter(
          (model) => model !== "INTERLIS",
        );
        const requests = missing
          .flatMap((model) =>
            this.#schemaLanguagesForMissingModel(model).map((schema) => ({
              model,
              schema,
              key: `${schema}:${model}`,
            })),
          )
          .filter((request) => !attempted.has(request.key));
        if (requests.length === 0 || !this.#modelRepository) break;
        let added = 0;
        for (const request of requests) {
          attempted.add(request.key);
          try {
            const resolved = await this.#modelRepository.resolveModels(
              [request.model],
              request.schema,
            );
            if (!this.#isCurrent(generation, versions))
              return this.#cancelled(generation, versions);
            for (const source of resolved) {
              if (
                this.#repositorySources.has(source.uri) ||
                this.#localModelNames(source.schemaLanguage).has(source.model)
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
        if (!this.#isCurrent(generation, versions))
          return this.#cancelled(generation, versions);
        snapshot = await Promise.resolve().then(() =>
          this.compiler.analyze({ roots }),
        );
      }
      const unresolved = this.#missingModels(snapshot, roots).filter(
        (model) => model !== "INTERLIS",
      );
      if (unresolved.length > 0)
        snapshot = {
          ...snapshot,
          diagnostics: [
            ...snapshot.diagnostics,
            ...unresolved.flatMap((model) =>
              this.#repositoryDiagnostics(
                model,
                this.#schemaLanguagesForMissingModel(model)
                  .map((schema) => failures.get(`${schema}:${model}`))
                  .find((message) => message !== undefined) ??
                  "model not found in configured repositories",
              ),
            ),
          ],
        };
    }
    if (!this.#isCurrent(generation, versions))
      return this.#cancelled(generation, versions);
    if (!cached) this.#cache.set(roots, versions, snapshot);
    const result = {
      value: snapshot,
      freshness: "fresh",
      generation,
      documentVersions: versions,
    } as const;
    this.#lastSemantic = result;
    if (snapshot.success && !snapshot.cancelled)
      this.#lastGoodSemantic = result;
    this.#rebuildDependencies(snapshot);
    const event = { result, affectedUris: roots };
    for (const listener of this.#analysisListeners) listener(event);
    return result;
  }

  async cancelAnalysis(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
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
    if (this.#timer) clearTimeout(this.#timer);
    this.#disposed = true;
    this.#generation++;
    this.#analysisListeners.clear();
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
    this.#invalidate(uri);
    return this.#parseSource(uri);
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
      this.#parseSource(uri);
      return;
    }
    const workspace = this.#workspaceSources.get(uri);
    if (workspace) {
      this.compiler.putSource(uri, workspace.text, workspace.version);
      this.#parseSource(uri);
      return;
    }
    const repository = this.#repositorySources.get(uri);
    if (repository) {
      this.compiler.putSource(uri, repository.source, ++this.#sourceRevision);
      this.#parseSource(uri);
      return;
    }
    this.compiler.removeSource(uri);
    this.#syntax.delete(uri);
  }

  #putRepositorySource(source: ResolvedRepositoryModel): void {
    this.#repositorySources.set(source.uri, source);
    this.#readOnlyUris.add(source.uri);
    this.compiler.putSource(source.uri, source.source, ++this.#sourceRevision);
    this.#cache.clear();
    this.#compileCache.clear();
  }

  #invalidate(changedUri?: string): void {
    this.#generation++;
    this.#cache.clear();
    this.#compileCache.clear();
    if (this.#lastSemantic)
      this.#lastSemantic = { ...this.#lastSemantic, freshness: "stale" };
    if (this.#documents.size > 0) this.#schedule(changedUri);
  }

  #schedule(changedUri?: string): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.analyzeNow(changedUri).catch((error) => this.#onError?.(error));
    }, this.#debounceMs);
  }

  #affectedRoots(changedUri?: string): string[] {
    const open = [...this.#documents.keys()];
    if (open.length === 0) return [...this.#workspaceSources.keys()].sort();
    if (!changedUri || !this.#documents.has(changedUri)) return open.sort();
    const affected = new Set<string>([changedUri]);
    const queue = [changedUri];
    while (queue.length > 0) {
      const dependency = queue.shift();
      if (!dependency) continue;
      for (const candidate of this.#reverseDependencies.get(dependency) ?? []) {
        if (affected.has(candidate)) continue;
        affected.add(candidate);
        queue.push(candidate);
      }
    }
    return open.filter((uri) => affected.has(uri)).sort();
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

  #isCurrent(
    generation: number,
    versions: Readonly<Record<string, number>>,
  ): boolean {
    if (generation !== this.#generation) return false;
    const current = this.#versions();
    const uris = new Set([...Object.keys(versions), ...Object.keys(current)]);
    return [...uris].every((uri) => versions[uri] === current[uri]);
  }

  #cancelled(
    generation: number,
    versions: Readonly<Record<string, number>>,
  ): VersionedResult<SemanticSnapshot> {
    const cancelled = {
      value: null,
      freshness: "cancelled",
      generation,
      documentVersions: versions,
    } as const;
    this.#lastSemantic = cancelled;
    return cancelled;
  }

  #missingModels(
    snapshot: SemanticSnapshot,
    roots: readonly string[],
  ): string[] {
    if (snapshot.missingModels) return [...new Set(snapshot.missingModels)];
    return [
      ...new Set(this.compiler.compile({ roots: [...roots] }).missingModels),
    ];
  }

  #schemaLanguagesForMissingModel(model: string): RepositorySchemaLanguage[] {
    const schemas = new Set<RepositorySchemaLanguage>();
    for (const syntaxResult of this.#syntax.values()) {
      const syntax = syntaxResult.value;
      if (
        !syntax ||
        !syntax.imports.includes(model) ||
        syntax.iliVersion === "1.0"
      )
        continue;
      schemas.add(this.#schemaLanguage(syntax));
    }
    return schemas.size > 0 ? [...schemas] : ["ili2_3"];
  }

  #schemaLanguage(snapshot: SyntaxSnapshot): RepositorySchemaLanguage {
    return snapshot.iliVersion === "2.4" ? "ili2_4" : "ili2_3";
  }

  #directRepositoryRequests(roots: readonly string[]): Array<{
    model: string;
    schema: RepositorySchemaLanguage;
    key: string;
  }> {
    const requests = new Map<
      string,
      { model: string; schema: RepositorySchemaLanguage; key: string }
    >();
    for (const uri of roots) {
      const syntax = this.#syntax.get(uri)?.value;
      if (!syntax || syntax.iliVersion === "1.0") continue;
      const schema = this.#schemaLanguage(syntax);
      const local = this.#localModelNames(schema);
      const repository = new Set(
        [...this.#repositorySources.values()]
          .filter((source) => source.schemaLanguage === schema)
          .map((source) => source.model),
      );
      for (const model of syntax.imports) {
        const key = `${schema}:${model}`;
        if (
          model === "INTERLIS" ||
          local.has(model) ||
          repository.has(model) ||
          requests.has(key)
        )
          continue;
        requests.set(key, { model, schema, key });
      }
    }
    return [...requests.values()];
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

  #repositoryDiagnostics(model: string, message: string): Diagnostic[] {
    const ranges: Diagnostic["range"][] = [];
    for (const syntax of this.#syntax.values()) {
      for (const reference of syntax.value?.importReferences ?? [])
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
