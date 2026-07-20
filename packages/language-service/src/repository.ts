import type { WorkspaceFileSystem } from "./workspace.js";

export type RepositorySchemaLanguage = "ili2_3" | "ili2_4";

export interface ModelCatalogEntry {
  readonly name: string;
  readonly schemaLanguage: RepositorySchemaLanguage;
  readonly version: string;
  readonly repository: string;
  readonly browseOnly?: boolean;
}

export interface ResolvedRepositoryModel {
  readonly model: string;
  readonly uri: string;
  readonly originUri: string;
  readonly source: string | Uint8Array;
  readonly schemaLanguage: RepositorySchemaLanguage;
  readonly version: string;
  readonly fromCache: boolean;
  readonly readOnly: true;
}

export interface ModelRepository {
  readonly listModels: () => Promise<readonly ModelCatalogEntry[]>;
  readonly resolveModels: (
    models: readonly string[],
    schemaLanguage: RepositorySchemaLanguage,
  ) => Promise<readonly ResolvedRepositoryModel[]>;
  readonly dispose?: () => void | Promise<void>;
}

/** @deprecated Use ModelRepository. */
export interface ResolvedModel {
  readonly model: string;
  readonly uri: string;
  readonly source: Uint8Array;
  readonly cached: boolean;
}

/** @deprecated Workspace sources should be registered on LanguageService. */
export interface RepositoryResolver {
  resolve(
    model: string,
    directories: readonly string[],
  ): Promise<ResolvedModel | null>;
}

/** Compatibility adapter for consumers of the original workspace resolver. */
export class WorkspaceRepositoryResolver implements RepositoryResolver {
  readonly #decoder = new TextDecoder();

  constructor(private readonly workspace: WorkspaceFileSystem) {}

  async resolve(
    model: string,
    directories: readonly string[],
  ): Promise<ResolvedModel | null> {
    for (const directory of directories) {
      const uri = `${directory.replace(/\/$/, "")}/${model}.ili`;
      try {
        const source = await this.workspace.read(uri);
        if (this.#decoder.decode(source).trim())
          return { model, uri, source, cached: true };
      } catch {
        // Missing candidates are expected while walking workspace directories.
      }
    }
    return null;
  }
}
