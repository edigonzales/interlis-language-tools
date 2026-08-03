import type { OpenDocument, WorkspaceSource } from "../types.js";
import type { ResolvedRepositoryModel } from "../repository.js";

export interface EffectiveSource {
  readonly text: string;
  readonly version: number;
}

export interface SourceChange {
  readonly uri: string;
  readonly kind:
    | "added"
    | "updated"
    | "version-only"
    | "removed"
    | "shadowed"
    | "revealed"
    | "unchanged";
  readonly previous?: EffectiveSource;
  readonly current?: EffectiveSource;
  readonly generation: number;
}

type StoredSource = { readonly text: string; readonly version: number };

export class SourceRegistry {
  readonly #documents = new Map<string, OpenDocument>();
  readonly #workspace = new Map<string, StoredSource>();
  readonly #repository = new Map<string, ResolvedRepositoryModel>();
  readonly #repositoryVersions = new Map<string, number>();
  readonly #effective = new Map<string, EffectiveSource>();
  readonly #readOnly = new Set<string>();
  readonly #removed = new Set<string>();
  #generation = 0;
  #revision = 1;

  openDocument(uri: string, text: string, version: number): SourceChange {
    return this.#setDocument(uri, text, version, false);
  }

  changeDocument(uri: string, text: string, version: number): SourceChange {
    if (this.isReadOnly(uri)) throw new Error(`Repository document is read-only: ${uri}`);
    return this.#setDocument(uri, text, version, true);
  }

  /**
   * Records the live document layer without allocating a SourceChange. The
   * language service already performs the corresponding invalidation and this
   * hot path is called for every Monaco edit event.
   */
  recordDocument(uri: string, text: string, version: number, dirty: boolean): void {
    const current = this.#documents.get(uri);
    if (current && version <= current.version) throw new Error(`Document version must increase for ${uri}`);
    this.#documents.set(uri, { uri, text, version, dirty });
    this.#effective.set(uri, { text, version });
    this.#removed.delete(uri);
    this.#generation++;
  }

  markSaved(uri: string): SourceChange | null {
    const document = this.#documents.get(uri);
    if (!document) return null;
    this.#documents.set(uri, { ...document, dirty: false });
    if (!this.isReadOnly(uri)) this.#workspace.set(uri, { text: document.text, version: document.version });
    return this.#change(uri, this.#effective.get(uri), this.#effective.get(uri), "unchanged");
  }

  closeDocument(uri: string): SourceChange | null {
    if (!this.#documents.delete(uri)) return null;
    return this.#refresh(uri);
  }

  replaceWorkspaceSources(sources: readonly WorkspaceSource[]): readonly SourceChange[] {
    const incoming = new Set(sources.map((source) => source.uri));
    const changes: SourceChange[] = [];
    for (const uri of this.#workspace.keys()) if (!incoming.has(uri)) {
      this.#workspace.delete(uri);
      if (!this.#documents.has(uri)) changes.push(this.#refresh(uri));
    }
    for (const source of sources) {
      this.#workspace.set(source.uri, { text: source.text, version: source.version ?? ++this.#revision });
      if (!this.#documents.has(source.uri)) changes.push(this.#refresh(source.uri));
    }
    return changes;
  }

  putWorkspaceSource(uri: string, text: string, version?: number): SourceChange {
    this.#workspace.set(uri, { text, version: version ?? ++this.#revision });
    return this.#documents.has(uri) ? this.#change(uri, this.#effective.get(uri), this.#effective.get(uri), "shadowed") : this.#refresh(uri);
  }

  removeWorkspaceSource(uri: string): SourceChange | null {
    if (!this.#workspace.delete(uri) || this.#documents.has(uri)) return null;
    return this.#refresh(uri);
  }

  putRepositorySource(model: ResolvedRepositoryModel): SourceChange {
    this.#repository.set(model.uri, model);
    this.#repositoryVersions.set(model.uri, ++this.#revision);
    this.#readOnly.add(model.uri);
    return this.#refresh(model.uri);
  }

  clearRepositorySources(): readonly SourceChange[] {
    const uris = [...this.#repository.keys()];
    this.#repository.clear();
    this.#repositoryVersions.clear();
    return uris.map((uri) => {
      if (!this.#documents.has(uri)) this.#readOnly.delete(uri);
      return this.#refresh(uri);
    });
  }

  effective(uri: string): EffectiveSource | undefined { return this.#effective.get(uri); }
  document(uri: string): OpenDocument | undefined { return this.#documents.get(uri); }
  hasDocument(uri: string): boolean { return this.#documents.has(uri); }
  documents(): readonly OpenDocument[] { return [...this.#documents.values()]; }
  repositoryDocument(uri: string): ResolvedRepositoryModel | undefined { return this.#repository.get(uri); }
  hasRepositorySource(uri: string): boolean { return this.#repository.has(uri); }
  removed(uri: string): boolean { return this.#removed.has(uri); }
  refresh(uri: string): SourceChange { return this.#refresh(uri); }
  isReadOnly(uri: string): boolean { return this.#readOnly.has(uri); }
  generation(): number { return this.#generation; }

  #setDocument(uri: string, text: string, version: number, dirty: boolean): SourceChange {
    const current = this.#documents.get(uri);
    if (current && version <= current.version) throw new Error(`Document version must increase for ${uri}`);
    this.#documents.set(uri, { uri, text, version, dirty });
    return this.#apply(uri, { text, version }, current ? "updated" : "added");
  }

  #preferred(uri: string): EffectiveSource | undefined {
    const document = this.#documents.get(uri);
    if (document) return { text: document.text, version: document.version };
    const workspace = this.#workspace.get(uri);
    if (workspace) return workspace;
    const repository = this.#repository.get(uri);
    if (repository) return {
      text: typeof repository.source === "string"
        ? repository.source
        : new TextDecoder().decode(repository.source),
      version: this.#repositoryVersions.get(uri) ?? 0,
    };
    return undefined;
  }

  #refresh(uri: string): SourceChange {
    const next = this.#preferred(uri);
    const previous = this.#effective.get(uri);
    if (!next) {
      this.#effective.delete(uri);
      this.#removed.add(uri);
      this.#generation++;
      return this.#change(uri, previous, undefined, "removed");
    }
    return this.#apply(uri, next, previous ? "updated" : "added");
  }

  #apply(uri: string, next: EffectiveSource, kind: SourceChange["kind"]): SourceChange {
    const previous = this.#effective.get(uri);
    this.#effective.set(uri, next);
    this.#removed.delete(uri);
    if (previous && previous.text === next.text && previous.version === next.version) kind = "unchanged";
    else if (previous && previous.text === next.text) kind = "version-only";
    this.#generation++;
    return this.#change(uri, previous, next, kind);
  }

  #change(uri: string, previous: EffectiveSource | undefined, current: EffectiveSource | undefined, kind: SourceChange["kind"]): SourceChange {
    return { uri, previous, current, kind, generation: this.#generation };
  }
}
