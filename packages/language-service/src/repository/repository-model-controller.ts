import type { ModelCatalogEntry, ModelRepository, RepositorySchemaLanguage, ResolvedRepositoryModel } from "../repository.js";

export class RepositoryModelController {
  #repository?: ModelRepository;
  readonly #models = new Map<string, ResolvedRepositoryModel>();
  #catalog: readonly ModelCatalogEntry[] | null = null;
  #catalogPromise: Promise<readonly ModelCatalogEntry[]> | null = null;

  constructor(repository?: ModelRepository) { this.#repository = repository; }

  async setRepository(repository?: ModelRepository): Promise<void> {
    const previous = this.#repository;
    this.#repository = repository;
    this.#models.clear();
    this.#catalog = null;
    this.#catalogPromise = null;
    if (previous && previous !== repository) await previous.dispose?.();
  }

  listModels(): Promise<readonly ModelCatalogEntry[]> {
    if (!this.#repository) return Promise.resolve([]);
    if (this.#catalog) return Promise.resolve(this.#catalog);
    if (!this.#catalogPromise) this.#catalogPromise = this.#repository.listModels().then((catalog) => { this.#catalog = catalog; return catalog; }).finally(() => { this.#catalogPromise = null; });
    return this.#catalogPromise;
  }

  resolveMissing(models: readonly string[], language: RepositorySchemaLanguage): Promise<readonly ResolvedRepositoryModel[]> {
    return (this.#repository?.resolveModels(models, language) ?? Promise.resolve([])).then((resolved) => {
      for (const model of resolved) this.#models.set(model.uri, model);
      return resolved;
    });
  }

  document(uri: string): ResolvedRepositoryModel | undefined { return this.#models.get(uri); }
  dispose(): Promise<void> { return Promise.resolve(this.#repository?.dispose?.()).then(() => undefined); }
}
