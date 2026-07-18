import type {
  CompilationResult,
  Diagnostic,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import { AnalysisCache } from "./cache.js";
import {
  completionsAt,
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
  AnalysisEvent,
  CompilerBackend,
  LanguageServiceOptions,
  OpenDocument,
  VersionedResult,
} from "./types.js";

export class LanguageService {
  readonly #documents = new Map<string, OpenDocument>();
  readonly #syntax = new Map<string, VersionedResult<SyntaxSnapshot>>();
  readonly #cache = new AnalysisCache();
  readonly #compileCache = new Map<string, CompilationResult>();
  readonly #reverseDependencies = new Map<string, Set<string>>();
  readonly #debounceMs: number;
  readonly #onAnalysis?: (event: AnalysisEvent) => void;
  readonly #onError?: (error: unknown) => void;
  #lastSemantic: VersionedResult<SemanticSnapshot> | null = null;
  #lastGoodSemantic: VersionedResult<SemanticSnapshot> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #disposed = false;

  constructor(
    readonly compiler: CompilerBackend,
    options: LanguageServiceOptions = {},
  ) {
    this.#debounceMs = options.semanticDebounceMs ?? 150;
    this.#onAnalysis = options.onAnalysis;
    this.#onError = options.onError;
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
    return this.#setDocument(uri, text, version, true);
  }

  markSaved(uri: string): void {
    const document = this.#documents.get(uri);
    if (document) this.#documents.set(uri, { ...document, dirty: false });
  }

  closeDocument(uri: string): void {
    this.#assertActive();
    this.#documents.delete(uri);
    this.#syntax.delete(uri);
    this.compiler.removeSource(uri);
    this.#generation++;
    this.#cache.clear();
    this.#compileCache.clear();
    this.#schedule(uri);
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

  completion(uri: string, position: EditorPosition): CompletionItem[] {
    const syntax = this.#syntax.get(uri)?.value;
    if (!syntax) return [];
    return completionsAt(
      syntax,
      this.getSemanticSnapshot()?.value ?? null,
      position,
    );
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
    return symbol?.range
      ? { range: toEditorRange(symbol.range), placeholder: symbol.name }
      : null;
  }

  rename(
    uri: string,
    position: EditorPosition,
    newName: string,
  ): RenameResult | null {
    const semantic = this.getSemanticSnapshot()?.value;
    const symbol = semantic ? symbolAt(semantic, uri, position) : undefined;
    return semantic && symbol && /^[_A-Za-z][_A-Za-z0-9]*$/.test(newName)
      ? renameSymbol(semantic, symbol.id, newName)
      : null;
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
    if (!symbol?.range) return null;
    const stale =
      semanticResult?.freshness === "stale" ? "\n\n_Analysis is stale._" : "";
    return {
      markdown: `**${symbol.kind}** \`${symbol.qualifiedName}\`${stale}`,
      range: toEditorRange(symbol.range),
    };
  }

  formatting(
    uri: string,
    options: { indentSize?: number; requireValidSyntax?: boolean } = {},
  ): TextEdit[] {
    const document = this.#documents.get(uri);
    if (!document) return [];
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
    if (character !== "\n") return null;
    const syntax = this.#syntax.get(uri)?.value;
    return syntax ? templateForNewline(syntax, position) : null;
  }

  compile(roots = [...this.#documents.keys()]): CompilationResult {
    const versions = this.#versions();
    const key = JSON.stringify({
      roots: [...roots].sort(),
      versions: Object.entries(versions).sort(),
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
    const generation = this.#generation;
    const versions = this.#versions();
    const roots = this.#affectedRoots(changedUri);
    const cached = this.#cache.get(roots, versions);
    let snapshot: SemanticSnapshot;
    if (cached) snapshot = cached;
    else
      snapshot = await Promise.resolve().then(() =>
        this.compiler.analyze({ roots }),
      );
    if (!this.#isCurrent(generation, versions)) {
      const cancelled = {
        value: null,
        freshness: "cancelled",
        generation,
        documentVersions: versions,
      } as const;
      this.#lastSemantic = cancelled;
      return cancelled;
    }
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
    this.#onAnalysis?.({ result, affectedUris: roots });
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
    this.#generation++;
    this.#cache.clear();
    this.#compileCache.clear();
    const snapshot = this.compiler.parse(uri);
    const result = {
      value: snapshot,
      freshness: "fresh",
      generation: this.#generation,
      documentVersions: this.#versions(),
    } as const;
    this.#syntax.set(uri, result);
    if (this.#lastSemantic)
      this.#lastSemantic = { ...this.#lastSemantic, freshness: "stale" };
    this.#schedule(uri);
    return result;
  }

  #schedule(changedUri: string): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.analyzeNow(changedUri).catch((error) => this.#onError?.(error));
    }, this.#debounceMs);
  }

  #affectedRoots(changedUri?: string): string[] {
    const open = [...this.#documents.keys()];
    if (!changedUri) return open.sort();
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

  #assertActive(): void {
    if (this.#disposed) throw new Error("LanguageService has been disposed");
  }
}
